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
