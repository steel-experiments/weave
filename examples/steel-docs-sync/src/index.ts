import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import {
  ContractToolWorker,
  MailboxRunner,
  MailboxService,
  PostgresMailboxEngine,
  RunnerDaemon,
  ToolWorkerDaemon,
  createApiServer,
  createPool,
  getAgent,
  migrate,
  type MailboxEvent,
  type MailboxProjection,
} from "@agent-mailbox/core";
import { steelDocsSyncApp } from "./app.js";

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
  const activeAgent = getAgent(steelDocsSyncApp, "steel-docs");
  const runnerDaemon = new RunnerDaemon(engine, new MailboxRunner(engine, engine, activeAgent.planner), 25);
  const toolDaemon = new ToolWorkerDaemon(engine, new ContractToolWorker(engine, activeAgent.tools), 25);
  runnerDaemon.start();
  toolDaemon.start();

  try {
    const created = await postJson<{ mailboxId: string; correlationId: string }>(`${baseUrl}/mailboxes`, {
      prompt: "@steel-docs audit production drift for steel-dev/docs and summarize warnings.",
    });

    const finalProjection = await waitForProjection(baseUrl, created.mailboxId, (projection) => {
      return projection.status === "completed";
    });
    const events = await getEvents(baseUrl, created.mailboxId);

    assert.deepEqual(
      events.filter((event) => event.type === "tool.requested").map((event) => event.payload.toolName),
      ["steel.auditDocsSync"],
    );
    assert.equal(finalProjection.status, "completed");
    assert.equal(finalProjection.pendingGateIds.length, 0);
    assert.equal(events.length, finalProjection.tailSeq);
    assert.equal(events.filter((event) => event.type === "agent.finding.produced").length, 2);

    const toolCompleted = events.find((event) => event.type === "tool.completed");
    const finalResponse = events.find((event) => event.type === "agent.response.produced");
    assert(toolCompleted);
    assert(finalResponse);

    console.log("Steel docs sync demo verified");
    console.log(`api=${baseUrl}`);
    console.log(`mailboxId=${created.mailboxId}`);
    console.log(`app=${steelDocsSyncApp.name}`);
    console.log(`agent=${activeAgent.name}`);
    console.log(`tool=${activeAgent.tools[0]?.name ?? "unknown"}`);
    console.log(`auditSummary=${toolCompleted.payload.output.summary}`);
    console.log(`finalMessage=${finalResponse.payload.message}`);
  } finally {
    await runnerDaemon.stop();
    await toolDaemon.stop();
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
  const deadline = Date.now() + 8_000;

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
