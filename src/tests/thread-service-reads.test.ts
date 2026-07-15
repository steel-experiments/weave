import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Pool } from "pg";
import { newEventId, nowIso } from "../events.js";
import { migrate } from "../migrate.js";
import { PostgresThreadEngine } from "../postgres-engine.js";
import { ThreadQueryService } from "../thread-query-service.js";
import { ThreadService } from "../thread-service.js";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://dev:password@localhost:5432/dev";
const pool = new Pool({ connectionString, max: 2, connectionTimeoutMillis: 2_000 });

const TEST_ACTOR = { type: "user", id: "test-user" } as const;

try {
  await pool.query("select 1");
} catch (error) {
  await pool.end();
  console.log(`Thread service read tests skipped: ${errorMessage(error)}`);
  process.exit(0);
}

await migrate(pool);
const engine = new PostgresThreadEngine(pool);
const service = new ThreadService(engine);
const queries = new ThreadQueryService(engine);

after(async () => {
  await pool.end();
});

test("getSessionMetadata returns the session.started metadata", async () => {
  const { threadId } = await service.startSession({
    prompt: "hello",
    source: "api",
    agentName: "assistant",
    actor: TEST_ACTOR,
    metadata: { role: "dev", actor: "slack:U1" },
  });
  const meta = await service.getSessionMetadata(threadId);
  assert.equal(meta?.role, "dev");
  assert.equal(meta?.actor, "slack:U1");
});

test("getSessionMetadata returns null for an unknown thread", async () => {
  const meta = await service.getSessionMetadata(randomUUID());
  assert.equal(meta, null);
});

async function appendReply(
  engine: PostgresThreadEngine,
  threadId: string,
  message: string,
): Promise<void> {
  await engine.append([
    {
      eventId: newEventId(),
      threadId,
      type: "agent.reply.produced",
      occurredAt: nowIso(),
      correlationId: randomUUID(),
      actor: { type: "system", id: "test" },
      payload: { message },
    },
  ]);
}

async function appendNoise(
  engine: PostgresThreadEngine,
  threadId: string,
  count: number,
): Promise<void> {
  await engine.append(
    Array.from({ length: count }, (_, index) => ({
      eventId: newEventId(),
      threadId,
      type: "domain.event" as const,
      occurredAt: nowIso(),
      correlationId: randomUUID(),
      actor: { type: "system" as const, id: "test" },
      payload: { kind: "noise", data: { index } },
    })),
  );
}

async function appendCompleted(engine: PostgresThreadEngine, threadId: string): Promise<void> {
  await engine.append([
    {
      eventId: newEventId(),
      threadId,
      type: "agent.completed",
      occurredAt: nowIso(),
      correlationId: randomUUID(),
      actor: { type: "system", id: "test" },
      payload: { reason: "manual-complete" },
    },
  ]);
}

test("getEvents filters by type and preserves order", async () => {
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "assistant", actor: TEST_ACTOR });
  await appendReply(engine, threadId, "first");
  await appendReply(engine, threadId, "second");

  const all = await service.getEvents(threadId);
  assert.ok(all.length >= 4);

  const replies = await service.getEvents(threadId, { type: "agent.reply.produced" });
  assert.deepEqual(
    replies.map((event) => (event.type === "agent.reply.produced" ? event.payload.message : null)),
    ["first", "second"],
  );

  const limited = await service.getEvents(threadId, { type: "agent.reply.produced", limit: 1 });
  assert.equal(limited.length, 1);
  assert.equal(limited[0]?.type, "agent.reply.produced");
});

test("ThreadQueryService paginates filtered thread events with opaque cursors", async () => {
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "assistant", actor: TEST_ACTOR });
  await engine.append(
    Array.from({ length: 1000 }, (_, index) => ({
      eventId: newEventId(),
      threadId,
      type: "domain.event" as const,
      occurredAt: nowIso(),
      correlationId: randomUUID(),
      actor: { type: "system" as const, id: "test" },
      payload: { kind: "noise", data: { index } },
    })),
  );
  await appendReply(engine, threadId, "first");
  await appendReply(engine, threadId, "second");

  const first = await queries.listThreadEvents({
    threadId,
    types: ["agent.reply.produced"],
    limit: 1,
  });
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0]?.type === "agent.reply.produced" ? first.events[0].payload.message : null, "first");
  assert.ok(first.nextCursor);

  const second = await queries.listThreadEvents({
    threadId,
    types: ["agent.reply.produced"],
    cursor: first.nextCursor,
    limit: 1,
  });
  assert.equal(second.events.length, 1);
  assert.equal(second.events[0]?.type === "agent.reply.produced" ? second.events[0].payload.message : null, "second");
  assert.equal(second.nextCursor, null);

  await assert.rejects(
    queries.listThreadEvents({ threadId, cursor: "not-a-valid-cursor" }),
    /Invalid thread event cursor/,
  );
  await assert.rejects(
    queries.listThreadEvents({ threadId, limit: 1001 }),
    /Thread event page limit/,
  );
});

test("custom inbox routes can deliver host consumers", async () => {
  const consumer = `egress-${randomUUID()}`;
  const routedEngine = new PostgresThreadEngine(pool, {
    inboxRoutes(event) {
      return event.type === "agent.reply.produced" ? [{ consumer }] : [];
    },
  });
  const routedService = new ThreadService(routedEngine);
  const { threadId } = await routedService.startSession({ prompt: "p", source: "api", agentName: "assistant", actor: TEST_ACTOR });
  await appendReply(routedEngine, threadId, "egress me");

  const items = await routedEngine.claimInbox(consumer, "test-egress", 10, 10_000);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.threadId, threadId);
  const [event] = await routedEngine.read(threadId, { fromSeq: items[0]?.eventSeq, limit: 1 });
  assert.ok(event);
  assert.equal(event.type, "agent.reply.produced");
  assert.equal(event.type === "agent.reply.produced" ? event.payload.message : null, "egress me");

  await routedEngine.completeInbox(items.map((item) => item.id), "test-egress");
  assert.equal((await routedEngine.claimInbox(consumer, "test-egress", 10, 10_000)).length, 0);
});

test("ThreadQueryService lists and requeues dead-letter and stale claimed inbox items", async () => {
  const consumer = `ops-${randomUUID()}`;
  const routedEngine = new PostgresThreadEngine(pool, {
    inboxRoutes(event) {
      return event.type === "agent.reply.produced" ? [{ consumer }] : [];
    },
  });
  const routedService = new ThreadService(routedEngine);
  const routedQueries = new ThreadQueryService(routedEngine);

  const deadLetterSession = await routedService.startSession({ prompt: "p", source: "api", agentName: "assistant", actor: TEST_ACTOR });
  await appendReply(routedEngine, deadLetterSession.threadId, "dead letter me");
  const [deadLetterItem] = await routedEngine.claimInbox(consumer, "dead-letter-owner", 10, 10_000);
  assert.ok(deadLetterItem);
  await routedEngine.deadLetterInbox([deadLetterItem.id], "dead-letter-owner", "TEST_DEAD", "dead");

  const staleSession = await routedService.startSession({ prompt: "p", source: "api", agentName: "assistant", actor: TEST_ACTOR });
  await appendReply(routedEngine, staleSession.threadId, "stale me");
  const [staleItem] = await routedEngine.claimInbox(consumer, "stale-owner", 10, -60_000);
  assert.ok(staleItem);

  const deadLetters = await routedQueries.listThreadInboxItems({
    ids: [deadLetterItem.id],
    states: ["dead-letter"],
    consumers: [consumer],
  });
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0]?.threadId, deadLetterSession.threadId);
  assert.equal(deadLetters[0]?.lastErrorCode, "TEST_DEAD");
  assert.equal(await routedQueries.countThreadInboxItems({ states: ["dead-letter"], consumers: [consumer] }), 1);

  const staleClaims = await routedQueries.listThreadInboxItems({
    ids: [staleItem.id],
    states: ["claimed"],
    consumers: [consumer],
    claimedUntilBefore: nowIso(),
  });
  assert.equal(staleClaims.length, 1);
  assert.equal(staleClaims[0]?.threadId, staleSession.threadId);
  assert.equal(staleClaims[0]?.claimedBy, "stale-owner");

  const requeued = await routedEngine.requeueThreadInboxItems({
    ids: [deadLetterItem.id, staleItem.id],
    states: ["dead-letter", "claimed"],
    resetAttempts: true,
  });
  assert.equal(requeued.length, 2);
  assert.deepEqual(
    requeued.map((item) => item.state),
    ["pending", "pending"],
  );
  assert.deepEqual(
    requeued.map((item) => item.attempts),
    [0, 0],
  );
  assert.equal(
    await routedQueries.countThreadInboxItems({ states: ["dead-letter"], consumers: [consumer] }),
    0,
  );

  const claimedAgain = await routedEngine.claimInbox(consumer, "retry-owner", 10, 10_000);
  assert.equal(claimedAgain.length, 2);
  assert.deepEqual(
    claimedAgain.map((item) => item.threadId).sort(),
    [deadLetterSession.threadId, staleSession.threadId].sort(),
  );
});

test("getLatestReply returns the newest reply message", async () => {
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "assistant", actor: TEST_ACTOR });
  assert.equal(await service.getLatestReply(threadId), null);

  await appendReply(engine, threadId, "turn-1");
  await appendReply(engine, threadId, "final");

  const latest = await service.getLatestReply(threadId);
  assert.equal(latest?.message, "final");
  assert.ok(latest?.eventId);
  assert.ok(latest?.occurredAt);
});

test("listOpenGates returns open gates and excludes resolved ones", async () => {
  const { threadId } = await service.startSession({
    prompt: "p",
    source: "api",
    agentName: "assistant",
    actor: TEST_ACTOR,
  });
  const gateId = randomUUID();
  await engine.append([
    {
      eventId: newEventId(),
      threadId,
      type: "gate.created",
      occurredAt: nowIso(),
      correlationId: randomUUID(),
      scopeKey: "agent:assistant",
      stepKey: "approval:42",
      actor: { type: "system", id: "test" },
      payload: {
        gateId,
        gateType: "manual-approval",
        reason: "tool-result-requires-approval",
        proposedAction: "PUT repos/o/r/pulls/1/merge",
      },
    },
  ]);

  let open = await service.listOpenGates(threadId);
  assert.equal(open.length, 1);
  const gate = open[0];
  assert.ok(gate);
  assert.equal(gate.gateId, gateId);
  assert.equal(gate.stepKey, "approval:42");
  assert.equal(gate.proposedAction, "PUT repos/o/r/pulls/1/merge");

  await service.resolveGate(threadId, gateId, "approved", TEST_ACTOR, "ok");
  open = await service.listOpenGates(threadId);
  assert.equal(open.length, 0);
});

test("resolveGate is idempotent under concurrent repeated resolution", async () => {
  const { threadId } = await service.startSession({
    prompt: "p",
    source: "api",
    agentName: "assistant",
    actor: TEST_ACTOR,
  });
  const gateId = randomUUID();
  await engine.append([
    {
      eventId: newEventId(),
      threadId,
      type: "gate.created",
      occurredAt: nowIso(),
      correlationId: randomUUID(),
      scopeKey: "agent:assistant",
      stepKey: "approval:concurrent",
      actor: { type: "system", id: "test" },
      payload: {
        gateId,
        gateType: "manual-approval",
        reason: "tool-result-requires-approval",
        proposedAction: "PUT repos/o/r/pulls/1/merge",
      },
    },
  ]);

  await Promise.all([
    service.resolveGate(threadId, gateId, "approved", { type: "human", id: "operator-a" }),
    service.resolveGate(threadId, gateId, "approved", { type: "human", id: "operator-b" }),
  ]);

  const events = await engine.readAll(threadId);
  const resolved = events.filter((event) => event.type === "gate.resolved" && event.payload.gateId === gateId);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.type === "gate.resolved" ? resolved[0].payload.resolution : null, "approved");
});

test("resolveGate rejects concurrent conflicting resolution", async () => {
  const { threadId } = await service.startSession({
    prompt: "p",
    source: "api",
    agentName: "assistant",
    actor: TEST_ACTOR,
  });
  const gateId = randomUUID();
  await engine.append([
    {
      eventId: newEventId(),
      threadId,
      type: "gate.created",
      occurredAt: nowIso(),
      correlationId: randomUUID(),
      scopeKey: "agent:assistant",
      stepKey: "approval:conflict",
      actor: { type: "system", id: "test" },
      payload: {
        gateId,
        gateType: "manual-approval",
        reason: "tool-result-requires-approval",
        proposedAction: "PUT repos/o/r/pulls/1/merge",
      },
    },
  ]);

  const results = await Promise.allSettled([
    service.resolveGate(threadId, gateId, "approved", { type: "human", id: "operator-a" }),
    service.resolveGate(threadId, gateId, "denied", { type: "human", id: "operator-b" }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const events = await engine.readAll(threadId);
  const resolved = events.filter((event) => event.type === "gate.resolved" && event.payload.gateId === gateId);
  assert.equal(resolved.length, 1);
});

test("ThreadQueryService lists thread heads with metadata and children", async () => {
  const parent = await service.startSession({
    prompt: "parent",
    source: "api",
    agentName: "assistant",
    actor: TEST_ACTOR,
    metadata: { role: "default", prompt: "parent brief" },
  });
  const child = await service.startChildSession({
    parentThreadId: parent.threadId,
    agentName: "assistant",
    input: { role: "reviewer", prompt: "review brief" },
    prompt: "review brief",
    idempotencyKey: `review-${randomUUID()}`,
  });

  const head = await queries.getThreadHead(parent.threadId);
  assert.equal(head?.threadId, parent.threadId);
  assert.equal(head?.metadata?.role, "default");

  const children = await queries.listThreadHeads({
    parentThreadId: parent.threadId,
    orderBy: "created_asc",
  });
  assert.equal(children.length, 1);
  assert.equal(children[0]?.threadId, child.threadId);
  assert.equal(children[0]?.metadata?.role, "reviewer");
});

test("ThreadQueryService lists ancestors from child to root", async () => {
  const parent = await service.startSession({
    prompt: "root",
    source: "api",
    agentName: "assistant",
    actor: TEST_ACTOR,
    metadata: { prompt: "root" },
  });
  const child = await service.startChildSession({
    parentThreadId: parent.threadId,
    agentName: "assistant",
    input: { prompt: "child" },
    prompt: "child",
    idempotencyKey: `child-${randomUUID()}`,
  });

  const chain = await queries.listThreadAncestors(child.threadId);
  assert.equal(chain[0]?.threadId, child.threadId);
  assert.equal(chain[0]?.depth, 0);
  assert.equal(chain[1]?.threadId, parent.threadId);
  assert.equal(chain[1]?.depth, 1);
});

test("ThreadQueryService finds latest child reply by metadata", async () => {
  const parent = await service.startSession({ prompt: "parent", source: "api", agentName: "assistant", actor: TEST_ACTOR });
  const reviewer = await service.startChildSession({
    parentThreadId: parent.threadId,
    agentName: "assistant",
    input: { role: "reviewer" },
    prompt: "review",
    idempotencyKey: `reviewer-${randomUUID()}`,
  });
  const dev = await service.startChildSession({
    parentThreadId: parent.threadId,
    agentName: "assistant",
    input: { role: "dev" },
    prompt: "dev",
    idempotencyKey: `dev-${randomUUID()}`,
  });
  await appendReply(engine, dev.threadId, "dev done");
  await appendCompleted(engine, dev.threadId);
  await appendReply(engine, reviewer.threadId, "looks good");
  await appendCompleted(engine, reviewer.threadId);

  const replies = await queries.listLatestChildRepliesByMetadata({
    parentThreadIds: [parent.threadId],
    metadata: { role: "reviewer" },
    statuses: ["completed"],
  });

  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.parentThreadId, parent.threadId);
  assert.equal(replies[0]?.childThreadId, reviewer.threadId);
  assert.equal(replies[0]?.summary, "looks good");
});

test("ThreadQueryService lists recent events with a total count", async () => {
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "assistant", actor: TEST_ACTOR });
  await engine.append([
    {
      eventId: newEventId(),
      threadId,
      type: "tool.failed",
      occurredAt: nowIso(),
      correlationId: randomUUID(),
      actor: { type: "system", id: "test" },
      payload: {
        toolCallId: randomUUID(),
        toolName: "github",
        errorCode: "BOOM",
        message: "failed",
      },
    },
  ]);

  const result = await queries.listRecentEvents({ types: ["tool.failed"], limit: 1 });
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.type, "tool.failed");
  assert.equal(result.events[0]?.type === "tool.failed" ? result.events[0].payload.toolName : null, "github");
  assert.ok(result.total >= 1);
});

test("ThreadQueryService summarizes failed threads with latest failure metadata", async () => {
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "assistant", actor: TEST_ACTOR });
  await engine.append([
    {
      eventId: newEventId(),
      threadId,
      type: "tool.failed",
      occurredAt: nowIso(),
      correlationId: randomUUID(),
      actor: { type: "system", id: "test" },
      payload: {
        toolCallId: randomUUID(),
        toolName: "github",
        errorCode: "BROKEN",
        message: "broken",
      },
    },
  ]);

  const summaries = await queries.listThreadHealthSummaries({
    threadId,
    statuses: ["failed"],
    latestEventTypes: ["tool.failed", "agent.failed"],
  });
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.threadId, threadId);
  assert.equal(summaries[0]?.latestEventType, "tool.failed");
  assert.equal(summaries[0]?.errorCode, "BROKEN");
  assert.equal(summaries[0]?.message, "broken");
  assert.equal(await queries.countThreadHealthSummaries({ threadId, statuses: ["failed"] }), 1);
});

test("reads stay correct past 1000 events", async () => {
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "assistant", actor: TEST_ACTOR });
  await appendNoise(engine, threadId, 1200);
  await appendReply(engine, threadId, "late-reply");

  const all = await engine.readAll(threadId);
  assert.ok(all.length >= 1203);
  assert.equal(all.at(-1)?.type, "agent.reply.produced");

  const replies = await engine.readAll(threadId, { types: ["agent.reply.produced"] });
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.type === "agent.reply.produced" ? replies[0].payload.message : null, "late-reply");

  const latest = await service.getLatestReply(threadId);
  assert.equal(latest?.message, "late-reply");

  const events = await service.getEvents(threadId);
  assert.equal(events.length, all.length);
});

test("idempotent appendEvent finds its duplicate past 1000 events", async () => {
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "assistant", actor: TEST_ACTOR });
  const input = {
    threadId,
    type: "agent.reply.produced" as const,
    idempotencyKey: "reply:dup",
    actor: { type: "system" as const, id: "test" },
    payload: { message: "original" },
  };
  const first = await service.appendEvent(input);
  await appendNoise(engine, threadId, 1200);

  const again = await service.appendEvent(input);
  assert.equal(again.eventId, first.eventId);
  assert.equal(again.payload.message, "original");
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
