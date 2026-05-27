import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { AddressInfo } from "node:net";
import {
  ContractToolWorker,
  MailboxRunner,
  MailboxService,
  PostgresMailboxEngine,
  RunnerDaemon,
  ToolWorkerDaemon,
  createPool,
  getAgent,
  migrate,
  type MailboxEvent,
  type MailboxProjection,
  type MailboxSummary,
} from "@agent-mailbox/core";
import { z } from "zod";
import { steelDocsSyncApp } from "./app.js";
import { startSteelFixtureServer } from "./fixtures.js";
import { createSteelDocsSyncApiServer, type SteelDocsSyncWebhookPayload } from "./server.js";

const ToolArtifactSchema = z.object({
  kind: z.enum(["docs-page", "llms-txt", "openapi-spec"]),
  url: z.string().url(),
  mediaType: z.string().min(1),
  sha256: z.string().length(64),
  byteLength: z.number().int().nonnegative(),
});

const ToolArtifactListSchema = z.array(ToolArtifactSchema).length(3);

const webhookSecret = "steel-docs-sync-demo-secret";
const pool = createPool();
const fixtures = await startSteelFixtureServer();

try {
  await migrate(pool, { reset: true });

  const engine = new PostgresMailboxEngine(pool);
  const service = new MailboxService(engine);
  const fixtureHost = new URL(fixtures.baseUrl).host;
  const server = createSteelDocsSyncApiServer(engine, service, {
    webhookSecret,
    allowedHosts: [fixtureHost],
  });
  await listen(server);

  const address = server.address();
  assert(isAddressInfo(address));
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const activeAgent = getAgent(steelDocsSyncApp, "steel-docs");
  const runnerDaemon = new RunnerDaemon(engine, new MailboxRunner(engine, engine, activeAgent.planner), 25);
  const toolDaemon = new ToolWorkerDaemon(engine, new ContractToolWorker(engine, activeAgent.tools), 25);
  runnerDaemon.start();
  toolDaemon.start();

  try {
    const payload: SteelDocsSyncWebhookPayload = {
      repository: "steel-dev/docs",
      ref: "refs/heads/main",
      sha: "8d2c4ef",
      runId: "42",
      runAttempt: 1,
      eventName: "schedule",
      mode: "production-drift",
      docsBaseUrl: fixtures.baseUrl,
      llmsTxtUrl: `${fixtures.baseUrl}/llms.txt`,
      llmsFullTxtUrl: `${fixtures.baseUrl}/llms-full.txt`,
      apiReferenceUrl: `${fixtures.baseUrl}/reference/api`,
      openApiSpecUrl: `${fixtures.baseUrl}/openapi.json`,
    };

    const invalidSignature = await postWebhook(baseUrl, payload, { secret: "wrong-secret" });
    assert.equal(invalidSignature.status, 403);

    const invalidHost = await postWebhook(baseUrl, {
      ...payload,
      openApiSpecUrl: "https://evil.example/openapi.json",
    });
    assert.equal(invalidHost.status, 400);

    const created = await postWebhook(baseUrl, payload);
    assert.equal(created.status, 202);
    assert(typeof created.body.mailboxId === "string");
    assert(typeof created.body.statusUrl === "string");
    assert(typeof created.body.eventsUrl === "string");

    const duplicate = await postWebhook(baseUrl, payload);
    assert.equal(duplicate.status, 202);
    assert.equal(duplicate.body.mailboxId, created.body.mailboxId);

    const streamed = await readTerminalStream(baseUrl, created.body.mailboxId);
    const finalProjection = await getJson<MailboxProjection>(`${baseUrl}/mailboxes/${created.body.mailboxId}`);
    const summary = await getJson<MailboxSummary>(`${baseUrl}/mailboxes/${created.body.mailboxId}/summary`);
    const events = await getEvents(baseUrl, created.body.mailboxId);
    const sessionStarted = events.find((event) => event.type === "session.started");
    const promptReceived = events.find((event) => event.type === "prompt.received");
    const toolRequested = events.find((event) => event.type === "tool.requested");
    const toolCompleted = events.find((event) => event.type === "tool.completed");
    const finalResponse = events.find((event) => event.type === "agent.response.produced");

    assert.equal(finalProjection.status, "completed");
    assert.equal(summary.status, "completed");
    assert.equal(summary.outcome, "warning");
    assert.deepEqual(summary.findings, { critical: 0, warning: 2, info: 0 });
    assert.equal(streamed.summary.status, "completed");
    assert.equal(streamed.summary.outcome, "warning");
    assert.equal(streamed.events.filter((event) => event.type === "agent.finding.produced").length, 2);
    assert(sessionStarted?.type === "session.started");
    assert.equal(sessionStarted.payload.source, "github-action");
    assert.deepEqual(sessionStarted.payload.metadata, payload);
    assert(promptReceived?.type === "prompt.received");
    assert.deepEqual(promptReceived.actor, { type: "system", id: "github-actions" });
    assert(toolRequested?.type === "tool.requested");
    assert.deepEqual(toolRequested.payload.args, {
      repository: payload.repository,
      ref: payload.ref,
      sha: payload.sha,
      mode: payload.mode,
      docsBaseUrl: payload.docsBaseUrl,
      llmsTxtUrl: payload.llmsTxtUrl,
      openApiSpecUrl: payload.openApiSpecUrl,
    });
    assert(toolCompleted?.type === "tool.completed");
    const artifacts = readArtifacts(toolCompleted.payload.output.data);
    assert.equal(artifacts.length, 3);
    assert.deepEqual(artifacts.map((artifact) => artifact.url), [payload.docsBaseUrl, payload.llmsTxtUrl, payload.openApiSpecUrl]);
    assert(finalResponse?.type === "agent.response.produced");

    console.log("Steel webhook demo verified");
    console.log(`api=${baseUrl}`);
    console.log(`mailboxId=${created.body.mailboxId}`);
    console.log(`statusUrl=${created.body.statusUrl}`);
    console.log(`eventsUrl=${created.body.eventsUrl}`);
    console.log(`summaryUrl=${baseUrl}/mailboxes/${created.body.mailboxId}/summary`);
    console.log(`streamUrl=${baseUrl}/mailboxes/${created.body.mailboxId}/stream`);
    console.log(`outcome=${summary.outcome}`);
    console.log(`artifacts=${artifacts.length}`);
    console.log(`finalStatus=${finalProjection.status}`);
    console.log(`finalMessage=${summary.finalMessage ?? finalResponse.payload.message}`);
  } finally {
    await runnerDaemon.stop();
    await toolDaemon.stop();
    server.close();
  }
} finally {
  await pool.end();
  fixtures.server.close();
}

function listen(server: ReturnType<typeof createSteelDocsSyncApiServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function readTerminalStream(
  baseUrl: string,
  mailboxId: string,
): Promise<{ events: MailboxEvent[]; summary: MailboxSummary }> {
  const response = await fetch(`${baseUrl}/mailboxes/${mailboxId}/stream`);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to open SSE stream: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: MailboxEvent[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const rawRecord = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const record = parseSseRecord(rawRecord);
      if (record?.event === "mailbox.event") {
        events.push(record.data as MailboxEvent);
      }
      if (record?.event === "mailbox.summary") {
        const summary = record.data as MailboxSummary;
        if (summary.status === "completed" || summary.status === "failed") {
          await reader.cancel();
          return { events, summary };
        }
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  throw new Error(`Stream ended before terminal summary for mailbox ${mailboxId}`);
}

async function getEvents(baseUrl: string, mailboxId: string): Promise<MailboxEvent[]> {
  const body = await getJson<{ events: MailboxEvent[] }>(`${baseUrl}/mailboxes/${mailboxId}/events`);
  return body.events;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return parseJsonResponse<T>(response);
}

async function postWebhook(
  baseUrl: string,
  payload: SteelDocsSyncWebhookPayload,
  options: { secret?: string; timestamp?: number } = {},
): Promise<{ status: number; body: { mailboxId?: string; statusUrl?: string; eventsUrl?: string; error?: string } }> {
  const timestamp = options.timestamp ?? Date.now();
  const body = JSON.stringify(payload);
  const secret = options.secret ?? webhookSecret;
  const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

  const response = await fetch(`${baseUrl}/webhooks/github/steel-docs-sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-mailbox-timestamp": String(timestamp),
      "x-agent-mailbox-signature": signature,
    },
    body,
  });

  return {
    status: response.status,
    body: (await response.json()) as { mailboxId?: string; statusUrl?: string; eventsUrl?: string; error?: string },
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function parseSseRecord(rawRecord: string): { event: string; data: unknown } | null {
  if (rawRecord.length === 0) {
    return null;
  }

  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of rawRecord.split("\n")) {
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      eventName = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return { event: eventName, data: JSON.parse(dataLines.join("\n")) };
}

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return typeof address === "object" && address !== null && "port" in address;
}

function readArtifacts(data: unknown): z.infer<typeof ToolArtifactListSchema> {
  const artifacts = z
    .object({
      artifacts: ToolArtifactListSchema,
    })
    .parse(data);
  return artifacts.artifacts;
}
