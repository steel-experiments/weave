import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { AddressInfo } from "node:net";
import {
  getAgent,
  isDomainEvent,
  type ThreadEvent,
  type ThreadProjection,
  type ThreadSummary,
} from "weave/runtime";
import { ContractToolWorker, ThreadRunner, ThreadService, createWeaveRuntime } from "weave/runtime";
import { PostgresThreadArtifactStore, PostgresThreadEngine, ThreadArtifactSchema, createPool, migrate } from "weave/postgres";
import { z } from "zod";
import { steelDocsSyncApp } from "./app.js";
import { FINDING_PRODUCED, FindingProducedSchema } from "./events.js";
import { startSteelFixtureServer } from "./fixtures.js";
import { createSteelDocsSyncApiServer, type SteelDocsSyncWebhookPayload } from "./server.js";

const ToolArtifactSchema = z.object({
  artifactId: z.string().uuid(),
  threadId: z.string().min(1),
  toolCallId: z.string().uuid().nullable(),
  kind: z.enum(["docs-page", "llms-txt", "openapi-spec"]),
  uri: z.string().min(1),
  sourceUrl: z.string().url(),
  mediaType: z.string().min(1),
  sha256: z.string().length(64),
  byteLength: z.number().int().nonnegative(),
});

const ToolArtifactListSchema = z.array(ToolArtifactSchema).length(3);
const ToolBaselineSchema = z.object({
  kind: z.enum(["docs-page", "llms-txt", "openapi-spec"]),
  snapshotKey: z.string().min(1),
  previousArtifactId: z.string().uuid().nullable(),
  previousSha256: z.string().length(64).nullable(),
  changed: z.boolean(),
});
const PersistedArtifactListSchema = z.array(ThreadArtifactSchema).length(3);
const InboxDiagnosticsSchema = z.array(
  z.object({
    id: z.number().int().positive(),
    consumer: z.string().min(1),
    eventSeq: z.number().int().nonnegative(),
    state: z.string().min(1),
    attempts: z.number().int().nonnegative(),
    visibleAt: z.string().datetime(),
    claimedBy: z.string().nullable(),
    claimedUntil: z.string().datetime().nullable(),
    lastErrorCode: z.string().nullable(),
    lastErrorMessage: z.string().nullable(),
    updatedAt: z.string().datetime(),
  }),
);

const webhookSecret = "steel-docs-sync-demo-secret";
const pool = createPool();
const fixtures = await startSteelFixtureServer();

try {
  await migrate(pool, { reset: true });

  const engine = new PostgresThreadEngine(pool);
  const artifactStore = new PostgresThreadArtifactStore(pool);
  const runtimeApp = { ...steelDocsSyncApp, artifactStore };
  const service = new ThreadService(engine);
  const fixtureHost = new URL(fixtures.baseUrl).host;
  const server = createSteelDocsSyncApiServer(engine, service, {
    artifactStore: runtimeApp.artifactStore,
    webhookSecret,
    allowedHosts: [fixtureHost],
  });
  await listen(server);

  const address = server.address();
  assert(isAddressInfo(address));
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const activeAgent = getAgent(runtimeApp, "steel-docs");
  const runtime = createWeaveRuntime({
    app: runtimeApp,
    agentName: "steel-docs",
    engine,
    service,
    intervalMs: 25,
  });
  const { runnerDaemon, toolDaemon } = runtime;
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
    assert(typeof created.body.threadId === "string");
    assert(typeof created.body.statusUrl === "string");
    assert(typeof created.body.eventsUrl === "string");

    const duplicate = await postWebhook(baseUrl, payload);
    assert.equal(duplicate.status, 202);
    assert.equal(duplicate.body.threadId, created.body.threadId);

    const firstStreamEvent = await readFirstStreamEvent(baseUrl, created.body.threadId);
    const streamed = await readTerminalStream(baseUrl, created.body.threadId, {
      lastEventId: firstStreamEvent.id,
    });
    const finalProjection = await getJson<ThreadProjection>(`${baseUrl}/threads/${created.body.threadId}`);
    const summary = await getJson<ThreadSummary>(`${baseUrl}/threads/${created.body.threadId}/summary`);
    const artifactListing = await getJson<{ artifacts: z.infer<typeof PersistedArtifactListSchema> }>(
      `${baseUrl}/threads/${created.body.threadId}/artifacts`,
    );
    const events = await getEvents(baseUrl, created.body.threadId);
    const sessionStarted = events.find((event) => event.type === "session.started");
    const promptReceived = events.find((event) => event.type === "prompt.received");
    const toolRequested = events.find((event) => event.type === "tool.requested");
    const toolCompleted = events.find((event) => event.type === "tool.completed");
    const finalResponse = events.find((event) => event.type === "agent.response.produced");

    const findingSeverities = events
      .filter((event) => isDomainEvent(event, FINDING_PRODUCED))
      .map((event) => FindingProducedSchema.parse(event.payload.data).severity);
    const findingBreakdown = {
      critical: findingSeverities.filter((severity) => severity === "critical").length,
      warning: findingSeverities.filter((severity) => severity === "warning").length,
      info: findingSeverities.filter((severity) => severity === "info").length,
    };

    assert.equal(finalProjection.status, "completed");
    assert.equal(summary.status, "completed");
    assert.equal(summary.outcome, "passed");
    assert.equal(summary.execution.status, "succeeded");
    assert.deepEqual(findingBreakdown, { critical: 0, warning: 2, info: 0 });
    assert.equal(streamed.summary.status, "completed");
    assert.equal(streamed.summary.outcome, "passed");
    assert.equal(streamed.summary.execution.status, "succeeded");
    assert.equal(streamed.completed.status, "completed");
    assert(streamed.events.every((event) => (event.seq ?? 0) > firstStreamEvent.id));
    assert.equal(streamed.events.filter((event) => isDomainEvent(event, FINDING_PRODUCED)).length, 2);
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
    assert.deepEqual(
      events.filter((event) => event.type === "tool.requested").map((event) => event.payload.toolName),
      ["steel.auditDocsSync", "steel.modelReview"],
    );
    assert(toolCompleted?.type === "tool.completed");
    const artifacts = readArtifacts(toolCompleted.payload.output);
    assert.equal(artifacts.length, 3);
    assert.deepEqual(artifacts.map((artifact) => artifact.sourceUrl), [payload.docsBaseUrl, payload.llmsTxtUrl, payload.openApiSpecUrl]);
    assert.deepEqual(
      artifactListing.artifacts.map((artifact) => artifact.artifactId),
      artifacts.map((artifact) => artifact.artifactId),
    );
    const baselines = readBaselines(toolCompleted.payload.output);
    assert(baselines.every((baseline) => baseline.previousArtifactId === null));
    assert(finalResponse?.type === "agent.response.produced");

    const flakySuccessPayload: SteelDocsSyncWebhookPayload = {
      ...payload,
      runAttempt: 2,
      llmsTxtUrl: `${fixtures.baseUrl}/flaky-llms.txt`,
    };
    const flakySuccessCreated = await postWebhook(baseUrl, flakySuccessPayload);
    assert.equal(flakySuccessCreated.status, 202);
    assert(typeof flakySuccessCreated.body.threadId === "string");
    const flakyStreamed = await readTerminalStream(baseUrl, flakySuccessCreated.body.threadId);
    assert.equal(flakyStreamed.completed.status, "completed");
    const flakyEvents = await getEvents(baseUrl, flakySuccessCreated.body.threadId);
    assert(
      flakyEvents.some(
        (event) => event.type === "tool.progress" && event.payload.message.includes("Retrying after transient failure"),
      ),
    );

    const baselineSuccessPayload: SteelDocsSyncWebhookPayload = {
      ...payload,
      runAttempt: 3,
    };
    const baselineSuccessCreated = await postWebhook(baseUrl, baselineSuccessPayload);
    assert.equal(baselineSuccessCreated.status, 202);
    assert(typeof baselineSuccessCreated.body.threadId === "string");
    const baselineStreamed = await readTerminalStream(baseUrl, baselineSuccessCreated.body.threadId);
    assert.equal(baselineStreamed.completed.status, "completed");
    const baselineEvents = await getEvents(baseUrl, baselineSuccessCreated.body.threadId);
    const baselineToolCompleted = baselineEvents.find((event) => event.type === "tool.completed");
    assert(baselineToolCompleted?.type === "tool.completed");
    const baselineComparisons = readBaselines(baselineToolCompleted.payload.output);
    assert(baselineComparisons.every((baseline) => baseline.previousArtifactId !== null));
    assert(baselineComparisons.every((baseline) => baseline.changed === false));

    const executionFailurePayload: SteelDocsSyncWebhookPayload = {
      ...payload,
      runAttempt: 4,
      llmsTxtUrl: `${fixtures.baseUrl}/missing.txt`,
    };
    const executionFailureCreated = await postWebhook(baseUrl, executionFailurePayload);
    assert.equal(executionFailureCreated.status, 202);
    assert(typeof executionFailureCreated.body.threadId === "string");
    const failedFirstStreamEvent = await readFirstStreamEvent(baseUrl, executionFailureCreated.body.threadId);
    const failedStreamed = await readTerminalStream(baseUrl, executionFailureCreated.body.threadId, {
      lastEventId: failedFirstStreamEvent.id,
    });
    const failedSummary = await getJson<ThreadSummary>(`${baseUrl}/threads/${executionFailureCreated.body.threadId}/summary`);
    assert.equal(failedSummary.status, "failed");
    assert.equal(failedSummary.outcome, null);
    assert.equal(failedSummary.execution.status, "failed");
    assert.equal(failedSummary.execution.errorCode, "execution_failed");
    assert(typeof failedSummary.execution.message === "string");
    assert.equal(failedStreamed.summary.status, "failed");
    assert.equal(failedStreamed.summary.outcome, null);
    assert.equal(failedStreamed.summary.execution.status, "failed");
    assert.equal(failedStreamed.completed.status, "failed");
    assert(failedStreamed.events.every((event) => (event.seq ?? 0) > failedFirstStreamEvent.id));
    const failedInboxDiagnostics = await getJson<{ items: z.infer<typeof InboxDiagnosticsSchema> }>(
      `${baseUrl}/threads/${executionFailureCreated.body.threadId}/diagnostics/inbox`,
    );
    assert(
      failedInboxDiagnostics.items.some(
        (item) => item.state === "dead-letter" && item.lastErrorCode === "execution_failed",
      ),
    );
    assert(failedInboxDiagnostics.items.every((item) => item.state !== "claimed"));
    const failedToolInbox = failedInboxDiagnostics.items.find(
      (item) => item.state === "dead-letter" && item.lastErrorCode === "execution_failed",
    );
    assert(failedToolInbox);

    console.log("Steel webhook demo verified");
    console.log(`api=${baseUrl}`);
    console.log(`threadId=${created.body.threadId}`);
    console.log(`statusUrl=${created.body.statusUrl}`);
    console.log(`eventsUrl=${created.body.eventsUrl}`);
    console.log(`artifactsUrl=${baseUrl}/threads/${created.body.threadId}/artifacts`);
    console.log(`summaryUrl=${baseUrl}/threads/${created.body.threadId}/summary`);
    console.log(`streamUrl=${baseUrl}/threads/${created.body.threadId}/stream`);
    console.log(`outcome=${summary.outcome}`);
    console.log(`execution=${summary.execution.status}`);
    console.log(`resumedFrom=${firstStreamEvent.id}`);
    console.log(`artifacts=${artifacts.length}`);
    console.log(`finalStatus=${finalProjection.status}`);
    console.log(`finalMessage=${summary.finalMessage ?? finalResponse.payload.message}`);
    console.log(`failedThreadId=${executionFailureCreated.body.threadId}`);
    console.log(`failedExecution=${failedSummary.execution.status}`);
    console.log(`failedInboxState=${failedToolInbox.state}`);
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
  threadId: string,
  options: { lastEventId?: number } = {},
): Promise<{ events: ThreadEvent[]; summary: ThreadSummary; completed: ThreadSummary }> {
  const response = await fetch(`${baseUrl}/threads/${threadId}/stream`, {
    headers: options.lastEventId !== undefined ? { "Last-Event-ID": String(options.lastEventId) } : undefined,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to open SSE stream: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: ThreadEvent[] = [];
  let latestSummary: ThreadSummary | null = null;

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
      if (record?.event === "thread.event") {
        events.push(record.data as ThreadEvent);
      }
      if (record?.event === "thread.summary") {
        const summary = record.data as ThreadSummary;
        latestSummary = summary;
      }
      if (record?.event === "thread.completed") {
        const completed = record.data as ThreadSummary;
        await reader.cancel();
        return { events, summary: latestSummary ?? completed, completed };
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  throw new Error(`Stream ended before terminal summary for thread ${threadId}`);
}

async function readFirstStreamEvent(baseUrl: string, threadId: string): Promise<{ id: number; event: ThreadEvent }> {
  const response = await fetch(`${baseUrl}/threads/${threadId}/stream`);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to open SSE stream: HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
      if (record?.event === "thread.event") {
        await reader.cancel();
        if (record.id === undefined) {
          throw new Error(`Streamed thread event missing id for thread ${threadId}`);
        }
        return { id: record.id, event: record.data as ThreadEvent };
      }
      separatorIndex = buffer.indexOf("\n\n");
    }
  }

  throw new Error(`Stream ended before first thread event for thread ${threadId}`);
}

async function getEvents(baseUrl: string, threadId: string): Promise<ThreadEvent[]> {
  const body = await getJson<{ events: ThreadEvent[] }>(`${baseUrl}/threads/${threadId}/events`);
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
): Promise<{ status: number; body: { threadId?: string; statusUrl?: string; eventsUrl?: string; error?: string } }> {
  const timestamp = options.timestamp ?? Date.now();
  const body = JSON.stringify(payload);
  const secret = options.secret ?? webhookSecret;
  const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

  const response = await fetch(`${baseUrl}/webhooks/github/steel-docs-sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-weave-timestamp": String(timestamp),
      "x-weave-signature": signature,
    },
    body,
  });

  return {
    status: response.status,
    body: (await response.json()) as { threadId?: string; statusUrl?: string; eventsUrl?: string; error?: string },
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function parseSseRecord(rawRecord: string): { id?: number; event: string; data: unknown } | null {
  if (rawRecord.length === 0) {
    return null;
  }

  let eventName = "message";
  let id: number | undefined;
  const dataLines: string[] = [];
  for (const line of rawRecord.split("\n")) {
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("id:")) {
      const parsedId = Number.parseInt(line.slice("id:".length).trim(), 10);
      id = Number.isNaN(parsedId) ? undefined : parsedId;
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

  return { id, event: eventName, data: JSON.parse(dataLines.join("\n")) };
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

function readBaselines(data: unknown): z.infer<typeof ToolBaselineSchema>[] {
  const baselines = z
    .object({
      baselines: z.array(ToolBaselineSchema).length(3),
    })
    .parse(data);
  return baselines.baselines;
}
