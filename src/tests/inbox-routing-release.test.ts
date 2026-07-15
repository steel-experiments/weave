import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Pool } from "pg";
import { newEventId, nowIso, type ThreadEvent } from "../events.js";
import { migrate } from "../migrate.js";
import { PostgresThreadEngine } from "../postgres-engine.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://dev:password@localhost:5432/dev";
const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 2_000 });

try {
  await pool.query("select 1");
} catch (error) {
  await pool.end();
  console.log(`Inbox routing/release tests skipped: ${errorMessage(error)}`);
  process.exit(0);
}

await migrate(pool);

after(async () => {
  await pool.end();
});

function promptEvent(threadId: string): ThreadEvent {
  return {
    eventId: newEventId(),
    threadId,
    type: "prompt.received",
    occurredAt: nowIso(),
    correlationId: randomUUID(),
    actor: { type: "user", id: "test-user" },
    payload: { prompt: "hello" },
  };
}

function toolCompletedEvent(threadId: string): ThreadEvent {
  return {
    eventId: newEventId(),
    threadId,
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: randomUUID(),
    actor: { type: "system", id: "test" },
    payload: { toolCallId: randomUUID(), output: { ok: true } },
  };
}

test("without a resolver the kernel default routing applies", async () => {
  const engine = new PostgresThreadEngine(pool);
  const threadId = randomUUID();
  await engine.createThread(threadId);
  await engine.append([promptEvent(threadId), toolCompletedEvent(threadId)]);

  const items = await engine.listInbox(threadId);
  assert.deepEqual(
    items.map((item) => item.consumer),
    ["runner", "runner"],
  );
});

test("a provided resolver is authoritative and default routes do not apply", async () => {
  const engine = new PostgresThreadEngine(pool, {
    inboxRoutes(event) {
      return event.type === "prompt.received" ? [{ consumer: "runner" }] : [];
    },
  });
  const threadId = randomUUID();
  await engine.createThread(threadId);
  await engine.append([promptEvent(threadId), toolCompletedEvent(threadId)]);

  const items = await engine.listInbox(threadId);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.consumer, "runner");
  assert.equal(items[0]?.eventSeq, 0);
});

function isolatedEngine(consumer: string): PostgresThreadEngine {
  return new PostgresThreadEngine(pool, {
    inboxRoutes(event) {
      return event.type === "prompt.received" ? [{ consumer }] : [];
    },
  });
}

test("releaseInbox returns a claimed item to pending only for its owner", async () => {
  const consumer = `test-consumer-${randomUUID()}`;
  const engine = isolatedEngine(consumer);
  const threadId = randomUUID();
  await engine.createThread(threadId);
  await engine.append([promptEvent(threadId)]);

  const owner = `owner-${randomUUID()}`;
  const claimed = await engine.claimInbox(consumer, owner, 10, 60_000);
  assert.equal(claimed.length, 1);
  const item = claimed[0];
  assert.ok(item);
  assert.equal(item.attempts, 1);

  await engine.releaseInbox([item.id], "someone-else");
  let rows = await engine.listInbox(threadId);
  assert.equal(rows[0]?.state, "claimed");

  await engine.releaseInbox([item.id], owner);
  rows = await engine.listInbox(threadId);
  assert.equal(rows[0]?.state, "pending");
  assert.equal(rows[0]?.claimedBy, null);
  assert.equal(rows[0]?.attempts, 1);

  const reclaimed = await engine.claimInbox(consumer, owner, 10, 60_000);
  assert.equal(reclaimed.length, 1);
  assert.equal(reclaimed[0]?.attempts, 2);
});

test("releaseInbox with a future visibleAt defers the next claim", async () => {
  const consumer = `test-consumer-${randomUUID()}`;
  const engine = isolatedEngine(consumer);
  const threadId = randomUUID();
  await engine.createThread(threadId);
  await engine.append([promptEvent(threadId)]);

  const owner = `owner-${randomUUID()}`;
  const claimed = await engine.claimInbox(consumer, owner, 10, 60_000);
  const item = claimed[0];
  assert.ok(item);

  const future = new Date(Date.now() + 60_000).toISOString();
  await engine.releaseInbox([item.id], owner, future);

  const rows = await engine.listInbox(threadId);
  assert.equal(rows[0]?.state, "pending");
  assert.equal(rows[0]?.visibleAt, new Date(future).toISOString());

  const reclaimed = await engine.claimInbox(consumer, owner, 50, 60_000);
  assert.equal(reclaimed.length, 0);
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
