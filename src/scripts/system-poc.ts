import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { createApiServer } from "../api-server.js";
import { RunnerDaemon, ToolWorkerDaemon } from "../daemons.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { MailboxService } from "../mailbox-service.js";
import { MockAsyncToolWorker } from "../mock-tool-worker.js";
import { PostgresMailboxEngine } from "../postgres-engine.js";
import { MailboxRunner } from "../runner.js";
import { toMermaidTimeline, toTextTimeline } from "../timeline.js";
import type { MailboxEvent, MailboxProjection } from "../events.js";

const pool = createPool();

try {
  await migrate(pool, { reset: true });

  const engine = new PostgresMailboxEngine(pool);
  const service = new MailboxService(engine);
  const server = createApiServer(engine, service);
  await listen(server);

  const address = server.address();
  assert(isAddressInfo(address));
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const runnerDaemon = new RunnerDaemon(engine, new MailboxRunner(engine, engine), 25);
  const toolDaemon = new ToolWorkerDaemon(engine, new MockAsyncToolWorker(engine), 25);
  runnerDaemon.start();
  toolDaemon.start();

  try {
    const created = await postJson<{ mailboxId: string; correlationId: string }>(`${baseUrl}/mailboxes`, {
      prompt: "Run the mock async job through the API-driven system and wait for approval.",
    });

    const blockedProjection = await waitForProjection(baseUrl, created.mailboxId, (projection) => {
      return projection.status === "blocked" && projection.pendingGateIds.length === 1;
    });

    const gateId = blockedProjection.pendingGateIds[0];
    assert(gateId);

    await postJson(`${baseUrl}/mailboxes/${created.mailboxId}/gates/${gateId}/resolve`, {
      resolution: "approved",
      comment: "API-driven approval granted",
    });

    const finalProjection = await waitForProjection(baseUrl, created.mailboxId, (projection) => {
      return projection.status === "completed";
    });

    const events = await getEvents(baseUrl, created.mailboxId);
    const eventTypes = events.map((event) => event.type);

    assert.deepEqual(eventTypes, [
      "session.started",
      "prompt.received",
      "runner.resumed",
      "agent.step.started",
      "tool.requested",
      "agent.step.completed",
      "tool.started",
      "tool.progress",
      "tool.progress",
      "tool.progress",
      "tool.completed",
      "runner.resumed",
      "agent.step.started",
      "gate.created",
      "agent.step.completed",
      "gate.resolved",
      "runner.resumed",
      "agent.step.started",
      "agent.response.produced",
      "agent.step.completed",
    ]);
    assert.equal(events.length, finalProjection.tailSeq);

    const finalResponse = events.find((event) => event.type === "agent.response.produced");
    assert(finalResponse?.payload.message.includes("Approved result"));

    console.log("API-driven system PoC verified");
    console.log(`api=${baseUrl}`);
    console.log(`mailboxId=${created.mailboxId}`);
    console.log("timeline:");
    console.log(toTextTimeline(events));
    console.log("mermaid:");
    console.log("```mermaid");
    console.log(toMermaidTimeline(events));
    console.log("```");
    console.log(`finalStatus=${finalProjection.status}`);
    console.log(`finalMessage=${finalResponse?.payload.message}`);
  } finally {
    runnerDaemon.stop();
    toolDaemon.stop();
    server.close();
  }
} finally {
  await pool.end();
}

function listen(server: ReturnType<typeof createApiServer>): Promise<void> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

async function waitForProjection(
  baseUrl: string,
  mailboxId: string,
  predicate: (projection: MailboxProjection) => boolean,
): Promise<MailboxProjection> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const projection = await getJson<MailboxProjection>(`${baseUrl}/mailboxes/${mailboxId}`);
    if (predicate(projection)) {
      return projection;
    }
    await sleep(25);
  }

  throw new Error(`Timed out waiting for projection predicate on mailbox ${mailboxId}`);
}

async function getEvents(baseUrl: string, mailboxId: string): Promise<MailboxEvent[]> {
  const body = await getJson<{ events: MailboxEvent[] }>(`${baseUrl}/mailboxes/${mailboxId}/events`);
  return body.events;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return parseJsonResponse<T>(response);
}

async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response);
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T;
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAddressInfo(address: string | AddressInfo | null): address is AddressInfo {
  return typeof address === "object" && address !== null && "port" in address;
}
