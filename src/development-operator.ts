import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { z } from "zod";
import { DevelopmentCheckpointKeys, InitiativePlanSchema, SourceCheckpointRestoredSchema, SourceCheckpointSchema, developmentEvents } from "./development-orchestrator.js";
import { ThreadEventSchema, newEventId, nowIso, type ThreadEvent } from "./events.js";
import { PostgresThreadEngine } from "./postgres-engine.js";
import { ThreadService } from "./thread-service.js";

const NonEmptyStringSchema = z.string().min(1);
const execFileAsync = promisify(execFile);

export const OperatorGateSummarySchema = z.object({
  gateId: NonEmptyStringSchema,
  threadId: NonEmptyStringSchema,
  status: z.enum(["pending", "resolved"]),
  gateType: NonEmptyStringSchema,
  reason: NonEmptyStringSchema.optional(),
  proposedAction: z.string().optional(),
  createdAt: NonEmptyStringSchema,
  resolvedAt: NonEmptyStringSchema.optional(),
  resolution: z.enum(["approved", "denied"]).optional(),
  comment: z.string().optional(),
});
export type OperatorGateSummary = z.infer<typeof OperatorGateSummarySchema>;

export const OperatorInitiativeSummarySchema = z.object({
  threadId: NonEmptyStringSchema,
  status: NonEmptyStringSchema,
  title: NonEmptyStringSchema.optional(),
  repo: NonEmptyStringSchema.optional(),
  workingBranch: NonEmptyStringSchema.optional(),
  pendingGateCount: z.number().int().nonnegative(),
  updatedAt: NonEmptyStringSchema,
});
export type OperatorInitiativeSummary = z.infer<typeof OperatorInitiativeSummarySchema>;

export const OperatorInitiativeStatusSchema = OperatorInitiativeSummarySchema.extend({
  currentSlice: z
    .object({
      sliceId: NonEmptyStringSchema,
      title: NonEmptyStringSchema,
      status: NonEmptyStringSchema,
    })
    .optional(),
  childThreads: z.array(
    z.object({
      threadId: NonEmptyStringSchema,
      status: NonEmptyStringSchema,
      parentThreadId: NonEmptyStringSchema.nullable(),
      agentName: NonEmptyStringSchema.optional(),
    }),
  ),
  pendingGates: z.array(OperatorGateSummarySchema),
  recentEvents: z.array(
    z.object({
      seq: z.number().int().nonnegative().optional(),
      type: NonEmptyStringSchema,
      actor: NonEmptyStringSchema,
    }),
  ),
});
export type OperatorInitiativeStatus = z.infer<typeof OperatorInitiativeStatusSchema>;

export const OperatorSourceCheckpointSummarySchema = z.object({
  checkpointId: NonEmptyStringSchema,
  initiativeThreadId: NonEmptyStringSchema,
  sliceThreadId: NonEmptyStringSchema,
  sliceId: NonEmptyStringSchema,
  title: NonEmptyStringSchema.optional(),
  workspaceRef: SourceCheckpointSchema.shape.workspaceRef,
  workspacePath: NonEmptyStringSchema,
  workingBranch: NonEmptyStringSchema,
  baseSha: NonEmptyStringSchema,
  checkpointSha: NonEmptyStringSchema,
  changedFiles: z.array(NonEmptyStringSchema),
  commitMessage: NonEmptyStringSchema,
  createdAt: NonEmptyStringSchema.optional(),
  eventThreadId: NonEmptyStringSchema,
  eventSeq: z.number().int().nonnegative().optional(),
  diffCommand: NonEmptyStringSchema,
});
export type OperatorSourceCheckpointSummary = z.infer<typeof OperatorSourceCheckpointSummarySchema>;

export const OperatorSourceCheckpointRestoreResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("restored"),
    checkpoint: OperatorSourceCheckpointSummarySchema,
    fromSha: NonEmptyStringSchema,
    restoredSha: NonEmptyStringSchema,
    dirtyBefore: z.boolean(),
    forced: z.boolean(),
    auditThreadId: NonEmptyStringSchema.optional(),
  }),
  z.object({
    status: z.literal("blocked"),
    checkpoint: OperatorSourceCheckpointSummarySchema.optional(),
    reason: NonEmptyStringSchema,
    currentSha: NonEmptyStringSchema.optional(),
    dirty: z.boolean().optional(),
    changedFiles: z.array(NonEmptyStringSchema).default([]),
  }),
]);
export type OperatorSourceCheckpointRestoreResult = z.infer<typeof OperatorSourceCheckpointRestoreResultSchema>;

export async function listPendingGates(pool: Pool): Promise<OperatorGateSummary[]> {
  const result = await pool.query<GateRow>(
    `select
       g.gate_id::text,
       g.thread_id,
       g.status,
       g.gate_type,
       g.created_at,
       g.resolved_at,
       g.resolution_json,
       e.payload_json as created_payload
     from weave.thread_gate g
     left join weave.thread_event e
       on e.thread_id = g.thread_id
      and e.type = 'gate.created'
      and e.payload_json->>'gateId' = g.gate_id::text
     where g.status = 'pending'
     order by g.created_at asc`,
  );
  return result.rows.map(gateSummaryFromRow);
}

export async function getGate(pool: Pool, gateId: string): Promise<OperatorGateSummary | undefined> {
  const result = await pool.query<GateRow>(
    `select
       g.gate_id::text,
       g.thread_id,
       g.status,
       g.gate_type,
       g.created_at,
       g.resolved_at,
       g.resolution_json,
       e.payload_json as created_payload
     from weave.thread_gate g
     left join weave.thread_event e
       on e.thread_id = g.thread_id
      and e.type = 'gate.created'
      and e.payload_json->>'gateId' = g.gate_id::text
     where g.gate_id = $1
     limit 1`,
    [gateId],
  );
  const row = result.rows[0];
  return row ? gateSummaryFromRow(row) : undefined;
}

export async function listInitiatives(pool: Pool, limit = 20): Promise<OperatorInitiativeSummary[]> {
  const result = await pool.query<InitiativeRow>(
    `select
       t.id as thread_id,
       t.status,
       t.updated_at,
       count(g.gate_id) filter (where g.status = 'pending')::int as pending_gate_count,
       started.payload_json as started_payload,
       spec.payload_json as spec_payload
     from weave.thread t
     left join weave.thread_gate g on g.thread_id = t.id
     left join lateral (
       select payload_json
       from weave.thread_event e
       where e.thread_id = t.id and e.type = 'dev.initiative.started'
       order by e.seq desc
       limit 1
     ) started on true
     left join lateral (
       select payload_json
       from weave.thread_event e
       where e.thread_id = t.id and e.type = 'dev.initiative.spec_received'
       order by e.seq desc
       limit 1
     ) spec on true
     where started.payload_json is not null or spec.payload_json is not null
     group by t.id, t.status, t.updated_at, started.payload_json, spec.payload_json
     order by t.updated_at desc
     limit $1`,
    [limit],
  );
  return result.rows.map(initiativeSummaryFromRow);
}

export async function getInitiativeStatus(pool: Pool, threadId: string): Promise<OperatorInitiativeStatus | undefined> {
  const thread = await pool.query<InitiativeRow>(
    `select
       t.id as thread_id,
       t.status,
       t.updated_at,
       count(g.gate_id) filter (where g.status = 'pending')::int as pending_gate_count,
       started.payload_json as started_payload,
       spec.payload_json as spec_payload
     from weave.thread t
     left join weave.thread_gate g on g.thread_id = t.id
     left join lateral (
       select payload_json
       from weave.thread_event e
       where e.thread_id = t.id and e.type = 'dev.initiative.started'
       order by e.seq desc
       limit 1
     ) started on true
     left join lateral (
       select payload_json
       from weave.thread_event e
       where e.thread_id = t.id and e.type = 'dev.initiative.spec_received'
       order by e.seq desc
       limit 1
     ) spec on true
     where t.id = $1
     group by t.id, t.status, t.updated_at, started.payload_json, spec.payload_json`,
    [threadId],
  );
  const row = thread.rows[0];
  if (!row) {
    return undefined;
  }

  const [pendingGates, childThreads, eventRows] = await Promise.all([
    pendingGatesForThread(pool, threadId),
    childThreadsForInitiative(pool, threadId),
    recentEventsForThread(pool, threadId),
  ]);
  const events = eventRows.map((eventRow) => ThreadEventSchema.parse(eventRow.event_json));
  const summary = initiativeSummaryFromRow(row);

  return OperatorInitiativeStatusSchema.parse({
    ...summary,
    currentSlice: currentSliceFromEvents(events),
    childThreads,
    pendingGates,
    recentEvents: events.slice(-10).reverse().map((event) => ({
      seq: event.seq,
      type: event.type,
      actor: `${event.actor.type}:${event.actor.id}`,
    })),
  });
}

export async function listSourceCheckpoints(pool: Pool, initiativeThreadId: string): Promise<OperatorSourceCheckpointSummary[]> {
  const result = await pool.query<SourceCheckpointRow>(
    `select
       e.thread_id as event_thread_id,
       e.seq as event_seq,
       e.payload_json->'value' as checkpoint_payload
     from weave.thread_event e
     join weave.thread t on t.id = e.thread_id
     where (t.id = $1 or t.root_thread_id = $1)
       and e.type = 'checkpoint.completed'
       and e.payload_json->>'stepKey' like $2
     order by e.occurred_at asc, e.seq asc`,
    [initiativeThreadId, `${DevelopmentCheckpointKeys.sourceCheckpoint}:%`],
  );
  return result.rows.map(sourceCheckpointSummaryFromRow);
}

export async function getSourceCheckpoint(pool: Pool, checkpointIdOrSha: string): Promise<OperatorSourceCheckpointSummary | undefined> {
  const result = await pool.query<SourceCheckpointRow>(
    `select
       e.thread_id as event_thread_id,
       e.seq as event_seq,
       e.payload_json->'value' as checkpoint_payload
     from weave.thread_event e
     where e.type = 'checkpoint.completed'
       and e.payload_json->>'stepKey' like $1
       and (
         e.payload_json->'value'->>'checkpointId' = $2
         or e.payload_json->'value'->>'checkpointSha' = $2
         or left(e.payload_json->'value'->>'checkpointSha', length($2)) = $2
       )
     order by e.occurred_at desc, e.seq desc
     limit 1`,
    [`${DevelopmentCheckpointKeys.sourceCheckpoint}:%`, checkpointIdOrSha],
  );
  const row = result.rows[0];
  return row ? sourceCheckpointSummaryFromRow(row) : undefined;
}

export async function restoreSourceCheckpoint(input: {
  pool: Pool;
  checkpointIdOrSha: string;
  confirmed: boolean;
  force?: boolean;
  actorId?: string;
}): Promise<OperatorSourceCheckpointRestoreResult> {
  const checkpoint = await getSourceCheckpoint(input.pool, input.checkpointIdOrSha);
  if (!checkpoint) {
    throw new Error(`Source checkpoint not found: ${input.checkpointIdOrSha}`);
  }

  const restore = await restoreSourceCheckpointWorktree(checkpoint, { confirmed: input.confirmed, force: input.force ?? false });
  if (restore.status !== "restored") {
    return restore;
  }

  const payload = SourceCheckpointRestoredSchema.parse({
    checkpointId: checkpoint.checkpointId,
    initiativeThreadId: checkpoint.initiativeThreadId,
    sliceThreadId: checkpoint.sliceThreadId,
    sliceId: checkpoint.sliceId,
    title: checkpoint.title,
    workspaceRef: checkpoint.workspaceRef,
    restoredBy: input.actorId ?? "operator",
    fromSha: restore.fromSha,
    checkpointSha: checkpoint.checkpointSha,
    restoredSha: restore.restoredSha,
    dirtyBefore: restore.dirtyBefore,
    forced: restore.forced,
    restoredAt: nowIso(),
  });
  const event = developmentEvents.sourceCheckpointRestored(payload);
  const engine = new PostgresThreadEngine(input.pool);
  await engine.append([
    ThreadEventSchema.parse({
      eventId: newEventId(),
      threadId: checkpoint.sliceThreadId,
      type: event.type,
      occurredAt: nowIso(),
      actor: { type: "human", id: input.actorId ?? "operator" },
      payload: event.payload,
    }),
  ]);

  return OperatorSourceCheckpointRestoreResultSchema.parse({ ...restore, auditThreadId: checkpoint.sliceThreadId });
}

export async function restoreSourceCheckpointWorktree(
  checkpoint: OperatorSourceCheckpointSummary,
  options: { confirmed: boolean; force?: boolean },
): Promise<OperatorSourceCheckpointRestoreResult> {
  if (!options.confirmed) {
    return OperatorSourceCheckpointRestoreResultSchema.parse({
      status: "blocked",
      checkpoint,
      reason: "Restore requires explicit --confirm.",
    });
  }
  if (checkpoint.workingBranch === "main") {
    return OperatorSourceCheckpointRestoreResultSchema.parse({
      status: "blocked",
      checkpoint,
      reason: "Refusing to restore main through the development checkpoint operator.",
    });
  }

  const currentBranch = (await git(checkpoint.workspacePath, ["branch", "--show-current"])).trim();
  if (currentBranch !== checkpoint.workingBranch) {
    return OperatorSourceCheckpointRestoreResultSchema.parse({
      status: "blocked",
      checkpoint,
      reason: `Workspace branch ${currentBranch || "DETACHED_HEAD"} does not match checkpoint branch ${checkpoint.workingBranch}.`,
    });
  }

  const currentSha = (await git(checkpoint.workspacePath, ["rev-parse", "HEAD"])).trim();
  const changedFiles = parseGitStatusChangedFiles(await git(checkpoint.workspacePath, ["status", "--porcelain", "--untracked-files=all"]));
  const dirty = changedFiles.length > 0;
  if (dirty && !options.force) {
    return OperatorSourceCheckpointRestoreResultSchema.parse({
      status: "blocked",
      checkpoint,
      reason: "Workspace has uncommitted changes. Re-run with --force to discard them.",
      currentSha,
      dirty,
      changedFiles,
    });
  }

  await git(checkpoint.workspacePath, ["reset", "--hard", checkpoint.checkpointSha]);
  if (dirty && options.force) {
    await git(checkpoint.workspacePath, ["clean", "-fd"]);
  }
  const restoredSha = (await git(checkpoint.workspacePath, ["rev-parse", "HEAD"])).trim();
  return OperatorSourceCheckpointRestoreResultSchema.parse({
    status: "restored",
    checkpoint,
    fromSha: currentSha,
    restoredSha,
    dirtyBefore: dirty,
    forced: options.force ?? false,
  });
}

export async function resolveOperatorGate(input: {
  pool: Pool;
  service: ThreadService;
  gateId: string;
  resolution: "approved" | "denied";
  note?: string;
}): Promise<OperatorGateSummary> {
  const gate = await getGate(input.pool, input.gateId);
  if (!gate) {
    throw new Error(`Gate not found: ${input.gateId}`);
  }
  if (gate.status !== "pending") {
    throw new Error(`Gate already resolved: ${input.gateId}`);
  }
  await input.service.resolveGate(gate.threadId, input.gateId, input.resolution, input.note);
  const resolved = await getGate(input.pool, input.gateId);
  if (!resolved) {
    throw new Error(`Gate disappeared after resolution: ${input.gateId}`);
  }
  return resolved;
}

export function formatGateList(gates: readonly OperatorGateSummary[]): string {
  if (gates.length === 0) {
    return "No pending gates.";
  }
  return [
    "Pending Gates",
    "",
    ...gates.map((gate) => `- ${gate.gateId} thread=${gate.threadId} reason=${gate.reason ?? gate.gateType} action=${gate.proposedAction ?? "n/a"}`),
    "",
    "Next: npm run gates:show -- <gate-id>",
  ].join("\n");
}

export function formatGateDetail(gate: OperatorGateSummary, plan?: unknown): string {
  const lines = [
    `Gate ${gate.gateId}`,
    "",
    `Status: ${gate.status}`,
    `Thread: ${gate.threadId}`,
    `Reason: ${gate.reason ?? gate.gateType}`,
    `Action: ${gate.proposedAction ?? "n/a"}`,
  ];
  const parsedPlan = InitiativePlanSchema.safeParse(plan);
  if (parsedPlan.success) {
    lines.push("", "Proposed Plan:", `- ${parsedPlan.data.summary}`);
    for (const slice of parsedPlan.data.slices) {
      lines.push(`- ${slice.id} ${slice.title}: ${slice.objective}`);
    }
  }
  if (gate.status === "pending") {
    lines.push("", `Approve: npm run gates:approve -- ${gate.gateId} --note "approved"`);
    lines.push(`Reject: npm run gates:reject -- ${gate.gateId} --note "reason"`);
  }
  return lines.join("\n");
}

export function formatInitiativeList(initiatives: readonly OperatorInitiativeSummary[]): string {
  if (initiatives.length === 0) {
    return "No initiatives found.";
  }
  return [
    "Initiatives",
    "",
    ...initiatives.map(
      (initiative) =>
        `- ${initiative.threadId} status=${initiative.status} title=${initiative.title ?? "n/a"} pendingGates=${initiative.pendingGateCount}`,
    ),
    "",
    "Next: npm run initiative:status -- <thread-id>",
  ].join("\n");
}

export function formatInitiativeStatus(status: OperatorInitiativeStatus): string {
  const lines = [
    `Initiative ${status.threadId}`,
    "",
    `Status: ${status.status}`,
    `Title: ${status.title ?? "n/a"}`,
    `Repo: ${status.repo ?? "n/a"}`,
    `Branch: ${status.workingBranch ?? "n/a"}`,
    `Pending gates: ${status.pendingGateCount}`,
  ];
  if (status.currentSlice) {
    lines.push(`Current slice: ${status.currentSlice.sliceId} ${status.currentSlice.title} (${status.currentSlice.status})`);
  }
  lines.push("", "Child Threads:");
  lines.push(...(status.childThreads.length > 0 ? status.childThreads.map((child) => `- ${child.threadId} status=${child.status} agent=${child.agentName ?? "n/a"}`) : ["- none"]));
  lines.push("", "Pending Gates:");
  lines.push(...(status.pendingGates.length > 0 ? status.pendingGates.map((gate) => `- ${gate.gateId} reason=${gate.reason ?? gate.gateType}`) : ["- none"]));
  lines.push("", "Recent Events:");
  lines.push(...status.recentEvents.map((event) => `- ${event.seq ?? "?"} ${event.type} actor=${event.actor}`));
  return lines.join("\n");
}

export function formatSourceCheckpointList(checkpoints: readonly OperatorSourceCheckpointSummary[]): string {
  if (checkpoints.length === 0) {
    return "No source checkpoints found.";
  }
  return [
    "Source Checkpoints",
    "",
    ...checkpoints.map((checkpoint) => `- ${checkpoint.checkpointSha.slice(0, 12)} slice=${checkpoint.sliceId} files=${checkpoint.changedFiles.length} branch=${checkpoint.workingBranch}`),
    "",
    "Next: npm run checkpoints:show -- <checkpoint-id-or-sha>",
  ].join("\n");
}

export function formatSourceCheckpointDetail(checkpoint: OperatorSourceCheckpointSummary): string {
  return [
    `Source Checkpoint ${checkpoint.checkpointSha}`,
    "",
    `Checkpoint: ${checkpoint.checkpointId}`,
    `Slice: ${checkpoint.sliceId} ${checkpoint.title ?? ""}`.trimEnd(),
    `Branch: ${checkpoint.workingBranch}`,
    `Workspace: ${checkpoint.workspacePath}`,
    `Base: ${checkpoint.baseSha}`,
    `Commit: ${checkpoint.checkpointSha}`,
    `Message: ${checkpoint.commitMessage}`,
    "",
    "Changed Files:",
    ...(checkpoint.changedFiles.length > 0 ? checkpoint.changedFiles.map((file) => `- ${file}`) : ["- none"]),
    "",
    `Diff: ${checkpoint.diffCommand}`,
  ].join("\n");
}

export function formatSourceCheckpointDiff(checkpoint: OperatorSourceCheckpointSummary): string {
  return checkpoint.diffCommand;
}

export function formatSourceCheckpointRestoreResult(result: OperatorSourceCheckpointRestoreResult): string {
  if (result.status === "blocked") {
    return [
      "Source checkpoint restore blocked.",
      `Reason: ${result.reason}`,
      ...(result.checkpoint ? [`Checkpoint: ${result.checkpoint.checkpointSha}`] : []),
      ...(result.changedFiles.length > 0 ? ["Changed files:", ...result.changedFiles.map((file) => `- ${file}`)] : []),
    ].join("\n");
  }
  return [
    "Source checkpoint restored.",
    `Checkpoint: ${result.checkpoint.checkpointSha}`,
    `Workspace: ${result.checkpoint.workspacePath}`,
    `From: ${result.fromSha}`,
    `To: ${result.restoredSha}`,
    `Forced: ${result.forced}`,
    ...(result.auditThreadId ? [`Audit thread: ${result.auditThreadId}`] : []),
  ].join("\n");
}

export async function latestPlanForGate(pool: Pool, gate: OperatorGateSummary): Promise<unknown | undefined> {
  const result = await pool.query<EventRow>(
    `select jsonb_strip_nulls(jsonb_build_object(
       'eventId', event_id::text,
       'threadId', thread_id,
       'seq', seq,
       'type', type,
       'occurredAt', to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'correlationId', correlation_id::text,
       'causationId', causation_id::text,
       'idempotencyKey', idempotency_key,
       'scopeKey', scope_key,
       'stepKey', step_key,
       'actor', jsonb_build_object('type', actor_type, 'id', actor_id),
       'payload', payload_json
     )) as event_json
     from weave.thread_event
     where thread_id = $1
       and type = 'checkpoint.completed'
       and payload_json->>'stepKey' in ($2, $3)
     order by seq desc
     limit 1`,
    [gate.threadId, DevelopmentCheckpointKeys.proposedInitiativePlan, DevelopmentCheckpointKeys.slicePlan],
  );
  const row = result.rows[0];
  if (!row) {
    return undefined;
  }
  const event = ThreadEventSchema.parse(row.event_json);
  return event.type === "checkpoint.completed" ? event.payload.value : undefined;
}

type GateRow = {
  gate_id: string;
  thread_id: string;
  status: string;
  gate_type: string;
  created_at: Date | string;
  resolved_at: Date | string | null;
  resolution_json: unknown;
  created_payload: unknown;
};

type InitiativeRow = {
  thread_id: string;
  status: string;
  updated_at: Date | string;
  pending_gate_count: number;
  started_payload: unknown;
  spec_payload: unknown;
};

type EventRow = {
  event_json: unknown;
};

type SourceCheckpointRow = {
  event_thread_id: string;
  event_seq: number | null;
  checkpoint_payload: unknown;
};

function gateSummaryFromRow(row: GateRow): OperatorGateSummary {
  const createdPayload = z
    .object({
      reason: z.string().min(1).optional(),
      proposedAction: z.string().optional(),
    })
    .safeParse(row.created_payload);
  const resolutionPayload = z
    .object({
      resolution: z.enum(["approved", "denied"]),
      comment: z.string().optional(),
    })
    .safeParse(row.resolution_json);

  return OperatorGateSummarySchema.parse({
    gateId: row.gate_id,
    threadId: row.thread_id,
    status: row.status,
    gateType: row.gate_type,
    reason: createdPayload.success ? createdPayload.data.reason : undefined,
    proposedAction: createdPayload.success ? createdPayload.data.proposedAction : undefined,
    createdAt: toIso(row.created_at),
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : undefined,
    resolution: resolutionPayload.success ? resolutionPayload.data.resolution : undefined,
    comment: resolutionPayload.success ? resolutionPayload.data.comment : undefined,
  });
}

function initiativeSummaryFromRow(row: InitiativeRow): OperatorInitiativeSummary {
  const started = z
    .object({
      initiative: z.string().min(1),
      repo: z.string().min(1),
      workingBranch: z.string().min(1),
    })
    .safeParse(row.started_payload);
  const spec = z.object({ title: z.string().min(1) }).safeParse(row.spec_payload);
  return OperatorInitiativeSummarySchema.parse({
    threadId: row.thread_id,
    status: row.status,
    title: spec.success ? spec.data.title : started.success ? started.data.initiative : undefined,
    repo: started.success ? started.data.repo : undefined,
    workingBranch: started.success ? started.data.workingBranch : undefined,
    pendingGateCount: row.pending_gate_count,
    updatedAt: toIso(row.updated_at),
  });
}

async function pendingGatesForThread(pool: Pool, threadId: string): Promise<OperatorGateSummary[]> {
  const result = await pool.query<GateRow>(
    `select
       g.gate_id::text,
       g.thread_id,
       g.status,
       g.gate_type,
       g.created_at,
       g.resolved_at,
       g.resolution_json,
       e.payload_json as created_payload
     from weave.thread_gate g
     left join weave.thread_event e
       on e.thread_id = g.thread_id
      and e.type = 'gate.created'
      and e.payload_json->>'gateId' = g.gate_id::text
     where g.thread_id = $1 and g.status = 'pending'
     order by g.created_at asc`,
    [threadId],
  );
  return result.rows.map(gateSummaryFromRow);
}

async function childThreadsForInitiative(pool: Pool, threadId: string): Promise<OperatorInitiativeStatus["childThreads"]> {
  const result = await pool.query<{
    thread_id: string;
    status: string;
    parent_thread_id: string | null;
    agent_name: string | null;
  }>(
    `select
       t.id as thread_id,
       t.status,
       t.parent_thread_id,
       started.payload_json->>'agentName' as agent_name
     from weave.thread t
     left join lateral (
       select payload_json
       from weave.thread_event e
       where e.thread_id = t.id and e.type = 'session.started'
       order by e.seq asc
       limit 1
     ) started on true
     where t.root_thread_id = $1 and t.id <> $1
     order by t.created_at asc`,
    [threadId],
  );
  return result.rows.map((row) => ({
    threadId: row.thread_id,
    status: row.status,
    parentThreadId: row.parent_thread_id,
    agentName: row.agent_name ?? undefined,
  }));
}

async function recentEventsForThread(pool: Pool, threadId: string): Promise<EventRow[]> {
  const result = await pool.query<EventRow>(
    `select jsonb_strip_nulls(jsonb_build_object(
       'eventId', event_id::text,
       'threadId', thread_id,
       'seq', seq,
       'type', type,
       'occurredAt', to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
       'correlationId', correlation_id::text,
       'causationId', causation_id::text,
       'idempotencyKey', idempotency_key,
       'scopeKey', scope_key,
       'stepKey', step_key,
       'actor', jsonb_build_object('type', actor_type, 'id', actor_id),
       'payload', payload_json
     )) as event_json
     from weave.thread_event
     where thread_id = $1
     order by seq asc`,
    [threadId],
  );
  return result.rows;
}

function currentSliceFromEvents(events: readonly ThreadEvent[]): OperatorInitiativeStatus["currentSlice"] {
  const relevant = [...events].reverse().find((event) =>
    event.type === "dev.slice.started" || event.type === "dev.slice.completed" || event.type === "dev.slice.failed" || event.type === "dev.slice.approved",
  );
  if (!relevant || !("sliceId" in relevant.payload) || !("title" in relevant.payload)) {
    return undefined;
  }
  const status = relevant.type.replace("dev.slice.", "");
  return { sliceId: relevant.payload.sliceId, title: relevant.payload.title, status };
}

function sourceCheckpointSummaryFromRow(row: SourceCheckpointRow): OperatorSourceCheckpointSummary {
  const checkpoint = SourceCheckpointSchema.parse(row.checkpoint_payload);
  return OperatorSourceCheckpointSummarySchema.parse({
    checkpointId: checkpoint.checkpointId,
    initiativeThreadId: checkpoint.initiativeThreadId,
    sliceThreadId: checkpoint.sliceThreadId,
    sliceId: checkpoint.sliceId,
    title: checkpoint.title,
    workspaceRef: checkpoint.workspaceRef,
    workspacePath: checkpoint.workspaceRef.path,
    workingBranch: checkpoint.workspaceRef.workingBranch,
    baseSha: checkpoint.baseSha,
    checkpointSha: checkpoint.checkpointSha,
    changedFiles: checkpoint.changedFiles,
    commitMessage: checkpoint.commitMessage,
    createdAt: checkpoint.createdAt,
    eventThreadId: row.event_thread_id,
    eventSeq: row.event_seq ?? undefined,
    diffCommand: `git -C ${shellQuote(checkpoint.workspaceRef.path)} diff ${checkpoint.baseSha}..${checkpoint.checkpointSha} --`,
  });
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd });
  return String(stdout);
}

function parseGitStatusChangedFiles(output: string): string[] {
  return [...new Set(output.split("\n").map((line) => line.trimEnd()).filter(Boolean).map((line) => line.slice(3).trim()).filter(Boolean))];
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
