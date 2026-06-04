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
  buildPrDraft,
  createGithubPrUpsertTool,
  buildDevelopmentSlicePlan,
  createOpenCodeImplementationTool,
  createOpenCodeImplementerAgent,
  createPrAgent,
  createRepairAgent,
  createRepairTool,
  createReviewerAgent,
  createReviewerTool,
  createVerificationAgent,
  createVerificationTool,
  developmentBranchStateReadTool,
  developmentRepoContextReadTool,
  developmentEvents,
  decideRepairLoop,
  evaluateOpenCodeImplementerInput,
  evaluateSliceReadinessForCompletion,
  evaluateSliceBranchState,
  outOfScopeImplementationFiles,
  readDevelopmentRepoContext,
  repairAttemptKey,
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

const workspaceRef = {
  provider: "git-worktree",
  workspaceId: "workspace-01",
  path: "/tmp/weave/workspace-01",
  repo: "weave",
  baseBranch: "main",
  workingBranch: initiative.workingBranch,
  baseCommit: "abc123",
};

const implementerInput = OpenCodeImplementerInputSchema.parse({
  sliceId: validSlice.id,
  sliceTitle: validSlice.title,
  objective: validSlice.objective,
  acceptanceCriteria: validSlice.acceptanceCriteria,
  allowedFiles: ["src/example.ts", "src/example.test.ts"],
  branch: initiative.workingBranch,
  workspaceRef,
});

assert.deepEqual(implementerInput.constraints, []);
assert.equal(evaluateOpenCodeImplementerInput(implementerInput), undefined);
assert.equal(evaluateOpenCodeImplementerInput({ ...implementerInput, branch: "main" })?.status, "blocked");
assert.equal(
  evaluateOpenCodeImplementerInput({ ...implementerInput, workspaceRef: { ...workspaceRef, workingBranch: "other-branch" } })?.status,
  "blocked",
);

const implementation = ImplementationSummarySchema.parse({
  filesChanged: ["src/development-orchestrator.ts"],
  behaviorChanged: ["Development workflow schemas are available."],
  summary: "Added development workflow contracts.",
});

assert.deepEqual(implementation.testsAdded, []);
assert.deepEqual(implementation.knownLimitations, []);
assert.deepEqual(outOfScopeImplementationFiles(implementerInput, { ...implementation, filesChanged: ["src/example.ts"] }), []);
assert.deepEqual(outOfScopeImplementationFiles(implementerInput, { ...implementation, filesChanged: ["src/other.ts"] }), ["src/other.ts"]);

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
  branch: workspaceRef.workingBranch,
  workspaceRef,
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

const mockImplementationTool = createOpenCodeImplementationTool({
  run(input) {
    assert.equal(input.workspaceRef.workspaceId, workspaceRef.workspaceId);
    assert.equal(input.branch, workspaceRef.workingBranch);
    return {
      filesChanged: ["src/example.ts"],
      testsAdded: ["src/example.test.ts"],
      behaviorChanged: ["Example behavior changed."],
      docsChanged: [],
      knownLimitations: [],
      followUpSuggestions: [],
      summary: "Implemented mocked slice.",
    };
  },
});
assert.equal(mockImplementationTool.name, "dev.opencode.implement");

const openCodeImplementer = createOpenCodeImplementerAgent({
  runner: {
    run() {
      return {
        filesChanged: ["src/example.ts"],
        testsAdded: ["src/example.test.ts"],
        behaviorChanged: ["Example behavior changed."],
        docsChanged: [],
        knownLimitations: [],
        followUpSuggestions: [],
        summary: "Implemented mocked slice.",
      };
    },
  },
});
const implementationThreadId = "opencode-implementer-boundary";
const implementationHistory = createInitialHistory(implementationThreadId, implementerInput, openCodeImplementer.name);
const implementationPlanner = createAgentPlanner(openCodeImplementer);
const implementationFirstPlan = await implementationPlanner.plan(implementationThreadId, implementationHistory);

assert(implementationFirstPlan);
assert.equal(implementationFirstPlan.events.some((candidate) => candidate.type === "dev.implementation.started"), true);
const implementationRequest = implementationFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(implementationRequest);
assert.equal(implementationRequest.payload.toolName, "dev.opencode.implement");

const implementationCompletedTool: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(implementationThreadId, "tool.completed", "run-opencode-implementation"),
  threadId: implementationThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: implementationRequest.correlationId,
  causationId: implementationRequest.eventId,
  scopeKey: implementationRequest.scopeKey,
  stepKey: implementationRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: implementationRequest.payload.toolCallId,
    output: {
      filesChanged: ["src/example.ts"],
      testsAdded: ["src/example.test.ts"],
      behaviorChanged: ["Example behavior changed."],
      docsChanged: [],
      knownLimitations: [],
      followUpSuggestions: [],
      summary: "Implemented mocked slice.",
    },
  },
};

const implementationFinishedPlan = await implementationPlanner.plan(implementationThreadId, [
  ...implementationHistory,
  ...implementationFirstPlan.events,
  implementationCompletedTool,
]);
assert(implementationFinishedPlan);
assert.equal(implementationFinishedPlan.events.some((candidate) => candidate.type === "checkpoint.completed" && candidate.stepKey === "implementation-summary"), true);
assert.equal(implementationFinishedPlan.events.some((candidate) => candidate.type === "dev.implementation.completed"), true);
const implementationOutput = implementationFinishedPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(implementationOutput);
assert.equal((implementationOutput.payload.output as { status: string }).status, "completed");

const blockedImplementer = createOpenCodeImplementerAgent({
  runner: {
    run() {
      throw new Error("runner should not execute for blocked input");
    },
  },
});
const blockedThreadId = "opencode-implementer-blocked";
const blockedHistory = createInitialHistory(blockedThreadId, { ...implementerInput, branch: "main" }, blockedImplementer.name);
const blockedPlan = await createAgentPlanner(blockedImplementer).plan(blockedThreadId, blockedHistory);
assert(blockedPlan);
assert.equal(blockedPlan.events.some((candidate) => candidate.type === "tool.requested"), false);
const blockedOutput = blockedPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(blockedOutput);
assert.equal((blockedOutput.payload.output as { status: string }).status, "blocked");

const verificationInput = {
  sliceId: validSlice.id,
  branch: workspaceRef.workingBranch,
  workspaceRef,
  commands: [{ command: "npm", args: ["test"], required: true, timeoutMs: 120_000 }],
  maxOutputBytes: 32_000,
};
const verificationResult = {
  status: "passed" as const,
  commands: [
    {
      command: "npm test",
      exitCode: 0,
      status: "passed" as const,
      durationMs: 100,
      summary: "Tests passed.",
      output: "ok",
    },
  ],
};
const verificationTool = createVerificationTool({
  run(input) {
    assert.equal(input.workspaceRef.workspaceId, workspaceRef.workspaceId);
    return verificationResult;
  },
});
assert.equal(verificationTool.name, "dev.verification.run");

const verifier = createVerificationAgent({ runner: { run: () => verificationResult } });
const verificationThreadId = "verification-agent-boundary";
const verificationHistory = createInitialHistory(verificationThreadId, verificationInput, verifier.name);
const verificationPlanner = createAgentPlanner(verifier);
const verificationFirstPlan = await verificationPlanner.plan(verificationThreadId, verificationHistory);
assert(verificationFirstPlan);
const verificationRequest = verificationFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(verificationRequest);
assert.equal(verificationRequest.payload.toolName, "dev.verification.run");

const verificationCompletedTool: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(verificationThreadId, "tool.completed", "run-verification"),
  threadId: verificationThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: verificationRequest.correlationId,
  causationId: verificationRequest.eventId,
  scopeKey: verificationRequest.scopeKey,
  stepKey: verificationRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: verificationRequest.payload.toolCallId,
    output: verificationResult,
  },
};
const verificationFinishedPlan = await verificationPlanner.plan(verificationThreadId, [
  ...verificationHistory,
  ...verificationFirstPlan.events,
  verificationCompletedTool,
]);
assert(verificationFinishedPlan);
assert.equal(verificationFinishedPlan.events.some((candidate) => candidate.type === "checkpoint.completed" && candidate.stepKey === "test-results"), true);
assert.equal(verificationFinishedPlan.events.some((candidate) => candidate.type === "dev.verification.completed"), true);

const reviewerInput = {
  slice: initiative.slices[0]!,
  branch: workspaceRef.workingBranch,
  workspaceRef,
  reviewer: "architecture-reviewer" as const,
  implementationSummary: implementation,
  verificationResult,
  diffSummary: "src/example.ts changed",
};
const passingReview = {
  reviewer: "architecture-reviewer" as const,
  verdict: "pass" as const,
  findings: [],
  summary: "Looks good.",
};
const reviewerTool = createReviewerTool({
  run(input) {
    assert.equal(input.reviewer, "architecture-reviewer");
    return passingReview;
  },
});
assert.equal(reviewerTool.name, "dev.review.run");

const reviewerAgent = createReviewerAgent({ reviewer: "architecture-reviewer", runner: { run: () => passingReview } });
const reviewThreadId = "review-agent-boundary";
const reviewHistory = createInitialHistory(reviewThreadId, reviewerInput, reviewerAgent.name);
const reviewPlanner = createAgentPlanner(reviewerAgent);
const reviewFirstPlan = await reviewPlanner.plan(reviewThreadId, reviewHistory);
assert(reviewFirstPlan);
const reviewRequest = reviewFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(reviewRequest);
assert.equal(reviewRequest.payload.toolName, "dev.review.run");

const reviewCompletedTool: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(reviewThreadId, "tool.completed", "run-review"),
  threadId: reviewThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: reviewRequest.correlationId,
  causationId: reviewRequest.eventId,
  scopeKey: reviewRequest.scopeKey,
  stepKey: reviewRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: reviewRequest.payload.toolCallId,
    output: passingReview,
  },
};
const reviewFinishedPlan = await reviewPlanner.plan(reviewThreadId, [...reviewHistory, ...reviewFirstPlan.events, reviewCompletedTool]);
assert(reviewFinishedPlan);
assert.equal(
  reviewFinishedPlan.events.some((candidate) => candidate.type === "checkpoint.completed" && candidate.stepKey === "review-findings:architecture-reviewer"),
  true,
);
assert.equal(reviewFinishedPlan.events.some((candidate) => candidate.type === "dev.review.completed"), true);

assert.equal(
  evaluateSliceReadinessForCompletion({ implementationSummary: implementation, verificationResult, reviewResults: [passingReview] }).status,
  "completed",
);
assert.equal(
  evaluateSliceReadinessForCompletion({
    verificationResult: { status: "failed", commands: verificationResult.commands, failureSummary: "typecheck failed" },
    reviewResults: [passingReview],
  }).status,
  "needs-repair",
);
assert.equal(
  evaluateSliceReadinessForCompletion({
    verificationResult,
    reviewResults: [{ reviewer: "architecture-reviewer", verdict: "needs-fixes", findings: [{ severity: "medium", issue: "Fix this." }] }],
  }).status,
  "needs-repair",
);
assert.equal(
  evaluateSliceReadinessForCompletion({
    verificationResult,
    reviewResults: [{ reviewer: "architecture-reviewer", verdict: "blocked", findings: [], summary: "Cannot review." }],
  }).status,
  "blocked",
);

assert.equal(repairAttemptKey(0), "repair:0");
assert.deepEqual(decideRepairLoop({ currentAttempt: 0, maxAttempts: 2, findings: review.findings }), {
  status: "attempt-repair",
  attempt: 0,
  repairKey: "repair:0",
});
assert.equal(decideRepairLoop({ currentAttempt: 2, maxAttempts: 2, findings: review.findings }).status, "human-gate");
assert.equal(
  decideRepairLoop({
    currentAttempt: 0,
    maxAttempts: 2,
    findings: [{ severity: "high", issue: "Touches credentials.", file: "src/credentials.ts" }],
  }).status,
  "human-gate",
);

const repairInput = {
  branch: workspaceRef.workingBranch,
  workspaceRef,
  slice: initiative.slices[0]!,
  attempt: 0,
  maxAttempts: 2,
  failingCommands: verificationResult.commands,
  findings: review.findings,
};
const repairResult = {
  status: "completed" as const,
  attempt: 0,
  branch: workspaceRef.workingBranch,
  workspaceRef,
  filesChanged: ["src/example.ts"],
  fixesAttempted: ["Fixed validation."],
  findingsAddressed: review.findings,
  limitations: [],
  summary: "Repair completed.",
};
const repairTool = createRepairTool({
  run(input) {
    assert.equal(input.workspaceRef.workspaceId, workspaceRef.workspaceId);
    assert.equal(input.attempt, 0);
    return repairResult;
  },
});
assert.equal(repairTool.name, "dev.opencode.repair");

const repairAgent = createRepairAgent({ runner: { run: () => repairResult } });
const repairThreadId = "repair-agent-boundary";
const repairHistory = createInitialHistory(repairThreadId, repairInput, repairAgent.name);
const repairPlanner = createAgentPlanner(repairAgent);
const repairFirstPlan = await repairPlanner.plan(repairThreadId, repairHistory);
assert(repairFirstPlan);
assert.equal(repairFirstPlan.events.some((candidate) => candidate.type === "dev.repair.started"), true);
const repairRequest = repairFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(repairRequest);
assert.equal(repairRequest.stepKey, "repair:0");
assert.equal(repairRequest.payload.toolName, "dev.opencode.repair");

const repairCompletedTool: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(repairThreadId, "tool.completed", "repair:0"),
  threadId: repairThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: repairRequest.correlationId,
  causationId: repairRequest.eventId,
  scopeKey: repairRequest.scopeKey,
  stepKey: repairRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: repairRequest.payload.toolCallId,
    output: repairResult,
  },
};
const repairFinishedPlan = await repairPlanner.plan(repairThreadId, [...repairHistory, ...repairFirstPlan.events, repairCompletedTool]);
assert(repairFinishedPlan);
assert.equal(repairFinishedPlan.events.some((candidate) => candidate.type === "dev.repair.completed"), true);
const repairOutput = repairFinishedPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(repairOutput);
assert.equal((repairOutput.payload.output as { status: string }).status, "completed");

const exhaustedRepairAgent = createRepairAgent({
  runner: {
    run() {
      throw new Error("runner should not execute after exhausted attempts");
    },
  },
});
const exhaustedThreadId = "repair-agent-exhausted";
const exhaustedInput = { ...repairInput, attempt: 2, maxAttempts: 2 };
const exhaustedHistory = createInitialHistory(exhaustedThreadId, exhaustedInput, exhaustedRepairAgent.name);
const exhaustedFirstPlan = await createAgentPlanner(exhaustedRepairAgent).plan(exhaustedThreadId, exhaustedHistory);
assert(exhaustedFirstPlan);
assert.equal(exhaustedFirstPlan.events.some((candidate) => candidate.type === "tool.requested"), false);
const repairGate = exhaustedFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> =>
  candidate.type === "gate.created",
);
assert(repairGate);
assert.equal(repairGate.payload.reason, "repair-stop");

const repairGateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
  eventId: eventKey(exhaustedThreadId, "gate.resolved", "repair-stop"),
  threadId: exhaustedThreadId,
  type: "gate.resolved",
  occurredAt: nowIso(),
  correlationId: repairGate.correlationId,
  causationId: repairGate.eventId,
  scopeKey: repairGate.scopeKey,
  stepKey: repairGate.stepKey,
  actor: { type: "human", id: "maintainer" },
  payload: {
    gateId: repairGate.payload.gateId,
    resolution: "denied",
    comment: "stop repair",
  },
};
const exhaustedFinishedPlan = await createAgentPlanner(exhaustedRepairAgent).plan(exhaustedThreadId, [
  ...exhaustedHistory,
  ...exhaustedFirstPlan.events,
  repairGateResolved,
]);
assert(exhaustedFinishedPlan);
const exhaustedOutput = exhaustedFinishedPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(exhaustedOutput);
assert.equal((exhaustedOutput.payload.output as { status: string }).status, "blocked");

const completedSliceSummary = {
  sliceId: validSlice.id,
  title: validSlice.title,
  summary: "Contracts shipped.",
  implementationSummary: {
    ...implementation,
    docsChanged: ["docs/development-orchestrator/README.md"],
    followUpSuggestions: ["Wire parent slice runner composition."],
  },
  verificationResult,
  reviewResults: [passingReview],
  repairs: [repairResult],
  docsChanged: ["docs/development-orchestrator/slices/07-pr-draft-and-initiative-handoff.md"],
  knownLimitations: ["Parent orchestration loop remains separate."],
  followUps: ["Add real GitHub runner."],
};
const builtPrDraft = buildPrDraft({
  initiative: initiative.initiative,
  repo: initiative.repo,
  baseBranch: initiative.baseBranch,
  branch: initiative.workingBranch,
  shippedSlices: [completedSliceSummary],
});
assert.equal(builtPrDraft.title, initiative.initiative);
assert.equal(builtPrDraft.shippedSlices[0], validSlice.id);
assert.equal(builtPrDraft.repairAttempts, 1);
assert.equal(builtPrDraft.mergeRequiresHumanApproval, true);
assert.equal(builtPrDraft.body.includes("## Human Approval Checklist"), true);
assert.equal(builtPrDraft.body.includes("Wire parent slice runner composition."), true);

const githubTool = createGithubPrUpsertTool({
  run(input) {
    assert.equal(input.branch, initiative.workingBranch);
    return {
      status: "created",
      url: "https://github.com/acme/weave/pull/123",
      summary: "Created PR draft.",
    };
  },
});
assert.equal(githubTool.name, "dev.github.pr.upsert");
const githubCapabilities =
  typeof githubTool.capabilities === "function"
    ? githubTool.capabilities({
        input: {
          repo: initiative.repo,
          title: builtPrDraft.title,
          body: builtPrDraft.body,
          baseBranch: initiative.baseBranch,
          branch: initiative.workingBranch,
          draft: true,
        },
      })
    : undefined;
const githubCapabilityName = Array.isArray(githubCapabilities)
  ? githubCapabilities[0]?.name
  : (githubCapabilities as { name?: string } | undefined)?.name;
assert.equal(githubCapabilityName, "github.pr.create");

const prAgent = createPrAgent({
  githubRunner: {
    run() {
      throw new Error("runner should be represented by a tool request in replay tests");
    },
  },
});
const prInput = {
  initiative: initiative.initiative,
  repo: initiative.repo,
  baseBranch: initiative.baseBranch,
  branch: initiative.workingBranch,
  shippedSlices: [completedSliceSummary],
  github: { mode: "create" as const, draft: true },
};
const prThreadId = "pr-agent-boundary";
const prHistory = createInitialHistory(prThreadId, prInput, prAgent.name);
const prPlanner = createAgentPlanner(prAgent);
const prFirstPlan = await prPlanner.plan(prThreadId, prHistory);
assert(prFirstPlan);
assert.equal(prFirstPlan.events.some((candidate) => candidate.type === "checkpoint.completed" && candidate.stepKey === "pr-draft"), true);
const prRequest = prFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(prRequest);
assert.equal(prRequest.payload.toolName, "dev.github.pr.upsert");

const prCompletedTool: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(prThreadId, "tool.completed", "github-pr-upsert"),
  threadId: prThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: prRequest.correlationId,
  causationId: prRequest.eventId,
  scopeKey: prRequest.scopeKey,
  stepKey: prRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: prRequest.payload.toolCallId,
    output: {
      status: "created",
      url: "https://github.com/acme/weave/pull/123",
      summary: "Created PR draft.",
    },
  },
};
const prGatePlan = await prPlanner.plan(prThreadId, [...prHistory, ...prFirstPlan.events, prCompletedTool]);
assert(prGatePlan);
assert.equal(prGatePlan.events.some((candidate) => candidate.type === "dev.pr.opened"), true);
assert.equal(prGatePlan.events.some((candidate) => candidate.type === "dev.pr.ready_for_review"), true);
const prGate = prGatePlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> =>
  candidate.type === "gate.created",
);
assert(prGate);
assert.equal(prGate.payload.reason, "pr-review-approval");

const prGateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
  eventId: eventKey(prThreadId, "gate.resolved", "pr-review-approval"),
  threadId: prThreadId,
  type: "gate.resolved",
  occurredAt: nowIso(),
  correlationId: prGate.correlationId,
  causationId: prGate.eventId,
  scopeKey: prGate.scopeKey,
  stepKey: prGate.stepKey,
  actor: { type: "human", id: "maintainer" },
  payload: {
    gateId: prGate.payload.gateId,
    resolution: "approved",
    comment: "ready to merge manually",
  },
};
const prFinishedPlan = await prPlanner.plan(prThreadId, [...prHistory, ...prFirstPlan.events, prCompletedTool, ...prGatePlan.events, prGateResolved]);
assert(prFinishedPlan);
const prOutput = prFinishedPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(prOutput);
assert.equal((prOutput.payload.output as { humanApproval: string }).humanApproval, "approved");
assert.equal((prOutput.payload.output as { prUrl: string }).prUrl, "https://github.com/acme/weave/pull/123");

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
