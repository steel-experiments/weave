import assert from "node:assert/strict";
import {
  DevelopmentCheckpointKeys,
  DevelopmentInitiativeInputSchema,
  DevelopmentSlicePlanSchema,
  ImplementationSummarySchema,
  OpenCodeImplementerInputSchema,
  PrDraftResultSchema,
  RepairResultSchema,
  ReviewResultSchema,
  VerificationResultSchema,
  buildDevelopmentSlicePlan,
  developmentBranchStateReadTool,
  developmentRepoContextReadTool,
  developmentEvents,
  evaluateSliceBranchState,
  readDevelopmentRepoContext,
  weaveMaintainer,
  weaveSliceRunner,
} from "../development-orchestrator.js";
import { createAgentPlanner } from "../agent-runner.js";
import { ThreadEventSchema, deterministicUuid, eventKey, nowIso, type ThreadEvent } from "../events.js";

const validSlice = {
  id: "01-contracts",
  title: "Workflow Contracts And Events",
  objective: "Define stable schemas for the development loop.",
  acceptanceCriteria: ["Schemas validate", "Events validate"],
  requiredReviewers: ["architecture-reviewer", "docs-reviewer"],
};

const initiative = DevelopmentInitiativeInputSchema.parse({
  initiative: "Build Weave Maintainer",
  repo: "weave",
  baseBranch: "main",
  workingBranch: "weave-development-orchestrator",
  contextFiles: ["AGENTS.md", "docs/", "src/"],
  slices: [validSlice],
});

assert.equal(initiative.slices?.[0]?.status, "proposed");
assert.deepEqual(initiative.slices?.[0]?.constraints, []);
assert.deepEqual(initiative.slices?.[0]?.riskNotes, []);

assert.equal(
  DevelopmentInitiativeInputSchema.safeParse({
    initiative: "",
    repo: "weave",
    baseBranch: "main",
    workingBranch: "branch",
    contextFiles: ["docs/"],
  }).success,
  false,
);

const plan = DevelopmentSlicePlanSchema.parse({
  initiative: initiative.initiative,
  repo: initiative.repo,
  baseBranch: initiative.baseBranch,
  workingBranch: initiative.workingBranch,
  slices: [validSlice],
  approvalRequired: true,
  summary: "One bounded contracts slice.",
});

assert.equal(plan.slices.length, 1);
assert.equal(DevelopmentCheckpointKeys.approvedSlicePlan, "approved-slice-plan");
assert.equal(DevelopmentCheckpointKeys.workspaceRef, "workspace-ref");
assert.equal(buildDevelopmentSlicePlan(initiative).summary, "Plan 1 development slice for Build Weave Maintainer.");

const implementerInput = OpenCodeImplementerInputSchema.parse({
  sliceTitle: validSlice.title,
  objective: validSlice.objective,
  acceptanceCriteria: validSlice.acceptanceCriteria,
  allowedFiles: ["src/development-orchestrator.ts"],
  branch: initiative.workingBranch,
});

assert.deepEqual(implementerInput.constraints, []);

const implementation = ImplementationSummarySchema.parse({
  filesChanged: ["src/development-orchestrator.ts"],
  behaviorChanged: ["Development workflow schemas are available."],
  summary: "Added development workflow contracts.",
});

assert.deepEqual(implementation.testsAdded, []);
assert.deepEqual(implementation.knownLimitations, []);

const verification = VerificationResultSchema.parse({
  status: "passed",
  commands: [
    {
      command: "npm test",
      exitCode: 0,
      status: "passed",
      durationMs: 1200,
      summary: "All tests passed.",
    },
  ],
});

assert.equal(verification.commands[0]?.status, "passed");

const review = ReviewResultSchema.parse({
  reviewer: "architecture-reviewer",
  verdict: "needs-fixes",
  findings: [
    {
      severity: "medium",
      file: "src/development-orchestrator.ts",
      line: 42,
      issue: "Schema should reject empty acceptance criteria.",
      suggestedFix: "Use a minimum length on the acceptance criteria array.",
    },
  ],
});

assert.equal(review.findings[0]?.severity, "medium");
assert.equal(
  ReviewResultSchema.safeParse({
    reviewer: "architecture-reviewer",
    verdict: "maybe",
    findings: [],
  }).success,
  false,
);

const repair = RepairResultSchema.parse({
  status: "completed",
  attempt: 0,
  fixesAttempted: ["Added min length validation."],
  findingsAddressed: review.findings,
  summary: "Validation fixed.",
});

assert.equal(repair.filesChanged.length, 0);

const prDraft = PrDraftResultSchema.parse({
  title: "Build Weave Maintainer",
  branch: initiative.workingBranch,
  baseBranch: initiative.baseBranch,
  body: "## Summary\n\nAdded development orchestrator contracts.",
  shippedSlices: [validSlice.id],
  tests: verification.commands,
  reviewerVerdicts: [{ ...review, verdict: "pass", findings: [] }],
});

assert.equal(prDraft.knownLimitations.length, 0);
assert.equal(prDraft.followUps.length, 0);

const sliceCompleted = developmentEvents.sliceCompleted({
  sliceId: validSlice.id,
  title: validSlice.title,
  branch: initiative.workingBranch,
  summary: "Contracts shipped.",
  testsPassed: true,
  reviewVerdicts: ["pass"],
});

assert.equal(sliceCompleted.type, "dev.slice.completed");
assert.throws(() => {
  developmentEvents.sliceCompleted({
    sliceId: validSlice.id,
    title: validSlice.title,
    branch: initiative.workingBranch,
    summary: "Contracts shipped.",
    testsPassed: true,
    reviewVerdicts: ["maybe"],
  } as never);
});

const parsedThreadEvent = ThreadEventSchema.parse({
  eventId: eventKey("dev-thread", "dev.slice.completed", "slice-completed"),
  threadId: "dev-thread",
  type: "dev.slice.completed",
  occurredAt: nowIso(),
  actor: { type: "agent", id: "weave.maintainer" },
  payload: sliceCompleted.payload,
});

assert.equal(parsedThreadEvent.type, "dev.slice.completed");
assert.equal(parsedThreadEvent.payload.testsPassed, true);

const reviewCompleted = developmentEvents.reviewCompleted({
  sliceId: validSlice.id,
  reviewer: "architecture-reviewer",
  verdict: "pass",
  findings: [],
});

assert.equal(reviewCompleted.type, "dev.review.completed");
assert.equal(developmentEvents.prReadyForReview.type, "dev.pr.ready_for_review");

const actualRepoContext = await readDevelopmentRepoContext({
  repo: "weave",
  contextFiles: ["package.json", "../outside"],
  maxFileBytes: 64_000,
  maxTotalBytes: 256_000,
});

assert.deepEqual(actualRepoContext.filesRead, ["package.json"]);
assert.equal(actualRepoContext.entries.some((entry) => entry.kind === "denied"), true);
assert.equal(developmentRepoContextReadTool.name, "dev.repoContext.read");
assert.equal(developmentBranchStateReadTool.name, "dev.branchState.read");

const threadId = "development-planner";
const initialHistory = createInitialHistory(threadId, initiative);
const planner = createAgentPlanner(weaveMaintainer);
const firstPlan = await planner.plan(threadId, initialHistory);

assert(firstPlan);
assert.equal(firstPlan.events.some((candidate) => candidate.type === "dev.initiative.started"), true);
assert.equal(firstPlan.events.some((candidate) => candidate.type === "dev.slice.proposed"), false);

const contextRequest = firstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(contextRequest);
assert.equal(contextRequest.payload.toolName, "dev.repoContext.read");

const contextCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(threadId, "tool.completed", "read-repo-context"),
  threadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: contextRequest.correlationId,
  causationId: contextRequest.eventId,
  scopeKey: contextRequest.scopeKey,
  stepKey: contextRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: contextRequest.payload.toolCallId,
    output: {
      repo: "weave",
      filesRead: ["AGENTS.md"],
      totalBytes: 12,
      truncated: false,
      entries: [{ path: "AGENTS.md", kind: "file", bytes: 12, content: "repo rules" }],
    },
  },
};

const plannedAfterContext = await planner.plan(threadId, [...initialHistory, ...firstPlan.events, contextCompleted]);
assert(plannedAfterContext);
assert.equal(plannedAfterContext.events.some((candidate) => candidate.type === "dev.slice.proposed"), true);

const gateCreated = plannedAfterContext.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> =>
  candidate.type === "gate.created",
);
assert(gateCreated);
assert.equal(gateCreated.payload.reason, "slice-plan-approval");
assert.equal(gateCreated.stepKey, "approve-slice-plan");

const pendingPlan = await planner.plan(threadId, [...initialHistory, ...firstPlan.events, contextCompleted, ...plannedAfterContext.events]);
assert.equal(pendingPlan, null);

const gateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
  eventId: eventKey(threadId, "gate.resolved", "approve-slice-plan"),
  threadId,
  type: "gate.resolved",
  occurredAt: nowIso(),
  correlationId: gateCreated.correlationId,
  causationId: gateCreated.eventId,
  scopeKey: gateCreated.scopeKey,
  stepKey: gateCreated.stepKey,
  actor: { type: "human", id: "maintainer" },
  payload: {
    gateId: gateCreated.payload.gateId,
    resolution: "approved",
    comment: "ship it",
  },
};

const approvedPlan = await planner.plan(threadId, [
  ...initialHistory,
  ...firstPlan.events,
  contextCompleted,
  ...plannedAfterContext.events,
  gateResolved,
]);
assert(approvedPlan);
assert.equal(approvedPlan.resumeReason, "gate-resolved");
assert.equal(approvedPlan.events.some((candidate) => candidate.type === "dev.slice.approved"), true);
assert.equal(approvedPlan.events.at(-1)?.type, "agent.output.completed");

const outputCompleted = approvedPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(outputCompleted);
assert.equal((outputCompleted.payload.output as { status: string }).status, "approved");
assert.deepEqual((outputCompleted.payload.output as { repoContext: { filesRead: string[] } }).repoContext.filesRead, ["AGENTS.md"]);

const branchState = {
  repo: "weave",
  repoRoot: "/repo/weave",
  currentBranch: "weave-development-orchestrator",
  headCommit: "abc123",
  isDetachedHead: false,
};
const sliceRunnerInput = {
  initiative: initiative.initiative,
  repo: initiative.repo,
  branch: initiative.workingBranch,
  slice: initiative.slices[0]!,
  maxRepairAttempts: 0,
};

assert.equal(evaluateSliceBranchState(sliceRunnerInput, branchState).status, "ready");
assert.equal(evaluateSliceBranchState({ ...sliceRunnerInput, branch: "main" }, { ...branchState, currentBranch: "main" }).status, "blocked");
assert.equal(evaluateSliceBranchState(sliceRunnerInput, { ...branchState, currentBranch: "other-branch" }).status, "blocked");
assert.equal(evaluateSliceBranchState(sliceRunnerInput, { ...branchState, isDetachedHead: true }).status, "blocked");

const runnerThreadId = "slice-runner-branch-control";
const runnerHistory = createInitialHistory(runnerThreadId, sliceRunnerInput, weaveSliceRunner.name);
const runnerPlanner = createAgentPlanner(weaveSliceRunner);
const runnerFirstPlan = await runnerPlanner.plan(runnerThreadId, runnerHistory);

assert(runnerFirstPlan);
assert.equal(runnerFirstPlan.events.some((candidate) => candidate.type === "dev.slice.started"), false);

const branchRequest = runnerFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(branchRequest);
assert.equal(branchRequest.payload.toolName, "dev.branchState.read");

const branchCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(runnerThreadId, "tool.completed", "read-branch-state"),
  threadId: runnerThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: branchRequest.correlationId,
  causationId: branchRequest.eventId,
  scopeKey: branchRequest.scopeKey,
  stepKey: branchRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: branchRequest.payload.toolCallId,
    output: branchState,
  },
};

const runnerReadyPlan = await runnerPlanner.plan(runnerThreadId, [...runnerHistory, ...runnerFirstPlan.events, branchCompleted]);
assert(runnerReadyPlan);
assert.equal(runnerReadyPlan.events.some((candidate) => candidate.type === "dev.slice.started"), true);

const runnerOutput = runnerReadyPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(runnerOutput);
assert.equal((runnerOutput.payload.output as { status: string }).status, "ready");

console.log("Development orchestrator contract tests passed");

function createInitialHistory(threadId: string, metadata: unknown, agentName: string = weaveMaintainer.name): ThreadEvent[] {
  const correlationId = deterministicUuid("correlation", threadId);
  const sessionStarted: Extract<ThreadEvent, { type: "session.started" }> = {
    eventId: eventKey(threadId, "session.started", "initial"),
    threadId,
    type: "session.started",
    occurredAt: nowIso(),
    correlationId,
    actor: { type: "system", id: "test" },
    payload: {
      source: "test",
      agentName,
      metadata: metadata as Record<string, unknown>,
    },
  };
  const promptReceived: Extract<ThreadEvent, { type: "prompt.received" }> = {
    eventId: eventKey(threadId, "prompt.received", "initial"),
    threadId,
    type: "prompt.received",
    occurredAt: nowIso(),
    correlationId,
    causationId: sessionStarted.eventId,
    actor: { type: "user", id: "test" },
    payload: { prompt: "Plan the development initiative." },
  };

  return [sessionStarted, promptReceived];
}
