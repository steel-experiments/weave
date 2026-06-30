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
    agentName: "blade",
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
  type: "agent.reply.produced" | "agent.response.produced",
  message: string,
): Promise<void> {
  await engine.append([
    {
      eventId: newEventId(),
      threadId,
      type,
      occurredAt: nowIso(),
      correlationId: randomUUID(),
      actor: { type: "system", id: "test" },
      payload: { message },
    },
  ]);
}

test("getEvents filters by type and preserves order", async () => {
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "blade" });
  await appendReply(engine, threadId, "agent.reply.produced", "first");
  await appendReply(engine, threadId, "agent.reply.produced", "second");

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
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "blade" });
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
  await appendReply(engine, threadId, "agent.reply.produced", "first");
  await appendReply(engine, threadId, "agent.reply.produced", "second");

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
  const { threadId } = await routedService.startSession({ prompt: "p", source: "api", agentName: "blade" });
  await appendReply(routedEngine, threadId, "agent.reply.produced", "egress me");

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

test("ThreadQueryService lists dead-letter and stale claimed inbox items", async () => {
  const consumer = `ops-${randomUUID()}`;
  const routedEngine = new PostgresThreadEngine(pool, {
    inboxRoutes(event) {
      return event.type === "agent.reply.produced" ? [{ consumer }] : [];
    },
  });
  const routedService = new ThreadService(routedEngine);
  const routedQueries = new ThreadQueryService(routedEngine);

  const deadLetterSession = await routedService.startSession({ prompt: "p", source: "api", agentName: "blade" });
  await appendReply(routedEngine, deadLetterSession.threadId, "agent.reply.produced", "dead letter me");
  const [deadLetterItem] = await routedEngine.claimInbox(consumer, "dead-letter-owner", 10, 10_000);
  assert.ok(deadLetterItem);
  await routedEngine.deadLetterInbox([deadLetterItem.id], "dead-letter-owner", "TEST_DEAD", "dead");

  const staleSession = await routedService.startSession({ prompt: "p", source: "api", agentName: "blade" });
  await appendReply(routedEngine, staleSession.threadId, "agent.reply.produced", "stale me");
  const [staleItem] = await routedEngine.claimInbox(consumer, "stale-owner", 10, -60_000);
  assert.ok(staleItem);

  const deadLetters = await routedQueries.listThreadInboxItems({
    states: ["dead-letter"],
    consumers: [consumer],
  });
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0]?.threadId, deadLetterSession.threadId);
  assert.equal(deadLetters[0]?.lastErrorCode, "TEST_DEAD");
  assert.equal(await routedQueries.countThreadInboxItems({ states: ["dead-letter"], consumers: [consumer] }), 1);

  const staleClaims = await routedQueries.listThreadInboxItems({
    states: ["claimed"],
    consumers: [consumer],
    claimedUntilBefore: nowIso(),
  });
  assert.equal(staleClaims.length, 1);
  assert.equal(staleClaims[0]?.threadId, staleSession.threadId);
  assert.equal(staleClaims[0]?.claimedBy, "stale-owner");
});

test("getLatestReply returns the newest reply or response message", async () => {
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "blade" });
  assert.equal(await service.getLatestReply(threadId), null);

  await appendReply(engine, threadId, "agent.reply.produced", "turn-1");
  await appendReply(engine, threadId, "agent.response.produced", "final");

  const latest = await service.getLatestReply(threadId);
  assert.equal(latest?.message, "final");
  assert.ok(latest?.eventId);
  assert.ok(latest?.occurredAt);
});

test("listOpenGates returns open gates and excludes resolved ones", async () => {
  const { threadId } = await service.startSession({
    prompt: "p",
    source: "api",
    agentName: "blade",
  });
  const gateId = randomUUID();
  await engine.append([
    {
      eventId: newEventId(),
      threadId,
      type: "gate.created",
      occurredAt: nowIso(),
      correlationId: randomUUID(),
      scopeKey: "agent:blade",
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

  await service.resolveGate(threadId, gateId, "approved", "ok");
  open = await service.listOpenGates(threadId);
  assert.equal(open.length, 0);
});

test("ThreadQueryService lists thread heads with metadata and children", async () => {
  const parent = await service.startSession({
    prompt: "parent",
    source: "api",
    agentName: "blade",
    metadata: { role: "default", prompt: "parent brief" },
  });
  const child = await service.startChildSession({
    parentThreadId: parent.threadId,
    agentName: "blade",
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
    agentName: "blade",
    metadata: { prompt: "root" },
  });
  const child = await service.startChildSession({
    parentThreadId: parent.threadId,
    agentName: "blade",
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
  const parent = await service.startSession({ prompt: "parent", source: "api", agentName: "blade" });
  const reviewer = await service.startChildSession({
    parentThreadId: parent.threadId,
    agentName: "blade",
    input: { role: "reviewer" },
    prompt: "review",
    idempotencyKey: `reviewer-${randomUUID()}`,
  });
  const dev = await service.startChildSession({
    parentThreadId: parent.threadId,
    agentName: "blade",
    input: { role: "dev" },
    prompt: "dev",
    idempotencyKey: `dev-${randomUUID()}`,
  });
  await appendReply(engine, dev.threadId, "agent.response.produced", "dev done");
  await appendReply(engine, reviewer.threadId, "agent.response.produced", "looks good");

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
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "blade" });
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
  const { threadId } = await service.startSession({ prompt: "p", source: "api", agentName: "blade" });
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
