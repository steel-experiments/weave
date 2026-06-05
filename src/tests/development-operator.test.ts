import assert from "node:assert/strict";
import {
  formatGateDetail,
  formatGateList,
  formatInitiativeList,
  formatInitiativeStatus,
  formatSourceCheckpointDetail,
  formatSourceCheckpointDiff,
  formatSourceCheckpointList,
  formatSourceCheckpointRestoreResult,
  getInitiativeStatus,
  OperatorGateSummarySchema,
  OperatorInitiativeStatusSchema,
  OperatorSourceCheckpointRestoreResultSchema,
  OperatorSourceCheckpointSummarySchema,
} from "../development-operator.js";
import { newEventId, nowIso } from "../events.js";

const gate = OperatorGateSummarySchema.parse({
  gateId: "11111111-1111-4111-8111-111111111111",
  threadId: "initiative-thread",
  status: "pending",
  gateType: "manual-approval",
  reason: "slice-plan-approval",
  proposedAction: "Approve 2 slices for PRD automation.",
  createdAt: "2026-06-04T00:00:00.000Z",
});

assert.equal(formatGateList([]), "No pending gates.");
assert.match(formatGateList([gate]), /Pending Gates/);
assert.match(formatGateList([gate]), /slice-plan-approval/);
assert.match(formatGateList([gate]), /npm run gates:show -- <gate-id>/);

const plan = {
  initiative: "Automate PRD-backed development initiatives",
  repo: "weave",
  baseBranch: "main",
  workingBranch: "prd-automation",
  slices: [
    {
      id: "01-prd-compiler",
      title: "PRD Compiler",
      objective: "Compile a PRD into proposed slices.",
      acceptanceCriteria: ["Plans validate."],
    },
  ],
  approvalRequired: true,
  summary: "Proposed one automation slice.",
};

const gateDetail = formatGateDetail(gate, plan);
assert.match(gateDetail, /Proposed Plan/);
assert.match(gateDetail, /01-prd-compiler PRD Compiler/);
assert.match(gateDetail, /npm run gates:approve/);

assert.equal(formatInitiativeList([]), "No initiatives found.");
assert.match(
  formatInitiativeList([
    {
      threadId: "initiative-thread",
      status: "blocked",
      title: "Automate PRD-backed development initiatives",
      repo: "weave",
      workingBranch: "prd-automation",
      pendingGateCount: 1,
      updatedAt: "2026-06-04T00:00:00.000Z",
    },
  ]),
  /pendingGates=1/,
);

const status = OperatorInitiativeStatusSchema.parse({
  threadId: "initiative-thread",
  status: "blocked",
  title: "Automate PRD-backed development initiatives",
  repo: "weave",
  workingBranch: "prd-automation",
  pendingGateCount: 1,
  updatedAt: "2026-06-04T00:00:00.000Z",
  currentSlice: { sliceId: "01-prd-compiler", title: "PRD Compiler", status: "approved" },
  childThreads: [{ threadId: "slice-thread", status: "waiting", parentThreadId: "initiative-thread", agentName: "weave.sliceRunner" }],
  pendingGates: [gate],
  recentEvents: [{ seq: 8, type: "gate.created", actor: "agent:weave.maintainer" }],
});

const renderedStatus = formatInitiativeStatus(status);
assert.match(renderedStatus, /Current slice: 01-prd-compiler PRD Compiler \(approved\)/);
assert.match(renderedStatus, /Child Threads/);
assert.match(renderedStatus, /gate.created/);

const projectedStatus = await getInitiativeStatus({
  query(sql: string) {
    if (sql.includes("from weave.thread t") && sql.includes("where t.id = $1")) {
      return Promise.resolve({ rows: [{
        thread_id: "initiative-thread",
        status: "completed",
        updated_at: "2026-06-04T00:00:00.000Z",
        pending_gate_count: 0,
        started_payload: { initiative: "Auth Gateway Remaining Epic", repo: "weave", workingBranch: "auth-gateway-remaining" },
        spec_payload: { title: "Auth Gateway Remaining Epic" },
        latest_output_payload: {
          status: "blocked",
          blockedSlice: "02-authenticated-integration-ingress",
          blockerReason: "Implementation child failed: duplicate key value violates unique constraint.",
          plan: { slices: [{ id: "02-authenticated-integration-ingress", title: "Authenticated Integration Ingress" }] },
        },
      }] });
    }
    if (sql.includes("from weave.thread_gate")) {
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("from weave.thread t") && sql.includes("root_thread_id")) {
      return Promise.resolve({ rows: [{ thread_id: "slice-thread", status: "failed", parent_thread_id: "initiative-thread", agent_name: "weave.sliceRunner" }] });
    }
    if (sql.includes("from weave.thread_event")) {
      return Promise.resolve({ rows: [{ event_json: {
        eventId: newEventId(),
        threadId: "initiative-thread",
        seq: 10,
        type: "dev.slice.approved",
        occurredAt: nowIso(),
        actor: { type: "agent", id: "weave.maintainer" },
        payload: { sliceId: "02-authenticated-integration-ingress", title: "Authenticated Integration Ingress", approvedBy: "maintainer" },
      } }] });
    }
    throw new Error(`Unexpected query: ${sql}`);
  },
} as never, "initiative-thread");
assert(projectedStatus);
assert.equal(projectedStatus.status, "blocked");
assert.deepEqual(projectedStatus.currentSlice, {
  sliceId: "02-authenticated-integration-ingress",
  title: "Authenticated Integration Ingress",
  status: "blocked",
});
assert.match(formatInitiativeStatus(projectedStatus), /Blocker: Implementation child failed/);

const checkpoint = OperatorSourceCheckpointSummarySchema.parse({
  checkpointId: "11111111-1111-4111-8111-111111111111",
  initiativeThreadId: "initiative-thread",
  sliceThreadId: "slice-thread",
  sliceId: "01-prd-compiler",
  title: "PRD Compiler",
  workspaceRef: {
    provider: "git-worktree",
    workspaceId: "workspace",
    path: "/tmp/weave/workspace",
    repo: "weave",
    baseBranch: "main",
    workingBranch: "prd-automation",
    baseCommit: "abc123",
  },
  workspacePath: "/tmp/weave/workspace",
  workingBranch: "prd-automation",
  baseSha: "abc123",
  checkpointSha: "def456",
  changedFiles: ["src/development-orchestrator.ts"],
  commitMessage: "feat: complete PRD Compiler",
  eventThreadId: "slice-thread",
  eventSeq: 42,
  diffCommand: "git -C '/tmp/weave/workspace' diff abc123..def456 --",
});

assert.equal(formatSourceCheckpointList([]), "No source checkpoints found.");
assert.match(formatSourceCheckpointList([checkpoint]), /def456/);
assert.match(formatSourceCheckpointList([checkpoint]), /checkpoints:show/);
assert.match(formatSourceCheckpointDetail(checkpoint), /Changed Files/);
assert.match(formatSourceCheckpointDetail(checkpoint), /src\/development-orchestrator.ts/);
assert.equal(formatSourceCheckpointDiff(checkpoint), checkpoint.diffCommand);

const blockedRestore = OperatorSourceCheckpointRestoreResultSchema.parse({
  status: "blocked",
  checkpoint,
  reason: "Restore requires explicit --confirm.",
});
assert.match(formatSourceCheckpointRestoreResult(blockedRestore), /blocked/);
const restored = OperatorSourceCheckpointRestoreResultSchema.parse({
  status: "restored",
  checkpoint,
  fromSha: "fedcba",
  restoredSha: "def456",
  dirtyBefore: false,
  forced: false,
  auditThreadId: "slice-thread",
});
assert.match(formatSourceCheckpointRestoreResult(restored), /Source checkpoint restored/);
assert.match(formatSourceCheckpointRestoreResult(restored), /Audit thread/);

console.log("Development operator tests passed");
