import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { Pool } from "pg";
import { newEventId, nowIso } from "../events.js";
import { migrate } from "../migrate.js";
import { PostgresThreadEngine } from "../postgres-engine.js";
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
