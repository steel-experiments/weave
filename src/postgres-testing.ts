import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresThreadEngine } from "./postgres-engine.js";
import type { ThreadStatus } from "./events.js";

export type CreateTestThreadProjectionOptions = {
  threadId: string;
  status?: ThreadStatus;
  nextSeq?: number;
  parentThreadId?: string | null;
  rootThreadId?: string | null;
  parentScopeKey?: string | null;
  parentStepKey?: string | null;
};

export type AppendTestGateOptions = {
  threadId: string;
  gateId?: string;
  scopeKey?: string;
  stepKey: string;
  reason?: "tool-result-requires-approval" | "policy-approval-required" | "custom";
  proposedAction?: string;
};

export async function truncateWeaveForTest(pool: Pool): Promise<void> {
  await pool.query("truncate weave.thread cascade");
}

export async function createTestThreadProjection(
  pool: Pool,
  options: CreateTestThreadProjectionOptions,
): Promise<void> {
  await pool.query("delete from weave.thread where id = $1", [options.threadId]);
  await pool.query(
    `insert into weave.thread(
       id,
       status,
       next_seq,
       parent_thread_id,
       root_thread_id,
       parent_scope_key,
       parent_step_key
     )
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      options.threadId,
      options.status ?? "idle",
      options.nextSeq ?? 0,
      options.parentThreadId ?? null,
      options.rootThreadId ?? options.threadId,
      options.parentScopeKey ?? null,
      options.parentStepKey ?? null,
    ],
  );
}

export async function appendTestGate(
  pool: Pool,
  options: AppendTestGateOptions,
): Promise<{ gateId: string }> {
  const gateId = options.gateId ?? randomUUID();
  const engine = new PostgresThreadEngine(pool);
  await engine.append([
    {
      eventId: randomUUID(),
      threadId: options.threadId,
      type: "gate.created",
      occurredAt: new Date().toISOString(),
      correlationId: randomUUID(),
      scopeKey: options.scopeKey ?? "root",
      stepKey: options.stepKey,
      actor: { type: "system", id: "weave-test" },
      payload: {
        gateId,
        gateType: "manual-approval",
        reason: options.reason ?? "tool-result-requires-approval",
        proposedAction: options.proposedAction,
      },
    },
  ]);
  return { gateId };
}
