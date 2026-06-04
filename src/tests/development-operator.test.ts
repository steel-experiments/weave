import assert from "node:assert/strict";
import {
  formatGateDetail,
  formatGateList,
  formatInitiativeList,
  formatInitiativeStatus,
  OperatorGateSummarySchema,
  OperatorInitiativeStatusSchema,
} from "../development-operator.js";

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

console.log("Development operator tests passed");
