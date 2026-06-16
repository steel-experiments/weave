import assert from "node:assert/strict";
import {
  DevelopmentCheckpointKeys,
  DevelopmentInitiativeInputSchema,
  DevelopmentBlockedRunnerError,
  DevelopmentSlicePlanSchema,
  DevelopmentWorkspacePolicySchema,
  FinalizationConfigSchema,
  FinalizationResultSchema,
  InitiativePlanSchema,
  InitiativeSpecSchema,
  compileInitiativePlan,
  compileMarkdownInitiativePlan,
  createMarkdownInitiativePlanCompiler,
  InitiativeExecutionStateSchema,
  SliceExecutionStateSchema,
  SliceRunnerInputSchema,
  SourceCheckpointFailedSchema,
  SourceCheckpointProposedSchema,
  SourceCheckpointRestoredSchema,
  SourceCheckpointSchema,
  ImplementationSummarySchema,
  OpenCodeImplementerInputSchema,
  PrDraftInputSchema,
  VerificationAgentInputSchema,
  PrDraftResultSchema,
  RepairAgentInputSchema,
  RepairResultSchema,
  ReviewResultSchema,
  VerificationResultSchema,
  buildPrDraft,
  buildPrHandoffArtifact,
  buildWorkspaceAllocateInput,
  createGithubPrUpsertTool,
  createLocalMergeFinalizationTool,
  buildDevelopmentSlicePlan,
  createOpenCodeImplementationTool,
  createOpenCodeImplementerAgent,
  createPrAgent,
  createRepairAgent,
  createRepairTool,
  createSliceRunnerAgent,
  createReviewerAgent,
  createReviewerTool,
  createVerificationAgent,
  createVerificationTool,
  developmentBranchStateReadTool,
  developmentRepoContextReadTool,
  developmentEvents,
  createInitialSliceExecutionState,
  createInitialInitiativeExecutionState,
  createWeaveMaintainerAgent,
  decideNextSliceAction,
  decideNextInitiativeAction,
  decideRepairLoop,
  shouldCleanupWorkspace,
  evaluateOpenCodeImplementerInput,
  evaluateSliceReadinessForCompletion,
  evaluateSliceBranchState,
  outOfScopeImplementationFiles,
  readDevelopmentRepoContext,
  repairAttemptKey,
  weaveMaintainer,
  weaveSliceRunner,
} from "../development-orchestrator.js";
import { createAgentPlanner, isDomainEvent, ThreadEventSchema, deterministicUuid, eventKey, nowIso, stableJsonHash, type ThreadEvent, type WorkspaceProvider } from "weave";

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
assert.deepEqual(initiative.slices?.[0]?.expectedTouchpoints, []);
assert.deepEqual(initiative.slices?.[0]?.verificationStrategy, []);

const initiativeSpec = InitiativeSpecSchema.parse({
  title: "Automate PRD-backed development initiatives",
  statementOfWork: "Accept a PRD, propose slices, wait for approval, execute slices, and produce a PR handoff.",
  source: "prd",
  goals: ["Compile PRDs into slices", "Require human approval before execution"],
  nonGoals: ["Do not build the dashboard yet"],
  constraints: ["Keep OpenCode as a bounded worker"],
  acceptanceCriteria: ["Generated plans are schema validated"],
  risks: ["Generated slices may be too large"],
  implementationHints: ["Reuse development orchestrator contracts"],
  affectedAreas: ["examples/weave-maintainer/src/development-orchestrator.ts", "examples/weave-maintainer/docs/slices/"],
  contextFiles: ["examples/weave-maintainer/docs/README.md"],
});

assert.equal(initiativeSpec.source, "prd");
assert.deepEqual(
  InitiativeSpecSchema.parse({
    title: "Small SOW",
    statementOfWork: "Do one bounded thing.",
  }).goals,
  [],
);
assert.equal(
  InitiativeSpecSchema.safeParse({
    title: "Missing body",
    statementOfWork: "",
  }).success,
  false,
);

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
  specTitle: initiativeSpec.title,
  goals: initiativeSpec.goals,
  constraints: initiativeSpec.constraints,
  acceptanceCriteria: initiativeSpec.acceptanceCriteria,
  risks: initiativeSpec.risks,
  affectedAreas: initiativeSpec.affectedAreas,
  slices: [validSlice],
  approvalRequired: true,
  summary: "One bounded contracts slice.",
  revisionHistory: [{ revision: 1, reason: "Initial compiler proposal.", changedBy: "weave.maintainer" }],
});

assert.equal(plan.slices.length, 1);
assert.equal(plan.status, "proposed");
assert.equal(plan.revision, 1);
assert.equal(plan.specTitle, initiativeSpec.title);
assert.deepEqual(plan.goals, initiativeSpec.goals);
assert.equal(InitiativePlanSchema.safeParse({ ...plan, slices: [] }).success, false);
assert.equal(
  InitiativePlanSchema.parse({
    ...plan,
    status: "approved",
    decision: { status: "approved", decidedBy: "human-maintainer", note: "Plan looks safe." },
  }).decision?.status,
  "approved",
);
assert.equal(DevelopmentCheckpointKeys.initiativeSpec, "initiative-spec");
assert.equal(DevelopmentCheckpointKeys.proposedInitiativePlan, "proposed-initiative-plan");
assert.equal(DevelopmentCheckpointKeys.approvedInitiativePlan, "approved-initiative-plan");
assert.equal(DevelopmentCheckpointKeys.latestPlanDecision, "latest-plan-decision");
assert.equal(DevelopmentCheckpointKeys.approvedSlicePlan, "approved-slice-plan");
assert.equal(DevelopmentCheckpointKeys.workspaceRef, "workspace-ref");
assert.equal(DevelopmentCheckpointKeys.sourceCheckpoint, "source-checkpoint");
assert.equal(DevelopmentCheckpointKeys.finalizationResult, "finalization-result");
assert.equal(buildDevelopmentSlicePlan(initiative).summary, "Plan 1 development slice for Build Weave Maintainer.");

const compiledPlan = compileMarkdownInitiativePlan({
  spec: {
    ...initiativeSpec,
    statementOfWork: `Build automation for PRD-backed initiatives.

## Slice 1: Initiative compiler boundary

Add a compiler that turns a PRD into a validated plan.

### Acceptance Criteria

- Compiler output validates before persistence.
- Compilation emits no implementation events.

Expected files include \`examples/weave-maintainer/src/development-orchestrator.ts\`.

## Slice 2: Operator approval flow

Add commands to inspect and approve generated plans.

### Acceptance Criteria

- Pending gates can be listed.
- Approvals are durable.
`,
  },
  repo: initiative.repo,
  baseBranch: initiative.baseBranch,
  workingBranch: initiative.workingBranch,
  contextFiles: initiative.contextFiles,
});

assert.equal(compiledPlan.slices.length, 2);
assert.equal(compiledPlan.slices[0]?.id, "01-initiative-compiler-boundary");
assert.equal(compiledPlan.slices[0]?.verificationStrategy.includes("npm test"), true);
assert.equal(compiledPlan.slices[0]?.expectedTouchpoints.includes("examples/weave-maintainer/src/development-orchestrator.ts"), true);
assert.deepEqual(compiledPlan.slices[1]?.acceptanceCriteria, ["Pending gates can be listed.", "Approvals are durable."]);
assert.equal(compiledPlan.status, "proposed");

const markdownCompiler = createMarkdownInitiativePlanCompiler({ defaultReviewers: ["architecture-reviewer", "docs-reviewer"] });
const validatedCompiledPlan = await compileInitiativePlan(
  {
    spec: initiativeSpec,
    repo: initiative.repo,
    baseBranch: initiative.baseBranch,
    workingBranch: initiative.workingBranch,
    contextFiles: initiative.contextFiles,
  },
  markdownCompiler,
);

assert.equal(validatedCompiledPlan.slices.length, 1);
assert.deepEqual(validatedCompiledPlan.slices[0]?.requiredReviewers, ["architecture-reviewer", "docs-reviewer"]);
await assert.rejects(
  () =>
    compileInitiativePlan(
      {
        spec: initiativeSpec,
        repo: initiative.repo,
        baseBranch: initiative.baseBranch,
        workingBranch: initiative.workingBranch,
      },
      {
        compile() {
          return { ...validatedCompiledPlan, repo: "other-repo" };
        },
      },
    ),
  /does not match requested repo/,
);
await assert.rejects(
  () =>
    compileInitiativePlan(
      {
        spec: initiativeSpec,
        repo: initiative.repo,
        baseBranch: initiative.baseBranch,
        workingBranch: initiative.workingBranch,
      },
      {
        compile() {
          return { ...validatedCompiledPlan, slices: [] };
        },
      },
    ),
  /Too small/,
);

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
  filesChanged: ["examples/weave-maintainer/src/development-orchestrator.ts"],
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

const sourceCheckpoint = SourceCheckpointSchema.parse({
  checkpointId: deterministicUuid("source-checkpoint", validSlice.id),
  initiativeThreadId: "initiative-thread-01",
  sliceThreadId: "slice-thread-01",
  sliceId: validSlice.id,
  title: validSlice.title,
  workspaceRef,
  baseSha: "abc123",
  checkpointSha: "def456",
  changedFiles: ["examples/weave-maintainer/src/development-orchestrator.ts", "src/events.ts"],
  commitMessage: "feat(dev-orchestrator): add source checkpoint contracts",
  verificationSummary: {
    status: "passed",
    commands: verification.commands,
  },
  reviewSummary: [
    {
      reviewer: "architecture-reviewer",
      verdict: "pass",
      findingCount: 0,
    },
  ],
});

assert.equal(sourceCheckpoint.workspaceRef.workingBranch, initiative.workingBranch);
assert.equal(sourceCheckpoint.verificationSummary.commands[0]?.command, "npm test");
assert.equal(SourceCheckpointSchema.safeParse({ ...sourceCheckpoint, changedFiles: [] }).success, false);
assert.equal(SourceCheckpointProposedSchema.parse({ ...sourceCheckpoint, checkpointSha: undefined }).baseSha, "abc123");
assert.equal(
  SourceCheckpointFailedSchema.parse({
    initiativeThreadId: sourceCheckpoint.initiativeThreadId,
    sliceThreadId: sourceCheckpoint.sliceThreadId,
    sliceId: sourceCheckpoint.sliceId,
    reason: "No source changes to checkpoint.",
  }).changedFiles.length,
  0,
);
const restoredCheckpoint = SourceCheckpointRestoredSchema.parse({
  checkpointId: sourceCheckpoint.checkpointId,
  initiativeThreadId: sourceCheckpoint.initiativeThreadId,
  sliceThreadId: sourceCheckpoint.sliceThreadId,
  sliceId: sourceCheckpoint.sliceId,
  title: sourceCheckpoint.title,
  workspaceRef,
  restoredBy: "operator",
  fromSha: "fedcba",
  checkpointSha: sourceCheckpoint.checkpointSha,
  restoredSha: sourceCheckpoint.checkpointSha,
  dirtyBefore: false,
  forced: false,
  restoredAt: nowIso(),
});
assert.equal(restoredCheckpoint.restoredSha, sourceCheckpoint.checkpointSha);

const review = ReviewResultSchema.parse({
  reviewer: "architecture-reviewer",
  verdict: "needs-fixes",
  findings: [
    {
      severity: "medium",
      file: "examples/weave-maintainer/src/development-orchestrator.ts",
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

assert.equal(sliceCompleted.payload.kind, "dev.slice.completed");
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
  type: "domain.event",
  occurredAt: nowIso(),
  actor: { type: "agent", id: "weave.maintainer" },
  payload: sliceCompleted.payload,
});

assert.ok(isDomainEvent(parsedThreadEvent, "dev.slice.completed"));
assert.deepEqual(parsedThreadEvent.payload, sliceCompleted.payload);

const specReceived = developmentEvents.initiativeSpecReceived({
  title: initiativeSpec.title,
  source: initiativeSpec.source,
  summary: initiativeSpec.summary,
  goals: initiativeSpec.goals,
  acceptanceCriteria: initiativeSpec.acceptanceCriteria,
  contextFiles: initiativeSpec.contextFiles,
});

assert.equal(specReceived.payload.kind, "dev.initiative.spec_received");

const planProposed = developmentEvents.initiativePlanProposed({
  initiative: plan.initiative,
  repo: plan.repo,
  workingBranch: plan.workingBranch,
  revision: plan.revision,
  sliceCount: plan.slices.length,
  summary: plan.summary,
});

assert.equal(planProposed.payload.kind, "dev.initiative.plan_proposed");

const parsedPlanEvent = ThreadEventSchema.parse({
  eventId: eventKey("dev-thread", "dev.initiative.plan_proposed", "plan-proposed"),
  threadId: "dev-thread",
  type: "domain.event",
  occurredAt: nowIso(),
  actor: { type: "agent", id: "weave.maintainer" },
  payload: planProposed.payload,
});

assert.ok(isDomainEvent(parsedPlanEvent, "dev.initiative.plan_proposed"));
assert.deepEqual(parsedPlanEvent.payload, planProposed.payload);
assert.equal(
  developmentEvents.initiativePlanApproved({
    initiative: plan.initiative,
    revision: plan.revision,
    approvedBy: "human-maintainer",
    sliceCount: plan.slices.length,
    summary: plan.summary,
  }).payload.kind,
  "dev.initiative.plan_approved",
);
assert.equal(
  developmentEvents.initiativePlanRejected({
    initiative: plan.initiative,
    revision: plan.revision,
    rejectedBy: "human-maintainer",
    reason: "Too broad.",
  }).payload.kind,
  "dev.initiative.plan_rejected",
);

const reviewCompleted = developmentEvents.reviewCompleted({
  sliceId: validSlice.id,
  reviewer: "architecture-reviewer",
  verdict: "pass",
  findings: [],
});

assert.equal(reviewCompleted.payload.kind, "dev.review.completed");
assert.equal(developmentEvents.prReadyForReview.kind, "dev.pr.ready_for_review");

const sourceCheckpointCreated = developmentEvents.sourceCheckpointCreated(sourceCheckpoint);
assert.equal(sourceCheckpointCreated.payload.kind, "dev.source_checkpoint.created");
const { checkpointSha: _checkpointSha, createdAt: _createdAt, ...sourceCheckpointProposal } = sourceCheckpoint;
assert.equal(developmentEvents.sourceCheckpointProposed(sourceCheckpointProposal).payload.kind, "dev.source_checkpoint.proposed");
assert.equal(
  developmentEvents.sourceCheckpointFailed({
    initiativeThreadId: sourceCheckpoint.initiativeThreadId,
    sliceThreadId: sourceCheckpoint.sliceThreadId,
    sliceId: sourceCheckpoint.sliceId,
    workspaceRef,
    baseSha: sourceCheckpoint.baseSha,
    changedFiles: sourceCheckpoint.changedFiles,
    commitMessage: sourceCheckpoint.commitMessage,
    reason: "git commit failed",
    errorCode: "git-commit-failed",
  }).payload.kind,
  "dev.source_checkpoint.failed",
);

const parsedCheckpointEvent = ThreadEventSchema.parse({
  eventId: eventKey("dev-thread", "dev.source_checkpoint.created", "source-checkpoint-created"),
  threadId: "dev-thread",
  type: "domain.event",
  occurredAt: nowIso(),
  actor: { type: "agent", id: "weave.sliceRunner" },
  payload: sourceCheckpointCreated.payload,
});

assert.ok(isDomainEvent(parsedCheckpointEvent, "dev.source_checkpoint.created"));
assert.deepEqual(parsedCheckpointEvent.payload, sourceCheckpointCreated.payload);

const sourceCheckpointRestored = developmentEvents.sourceCheckpointRestored(restoredCheckpoint);
assert.equal(sourceCheckpointRestored.payload.kind, "dev.source_checkpoint.restored");
const parsedRestoredEvent = ThreadEventSchema.parse({
  eventId: eventKey("dev-thread", "dev.source_checkpoint.restored", "source-checkpoint-restored"),
  threadId: "dev-thread",
  type: "domain.event",
  occurredAt: nowIso(),
  actor: { type: "human", id: "operator" },
  payload: sourceCheckpointRestored.payload,
});
assert.ok(isDomainEvent(parsedRestoredEvent, "dev.source_checkpoint.restored"));
assert.deepEqual(parsedRestoredEvent.payload, sourceCheckpointRestored.payload);

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
assert.equal(firstPlan.events.some((candidate) => isDomainEvent(candidate, "dev.initiative.started")), true);
assert.equal(firstPlan.events.some((candidate) => isDomainEvent(candidate, "dev.slice.proposed")), false);

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
assert.equal(plannedAfterContext.events.some((candidate) => isDomainEvent(candidate, "dev.slice.proposed")), true);

const gateCreated = plannedAfterContext.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> =>
  candidate.type === "gate.created",
);
assert(gateCreated);
assert.equal(gateCreated.payload.reason, "slice-plan-approval");
assert.equal(gateCreated.stepKey, "approve-slice-plan");

const pendingPlan = await planner.plan(threadId, [...initialHistory, ...firstPlan.events, contextCompleted, ...plannedAfterContext.events]);
assert.equal(pendingPlan, null);

const compilerThreadId = "development-prd-compiler";
const compilerInitiative = DevelopmentInitiativeInputSchema.parse({
  initiative: initiativeSpec.title,
  repo: "weave",
  baseBranch: "main",
  workingBranch: "prd-backed-automation",
  contextFiles: ["examples/weave-maintainer/docs/README.md"],
  initiativeSpec: {
    ...initiativeSpec,
    statementOfWork: `Build the next automation layer.

## Slice 1: PRD compiler

Convert a PRD into proposed implementation slices.

### Acceptance Criteria

- Plans are schema validated.
- No implementation starts during compilation.
`,
  },
});
const compilerPlanner = createAgentPlanner(createWeaveMaintainerAgent({ planCompiler: createMarkdownInitiativePlanCompiler() }));
const compilerInitialHistory = createInitialHistory(compilerThreadId, compilerInitiative);
const compilerFirstPlan = await compilerPlanner.plan(compilerThreadId, compilerInitialHistory);
assert(compilerFirstPlan);
assert.equal(compilerFirstPlan.events.some((candidate) => isDomainEvent(candidate, "dev.initiative.spec_received")), true);
const compilerContextRequest = compilerFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(compilerContextRequest);
const compilerContextCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(compilerThreadId, "tool.completed", "read-repo-context"),
  threadId: compilerThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: compilerContextRequest.correlationId,
  causationId: compilerContextRequest.eventId,
  scopeKey: compilerContextRequest.scopeKey,
  stepKey: compilerContextRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: compilerContextRequest.payload.toolCallId,
    output: {
      repo: "weave",
      filesRead: ["examples/weave-maintainer/docs/README.md"],
      totalBytes: 16,
      truncated: false,
      entries: [{ path: "examples/weave-maintainer/docs/README.md", kind: "file", bytes: 16, content: "orchestrator docs" }],
    },
  },
};
const compilerPlanned = await compilerPlanner.plan(compilerThreadId, [
  ...compilerInitialHistory,
  ...compilerFirstPlan.events,
  compilerContextCompleted,
]);
assert(compilerPlanned);
assert.equal(compilerPlanned.events.some((candidate) => isDomainEvent(candidate, "dev.initiative.plan_proposed")), true);
assert.equal(compilerPlanned.events.some((candidate) => isDomainEvent(candidate, "dev.slice.proposed")), true);
assert.equal(compilerPlanned.events.some((candidate) => isDomainEvent(candidate, "dev.implementation.started")), false);
assert.equal(
  compilerPlanned.events.some(
    (candidate) =>
      candidate.type === "checkpoint.completed" &&
      candidate.payload.stepKey === DevelopmentCheckpointKeys.proposedInitiativePlan &&
      InitiativePlanSchema.safeParse(candidate.payload.value).success,
  ),
  true,
);

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
assert.equal(approvedPlan.events.some((candidate) => isDomainEvent(candidate, "dev.slice.approved")), true);
assert.equal(approvedPlan.events.at(-1)?.type, "agent.output.completed");

const outputCompleted = approvedPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(outputCompleted);
assert.equal((outputCompleted.payload.output as { status: string }).status, "approved");
assert.deepEqual((outputCompleted.payload.output as { repoContext: { filesRead: string[] } }).repoContext.filesRead, ["AGENTS.md"]);

const secondSlice = {
  id: "02-runner",
  title: "Slice Runner",
  objective: "Run one slice end-to-end.",
  acceptanceCriteria: ["Slice completes"],
  requiredReviewers: ["architecture-reviewer" as const],
};
const sequenceInitiative = DevelopmentInitiativeInputSchema.parse({
  ...initiative,
  slices: [{ ...validSlice, requiredReviewers: ["architecture-reviewer" as const] }, secondSlice],
});
const sequencePlan = buildDevelopmentSlicePlan(sequenceInitiative);
const sequenceInitialState = createInitialInitiativeExecutionState({ plan: sequencePlan });
assert.equal(InitiativeExecutionStateSchema.parse(sequenceInitialState).phase, "approved");
assert.equal(decideNextInitiativeAction(sequenceInitialState).type, "run-slice");

const sequenceSliceOutput = (sliceId: string, title: string) => ({
  status: "completed" as const,
  sliceId,
  branch: sequenceInitiative.workingBranch,
  workspaceRef,
  implementationSummary: implementation,
  verificationResult: verification,
  reviewResults: [{ ...review, reviewer: "architecture-reviewer" as const, verdict: "pass" as const, findings: [] }],
  repairs: [],
  summary: `${title} completed.`,
});
const firstSliceOutput = sequenceSliceOutput(sequencePlan.slices[0]!.id, sequencePlan.slices[0]!.title);
const secondSliceOutput = sequenceSliceOutput(sequencePlan.slices[1]!.id, sequencePlan.slices[1]!.title);
const firstCompletedSummary = {
  sliceId: sequencePlan.slices[0]!.id,
  title: sequencePlan.slices[0]!.title,
  summary: firstSliceOutput.summary,
  implementationSummary: implementation,
  verificationResult: verification,
  reviewResults: firstSliceOutput.reviewResults,
  repairs: [],
  docsChanged: [],
  knownLimitations: [],
  followUps: [],
};
const secondCompletedSummary = {
  sliceId: sequencePlan.slices[1]!.id,
  title: sequencePlan.slices[1]!.title,
  summary: secondSliceOutput.summary,
  implementationSummary: implementation,
  verificationResult: verification,
  reviewResults: secondSliceOutput.reviewResults,
  repairs: [],
  docsChanged: [],
  knownLimitations: [],
  followUps: [],
};
const afterOneSliceState = createInitialInitiativeExecutionState({ plan: sequencePlan, completedSlices: [firstCompletedSummary] });
assert.deepEqual(decideNextInitiativeAction(afterOneSliceState), { type: "run-slice", slice: sequencePlan.slices[1]!, index: 1 });
const prDraftInput = PrDraftInputSchema.parse({
  initiative: sequencePlan.initiative,
  repo: sequencePlan.repo,
  baseBranch: sequencePlan.baseBranch,
  branch: sequencePlan.workingBranch,
  shippedSlices: [firstCompletedSummary, secondCompletedSummary],
  github: { mode: "none", draft: true },
});
const prDraftOutput = buildPrDraft(prDraftInput);
assert.equal(
  decideNextInitiativeAction(createInitialInitiativeExecutionState({ plan: sequencePlan, completedSlices: [firstCompletedSummary, secondCompletedSummary] })).type,
  "run-pr-draft",
);
assert.equal(
  decideNextInitiativeAction(createInitialInitiativeExecutionState({ plan: sequencePlan, completedSlices: [firstCompletedSummary, secondCompletedSummary], prDraft: prDraftOutput })).type,
  "complete-initiative",
);

const sequenceMaintainer = createWeaveMaintainerAgent({ sliceRunnerAgent: weaveSliceRunner, prAgent: createPrAgent() });
const sequenceThreadId = "initiative-sequencing-complete";
const firstSliceRunnerInput = SliceRunnerInputSchema.parse({
  initiativeThreadId: sequenceThreadId,
  initiative: sequencePlan.initiative,
  repo: sequencePlan.repo,
  branch: sequencePlan.workingBranch,
  slice: sequencePlan.slices[0]!,
  workspacePolicy: sequenceInitiative.workspacePolicy,
  maxRepairAttempts: 1,
});
const secondSliceRunnerInput = SliceRunnerInputSchema.parse({
  initiativeThreadId: sequenceThreadId,
  initiative: sequencePlan.initiative,
  repo: sequencePlan.repo,
  branch: sequencePlan.workingBranch,
  slice: sequencePlan.slices[1]!,
  workspacePolicy: sequenceInitiative.workspacePolicy,
  maxRepairAttempts: 1,
});
const sequenceHistory = [
  ...createInitialHistory(sequenceThreadId, sequenceInitiative, sequenceMaintainer.name),
  childSpawnedEvent(sequenceThreadId, `slice:${sequencePlan.slices[0]!.id}`, weaveSliceRunner.name, "sequence-child-slice-1", firstSliceRunnerInput, `Run development slice ${sequencePlan.slices[0]!.id}: ${sequencePlan.slices[0]!.title}`, sequenceMaintainer.name),
  childSpawnedEvent(sequenceThreadId, `slice:${sequencePlan.slices[1]!.id}`, weaveSliceRunner.name, "sequence-child-slice-2", secondSliceRunnerInput, `Run development slice ${sequencePlan.slices[1]!.id}: ${sequencePlan.slices[1]!.title}`, sequenceMaintainer.name),
  childSpawnedEvent(sequenceThreadId, "pr-draft", createPrAgent().name, "sequence-child-pr", prDraftInput, `Draft PR handoff for ${sequencePlan.initiative}.`, sequenceMaintainer.name),
];
const sequencePlanner = createAgentPlanner(sequenceMaintainer);
const sequenceFirstPlan = await sequencePlanner.plan(sequenceThreadId, sequenceHistory);
assert(sequenceFirstPlan);
const sequenceContextRequest = sequenceFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(sequenceContextRequest);
const sequenceContextCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  ...contextCompleted,
  eventId: eventKey(sequenceThreadId, "tool.completed", "read-repo-context"),
  threadId: sequenceThreadId,
  correlationId: sequenceContextRequest.correlationId,
  causationId: sequenceContextRequest.eventId,
  scopeKey: sequenceContextRequest.scopeKey,
  stepKey: sequenceContextRequest.stepKey,
  payload: { ...contextCompleted.payload, toolCallId: sequenceContextRequest.payload.toolCallId },
};
const sequencePlanned = await sequencePlanner.plan(sequenceThreadId, [...sequenceHistory, ...sequenceFirstPlan.events, sequenceContextCompleted]);
assert(sequencePlanned);
const sequenceGate = sequencePlanned.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> =>
  candidate.type === "gate.created",
);
assert(sequenceGate);
const sequenceGateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
  eventId: eventKey(sequenceThreadId, "gate.resolved", "approve-slice-plan"),
  threadId: sequenceThreadId,
  type: "gate.resolved",
  occurredAt: nowIso(),
  correlationId: sequenceGate.correlationId,
  causationId: sequenceGate.eventId,
  scopeKey: sequenceGate.scopeKey,
  stepKey: sequenceGate.stepKey,
  actor: { type: "human", id: "maintainer" },
  payload: { gateId: sequenceGate.payload.gateId, resolution: "approved", comment: "run slices" },
};
const sequenceAfterApproval = await sequencePlanner.plan(sequenceThreadId, [
  ...sequenceHistory,
  ...sequenceFirstPlan.events,
  sequenceContextCompleted,
  ...sequencePlanned.events,
  sequenceGateResolved,
]);
assert(sequenceAfterApproval);
assert.equal(sequenceAfterApproval.events.some((candidate) => candidate.type === "agent.output.completed"), false);
const sequenceCompleted = await sequencePlanner.plan(sequenceThreadId, [
  ...sequenceHistory,
  ...sequenceFirstPlan.events,
  sequenceContextCompleted,
  ...sequencePlanned.events,
  sequenceGateResolved,
  ...sequenceAfterApproval.events,
  childCompletedEvent(sequenceThreadId, `wait-slice:${sequencePlan.slices[0]!.id}`, "sequence-child-slice-1", weaveSliceRunner.name, firstSliceOutput, sequenceMaintainer.name),
  childCompletedEvent(sequenceThreadId, `wait-slice:${sequencePlan.slices[1]!.id}`, "sequence-child-slice-2", weaveSliceRunner.name, secondSliceOutput, sequenceMaintainer.name),
  childCompletedEvent(sequenceThreadId, "wait-pr-draft", "sequence-child-pr", createPrAgent().name, prDraftOutput, sequenceMaintainer.name),
]);
assert(sequenceCompleted);
const sequenceOutput = sequenceCompleted.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(sequenceOutput);
assert.equal((sequenceOutput.payload.output as { status: string }).status, "completed");
assert.equal((sequenceOutput.payload.output as { completedSlices: unknown[] }).completedSlices.length, 2);
assert.equal((sequenceOutput.payload.output as { prDraft?: unknown }).prDraft !== undefined, true);

const blockedMaintainer = createWeaveMaintainerAgent({ sliceRunnerAgent: weaveSliceRunner });
const blockedSequenceThreadId = "initiative-sequencing-blocked";
const blockedFirstSliceRunnerInput = SliceRunnerInputSchema.parse({ ...firstSliceRunnerInput, initiativeThreadId: blockedSequenceThreadId });
const blockedSequenceHistory = [
  ...createInitialHistory(blockedSequenceThreadId, sequenceInitiative, blockedMaintainer.name),
  childSpawnedEvent(blockedSequenceThreadId, `slice:${sequencePlan.slices[0]!.id}`, weaveSliceRunner.name, "blocked-child-slice-1", blockedFirstSliceRunnerInput, `Run development slice ${sequencePlan.slices[0]!.id}: ${sequencePlan.slices[0]!.title}`, blockedMaintainer.name),
];
const blockedPlanner = createAgentPlanner(blockedMaintainer);
const blockedFirstPlan = await blockedPlanner.plan(blockedSequenceThreadId, blockedSequenceHistory);
assert(blockedFirstPlan);
const blockedContextRequest = blockedFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(blockedContextRequest);
const blockedContextCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  ...contextCompleted,
  eventId: eventKey(blockedSequenceThreadId, "tool.completed", "read-repo-context"),
  threadId: blockedSequenceThreadId,
  correlationId: blockedContextRequest.correlationId,
  causationId: blockedContextRequest.eventId,
  scopeKey: blockedContextRequest.scopeKey,
  stepKey: blockedContextRequest.stepKey,
  payload: { ...contextCompleted.payload, toolCallId: blockedContextRequest.payload.toolCallId },
};
const blockedPlanned = await blockedPlanner.plan(blockedSequenceThreadId, [...blockedSequenceHistory, ...blockedFirstPlan.events, blockedContextCompleted]);
assert(blockedPlanned);
const blockedGate = blockedPlanned.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> => candidate.type === "gate.created");
assert(blockedGate);
const blockedGateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
  ...sequenceGateResolved,
  eventId: eventKey(blockedSequenceThreadId, "gate.resolved", "approve-slice-plan"),
  threadId: blockedSequenceThreadId,
  correlationId: blockedGate.correlationId,
  causationId: blockedGate.eventId,
  scopeKey: blockedGate.scopeKey,
  stepKey: blockedGate.stepKey,
  payload: { gateId: blockedGate.payload.gateId, resolution: "approved", comment: "run slices" },
};
const blockedOutputPlan = await blockedPlanner.plan(blockedSequenceThreadId, [
  ...blockedSequenceHistory,
  ...blockedFirstPlan.events,
  blockedContextCompleted,
  ...blockedPlanned.events,
  blockedGateResolved,
  childCompletedEvent(
    blockedSequenceThreadId,
    `wait-slice:${sequencePlan.slices[0]!.id}`,
    "blocked-child-slice-1",
    weaveSliceRunner.name,
    { status: "failed", sliceId: sequencePlan.slices[0]!.id, branch: sequencePlan.workingBranch, reason: "slice failed", findings: [] },
    blockedMaintainer.name,
  ),
]);
assert(blockedOutputPlan);
const blockedSequenceOutput = blockedOutputPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(blockedSequenceOutput);
assert.equal((blockedSequenceOutput.payload.output as { status: string }).status, "blocked");
assert.equal((blockedSequenceOutput.payload.output as { blockedSlice: string }).blockedSlice, sequencePlan.slices[0]!.id);

const defaultWorkspacePolicy = DevelopmentWorkspacePolicySchema.parse({});
assert.equal(defaultWorkspacePolicy.mode, "initiative");
assert.equal(defaultWorkspacePolicy.cleanupOnSuccess, false);
assert.equal(shouldCleanupWorkspace({ policy: defaultWorkspacePolicy, outcome: "failure" }), false);
assert.equal(shouldCleanupWorkspace({ policy: { ...defaultWorkspacePolicy, cleanupOnSuccess: true }, outcome: "success" }), true);
assert.deepEqual(
  buildWorkspaceAllocateInput({
    policy: { ...defaultWorkspacePolicy, sourceRepoPath: "/repo/weave", workspaceRoot: "/tmp/weave-workspaces" },
    plan: sequencePlan,
  }).metadata,
  { workspaceMode: "initiative" },
);

const fakeWorkspaceProvider: WorkspaceProvider = {
  name: "git-worktree",
  async allocate() {
    throw new Error("workspace provider should be replayed in this test");
  },
  async state() {
    throw new Error("workspace state should not run in this test");
  },
  async diff() {
    throw new Error("workspace diff should not run in this test");
  },
  async remove() {
    throw new Error("workspace remove should be replayed in this test");
  },
};
const lifecycleWorkspaceRef = {
  ...workspaceRef,
  workspaceId: "initiative-workspace",
  path: "/tmp/weave-workspaces/weave/initiative-workspace",
  metadata: { workspaceMode: "initiative" },
};
const lifecyclePolicy = DevelopmentWorkspacePolicySchema.parse({
  sourceRepoPath: "/repo/weave",
  workspaceRoot: "/tmp/weave-workspaces",
  cleanupOnSuccess: true,
});
const lifecycleInitiative = DevelopmentInitiativeInputSchema.parse({
  ...sequenceInitiative,
  workspacePolicy: lifecyclePolicy,
});
const lifecyclePlan = buildDevelopmentSlicePlan(lifecycleInitiative);
const lifecycleFirstSliceInput = SliceRunnerInputSchema.parse({
  initiativeThreadId: "initiative-workspace-lifecycle",
  initiative: lifecyclePlan.initiative,
  repo: lifecyclePlan.repo,
  branch: lifecyclePlan.workingBranch,
  slice: lifecyclePlan.slices[0]!,
  workspaceRef: lifecycleWorkspaceRef,
  workspacePolicy: lifecyclePolicy,
  maxRepairAttempts: 1,
});
const lifecycleSecondSliceInput = SliceRunnerInputSchema.parse({
  initiativeThreadId: "initiative-workspace-lifecycle",
  initiative: lifecyclePlan.initiative,
  repo: lifecyclePlan.repo,
  branch: lifecyclePlan.workingBranch,
  slice: lifecyclePlan.slices[1]!,
  workspaceRef: lifecycleWorkspaceRef,
  workspacePolicy: lifecyclePolicy,
  maxRepairAttempts: 1,
});
const lifecycleMaintainer = createWeaveMaintainerAgent({ sliceRunnerAgent: weaveSliceRunner, workspaceProvider: fakeWorkspaceProvider });
const lifecycleThreadId = "initiative-workspace-lifecycle";
const lifecycleHistory = [
  ...createInitialHistory(lifecycleThreadId, lifecycleInitiative, lifecycleMaintainer.name),
  childSpawnedEvent(lifecycleThreadId, `slice:${lifecyclePlan.slices[0]!.id}`, weaveSliceRunner.name, "lifecycle-child-slice-1", lifecycleFirstSliceInput, `Run development slice ${lifecyclePlan.slices[0]!.id}: ${lifecyclePlan.slices[0]!.title}`, lifecycleMaintainer.name),
  childSpawnedEvent(lifecycleThreadId, `slice:${lifecyclePlan.slices[1]!.id}`, weaveSliceRunner.name, "lifecycle-child-slice-2", lifecycleSecondSliceInput, `Run development slice ${lifecyclePlan.slices[1]!.id}: ${lifecyclePlan.slices[1]!.title}`, lifecycleMaintainer.name),
];
const lifecyclePlanner = createAgentPlanner(lifecycleMaintainer);
const lifecycleFirstPlan = await lifecyclePlanner.plan(lifecycleThreadId, lifecycleHistory);
assert(lifecycleFirstPlan);
const lifecycleContextRequest = lifecycleFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(lifecycleContextRequest);
const lifecycleContextCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  ...contextCompleted,
  eventId: eventKey(lifecycleThreadId, "tool.completed", "read-repo-context"),
  threadId: lifecycleThreadId,
  correlationId: lifecycleContextRequest.correlationId,
  causationId: lifecycleContextRequest.eventId,
  scopeKey: lifecycleContextRequest.scopeKey,
  stepKey: lifecycleContextRequest.stepKey,
  payload: { ...contextCompleted.payload, toolCallId: lifecycleContextRequest.payload.toolCallId },
};
const lifecyclePlanned = await lifecyclePlanner.plan(lifecycleThreadId, [...lifecycleHistory, ...lifecycleFirstPlan.events, lifecycleContextCompleted]);
assert(lifecyclePlanned);
const lifecycleGate = lifecyclePlanned.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> => candidate.type === "gate.created");
assert(lifecycleGate);
const lifecycleGateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
  ...sequenceGateResolved,
  eventId: eventKey(lifecycleThreadId, "gate.resolved", "approve-slice-plan"),
  threadId: lifecycleThreadId,
  correlationId: lifecycleGate.correlationId,
  causationId: lifecycleGate.eventId,
  scopeKey: lifecycleGate.scopeKey,
  stepKey: lifecycleGate.stepKey,
  payload: { gateId: lifecycleGate.payload.gateId, resolution: "approved", comment: "allocate workspace" },
};
const lifecycleAfterApproval = await lifecyclePlanner.plan(lifecycleThreadId, [
  ...lifecycleHistory,
  ...lifecycleFirstPlan.events,
  lifecycleContextCompleted,
  ...lifecyclePlanned.events,
  lifecycleGateResolved,
]);
assert(lifecycleAfterApproval);
const lifecycleAllocateRequest = lifecycleAfterApproval.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested" && candidate.payload.toolName === "workspace.allocate",
);
assert(lifecycleAllocateRequest);
const lifecycleAllocateCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(lifecycleThreadId, "tool.completed", "workspace-allocate-initiative"),
  threadId: lifecycleThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: lifecycleAllocateRequest.correlationId,
  causationId: lifecycleAllocateRequest.eventId,
  scopeKey: lifecycleAllocateRequest.scopeKey,
  stepKey: lifecycleAllocateRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: { toolCallId: lifecycleAllocateRequest.payload.toolCallId, output: lifecycleWorkspaceRef },
};
const lifecycleCleanupPlan = await lifecyclePlanner.plan(lifecycleThreadId, [
  ...lifecycleHistory,
  ...lifecycleFirstPlan.events,
  lifecycleContextCompleted,
  ...lifecyclePlanned.events,
  lifecycleGateResolved,
  ...lifecycleAfterApproval.events,
  lifecycleAllocateCompleted,
  childCompletedEvent(lifecycleThreadId, `wait-slice:${lifecyclePlan.slices[0]!.id}`, "lifecycle-child-slice-1", weaveSliceRunner.name, firstSliceOutput, lifecycleMaintainer.name),
  childCompletedEvent(lifecycleThreadId, `wait-slice:${lifecyclePlan.slices[1]!.id}`, "lifecycle-child-slice-2", weaveSliceRunner.name, secondSliceOutput, lifecycleMaintainer.name),
]);
assert(lifecycleCleanupPlan);
const lifecycleRemoveRequest = lifecycleCleanupPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested" && candidate.payload.toolName === "workspace.remove",
);
assert(lifecycleRemoveRequest);
const lifecycleCompleted = await lifecyclePlanner.plan(lifecycleThreadId, [
  ...lifecycleHistory,
  ...lifecycleFirstPlan.events,
  lifecycleContextCompleted,
  ...lifecyclePlanned.events,
  lifecycleGateResolved,
  ...lifecycleAfterApproval.events,
  lifecycleAllocateCompleted,
  childCompletedEvent(lifecycleThreadId, `wait-slice:${lifecyclePlan.slices[0]!.id}`, "lifecycle-child-slice-1", weaveSliceRunner.name, firstSliceOutput, lifecycleMaintainer.name),
  childCompletedEvent(lifecycleThreadId, `wait-slice:${lifecyclePlan.slices[1]!.id}`, "lifecycle-child-slice-2", weaveSliceRunner.name, secondSliceOutput, lifecycleMaintainer.name),
  ...lifecycleCleanupPlan.events,
  {
    eventId: eventKey(lifecycleThreadId, "tool.completed", "workspace-remove-initiative"),
    threadId: lifecycleThreadId,
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: lifecycleRemoveRequest.correlationId,
    causationId: lifecycleRemoveRequest.eventId,
    scopeKey: lifecycleRemoveRequest.scopeKey,
    stepKey: lifecycleRemoveRequest.stepKey,
    actor: { type: "worker", id: "test-worker" },
    payload: {
      toolCallId: lifecycleRemoveRequest.payload.toolCallId,
      output: { status: "removed", ref: lifecycleWorkspaceRef, removedPath: lifecycleWorkspaceRef.path },
    },
  } satisfies Extract<ThreadEvent, { type: "tool.completed" }>,
]);
assert(lifecycleCompleted);
const lifecycleOutput = lifecycleCompleted.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(lifecycleOutput);
assert.equal((lifecycleOutput.payload.output as { workspaceRefs: unknown[] }).workspaceRefs.length, 1);
assert.equal((lifecycleOutput.payload.output as { workspaceCleanup: unknown[] }).workspaceCleanup.length, 1);

const sliceModePolicy = DevelopmentWorkspacePolicySchema.parse({
  mode: "slice",
  sourceRepoPath: "/repo/weave",
  workspaceRoot: "/tmp/weave-workspaces",
});
const sliceModeRefOne = { ...lifecycleWorkspaceRef, workspaceId: "slice-workspace-1", metadata: { workspaceMode: "slice", sliceId: sequencePlan.slices[0]!.id } };
const sliceModeRefTwo = { ...lifecycleWorkspaceRef, workspaceId: "slice-workspace-2", metadata: { workspaceMode: "slice", sliceId: sequencePlan.slices[1]!.id } };
const sliceModeInitiative = DevelopmentInitiativeInputSchema.parse({ ...sequenceInitiative, workspacePolicy: sliceModePolicy });
const sliceModePlan = buildDevelopmentSlicePlan(sliceModeInitiative);
const sliceModeFirstInput = SliceRunnerInputSchema.parse({
  initiativeThreadId: "initiative-workspace-slice-mode",
  initiative: sliceModePlan.initiative,
  repo: sliceModePlan.repo,
  branch: sliceModePlan.workingBranch,
  slice: sliceModePlan.slices[0]!,
  workspaceRef: sliceModeRefOne,
  workspacePolicy: sliceModePolicy,
  maxRepairAttempts: 1,
});
const sliceModeSecondInput = SliceRunnerInputSchema.parse({
  initiativeThreadId: "initiative-workspace-slice-mode",
  initiative: sliceModePlan.initiative,
  repo: sliceModePlan.repo,
  branch: sliceModePlan.workingBranch,
  slice: sliceModePlan.slices[1]!,
  workspaceRef: sliceModeRefTwo,
  workspacePolicy: sliceModePolicy,
  maxRepairAttempts: 1,
});
const sliceModeMaintainer = createWeaveMaintainerAgent({ sliceRunnerAgent: weaveSliceRunner, workspaceProvider: fakeWorkspaceProvider });
const sliceModeThreadId = "initiative-workspace-slice-mode";
const sliceModeHistory = [
  ...createInitialHistory(sliceModeThreadId, sliceModeInitiative, sliceModeMaintainer.name),
  childSpawnedEvent(sliceModeThreadId, `slice:${sliceModePlan.slices[0]!.id}`, weaveSliceRunner.name, "slice-mode-child-1", sliceModeFirstInput, `Run development slice ${sliceModePlan.slices[0]!.id}: ${sliceModePlan.slices[0]!.title}`, sliceModeMaintainer.name),
  childSpawnedEvent(sliceModeThreadId, `slice:${sliceModePlan.slices[1]!.id}`, weaveSliceRunner.name, "slice-mode-child-2", sliceModeSecondInput, `Run development slice ${sliceModePlan.slices[1]!.id}: ${sliceModePlan.slices[1]!.title}`, sliceModeMaintainer.name),
];
const sliceModePlanner = createAgentPlanner(sliceModeMaintainer);
const sliceModeFirstPlan = await sliceModePlanner.plan(sliceModeThreadId, sliceModeHistory);
assert(sliceModeFirstPlan);
const sliceModeContextRequest = sliceModeFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> => candidate.type === "tool.requested");
assert(sliceModeContextRequest);
const sliceModeContextCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  ...contextCompleted,
  eventId: eventKey(sliceModeThreadId, "tool.completed", "read-repo-context"),
  threadId: sliceModeThreadId,
  correlationId: sliceModeContextRequest.correlationId,
  causationId: sliceModeContextRequest.eventId,
  scopeKey: sliceModeContextRequest.scopeKey,
  stepKey: sliceModeContextRequest.stepKey,
  payload: { ...contextCompleted.payload, toolCallId: sliceModeContextRequest.payload.toolCallId },
};
const sliceModePlanned = await sliceModePlanner.plan(sliceModeThreadId, [...sliceModeHistory, ...sliceModeFirstPlan.events, sliceModeContextCompleted]);
assert(sliceModePlanned);
const sliceModeGate = sliceModePlanned.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> => candidate.type === "gate.created");
assert(sliceModeGate);
const sliceModeGateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
  ...sequenceGateResolved,
  eventId: eventKey(sliceModeThreadId, "gate.resolved", "approve-slice-plan"),
  threadId: sliceModeThreadId,
  correlationId: sliceModeGate.correlationId,
  causationId: sliceModeGate.eventId,
  scopeKey: sliceModeGate.scopeKey,
  stepKey: sliceModeGate.stepKey,
  payload: { gateId: sliceModeGate.payload.gateId, resolution: "approved", comment: "slice workspaces" },
};
const sliceModeAfterApproval = await sliceModePlanner.plan(sliceModeThreadId, [
  ...sliceModeHistory,
  ...sliceModeFirstPlan.events,
  sliceModeContextCompleted,
  ...sliceModePlanned.events,
  sliceModeGateResolved,
]);
assert(sliceModeAfterApproval);
const sliceModeFirstAllocate = sliceModeAfterApproval.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested" && candidate.payload.toolName === "workspace.allocate",
);
assert(sliceModeFirstAllocate);
const sliceModeSecondAllocatePlan = await sliceModePlanner.plan(sliceModeThreadId, [
  ...sliceModeHistory,
  ...sliceModeFirstPlan.events,
  sliceModeContextCompleted,
  ...sliceModePlanned.events,
  sliceModeGateResolved,
  ...sliceModeAfterApproval.events,
  {
    eventId: eventKey(sliceModeThreadId, "tool.completed", "workspace-allocate-first-slice"),
    threadId: sliceModeThreadId,
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: sliceModeFirstAllocate.correlationId,
    causationId: sliceModeFirstAllocate.eventId,
    scopeKey: sliceModeFirstAllocate.scopeKey,
    stepKey: sliceModeFirstAllocate.stepKey,
    actor: { type: "worker", id: "test-worker" },
    payload: { toolCallId: sliceModeFirstAllocate.payload.toolCallId, output: sliceModeRefOne },
  } satisfies Extract<ThreadEvent, { type: "tool.completed" }>,
  childCompletedEvent(sliceModeThreadId, `wait-slice:${sliceModePlan.slices[0]!.id}`, "slice-mode-child-1", weaveSliceRunner.name, firstSliceOutput, sliceModeMaintainer.name),
]);
assert(sliceModeSecondAllocatePlan);
const sliceModeSecondAllocate = sliceModeSecondAllocatePlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested" && candidate.payload.toolName === "workspace.allocate",
);
assert(sliceModeSecondAllocate);
assert.notEqual(sliceModeSecondAllocate.stepKey, sliceModeFirstAllocate.stepKey);

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
assert.equal(runnerFirstPlan.events.some((candidate) => isDomainEvent(candidate, "dev.slice.started")), false);

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
assert.equal(runnerReadyPlan.events.some((candidate) => isDomainEvent(candidate, "dev.slice.started")), true);

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
assert.equal(implementationFirstPlan.events.some((candidate) => isDomainEvent(candidate, "dev.implementation.started")), true);
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
      status: "completed",
      branch: workspaceRef.workingBranch,
      workspaceRef,
      summary: {
        filesChanged: ["src/example.ts"],
        testsAdded: ["src/example.test.ts"],
        behaviorChanged: ["Example behavior changed."],
        docsChanged: [],
        knownLimitations: [],
        followUpSuggestions: [],
        summary: "Implemented mocked slice.",
      },
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
assert.equal(implementationFinishedPlan.events.some((candidate) => isDomainEvent(candidate, "dev.implementation.completed")), true);
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

const permissionBlockedImplementer = createOpenCodeImplementerAgent({
  runner: {
    run() {
      throw new DevelopmentBlockedRunnerError("OpenCode requires permission approval.");
    },
  },
});
const permissionBlockedThreadId = "opencode-implementer-permission-blocked";
const permissionBlockedHistory = createInitialHistory(permissionBlockedThreadId, implementerInput, permissionBlockedImplementer.name);
const permissionBlockedPlanner = createAgentPlanner(permissionBlockedImplementer);
const permissionBlockedFirstPlan = await permissionBlockedPlanner.plan(permissionBlockedThreadId, permissionBlockedHistory);
assert(permissionBlockedFirstPlan);
const permissionBlockedRequest = permissionBlockedFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(permissionBlockedRequest);
const permissionBlockedToolCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(permissionBlockedThreadId, "tool.completed", "run-opencode-implementation:permission-blocked"),
  threadId: permissionBlockedThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: permissionBlockedRequest.correlationId,
  causationId: permissionBlockedRequest.eventId,
  scopeKey: permissionBlockedRequest.scopeKey,
  stepKey: permissionBlockedRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: permissionBlockedRequest.payload.toolCallId,
    output: {
      status: "blocked",
      branch: workspaceRef.workingBranch,
      workspaceRef,
      reason: "OpenCode requires permission approval.",
    },
  },
};
const permissionBlockedFinished = await permissionBlockedPlanner.plan(permissionBlockedThreadId, [
  ...permissionBlockedHistory,
  ...permissionBlockedFirstPlan.events,
  permissionBlockedToolCompleted,
]);
assert(permissionBlockedFinished);
const permissionBlockedOutput = permissionBlockedFinished.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(permissionBlockedOutput);
assert.equal((permissionBlockedOutput.payload.output as { status: string }).status, "blocked");

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
assert.equal(verificationFinishedPlan.events.some((candidate) => isDomainEvent(candidate, "dev.verification.completed")), true);

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
assert.equal(reviewFinishedPlan.events.some((candidate) => isDomainEvent(candidate, "dev.review.completed")), true);

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
assert.equal(repairFirstPlan.events.some((candidate) => isDomainEvent(candidate, "dev.repair.started")), true);
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
assert.equal(repairFinishedPlan.events.some((candidate) => isDomainEvent(candidate, "dev.repair.completed")), true);
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

const approvedHighRiskRepairAgent = createRepairAgent({ runner: { run: () => repairResult } });
const approvedHighRiskThreadId = "repair-agent-approved-high-risk";
const approvedHighRiskInput = {
  ...repairInput,
  findings: [{ severity: "high" as const, issue: "Touches credentials.", file: "src/credentials.ts" }],
};
const approvedHighRiskHistory = createInitialHistory(approvedHighRiskThreadId, approvedHighRiskInput, approvedHighRiskRepairAgent.name);
const approvedHighRiskFirstPlan = await createAgentPlanner(approvedHighRiskRepairAgent).plan(approvedHighRiskThreadId, approvedHighRiskHistory);
assert(approvedHighRiskFirstPlan);
assert.equal(approvedHighRiskFirstPlan.events.some((candidate) => candidate.type === "tool.requested"), false);
const approvedHighRiskGate = approvedHighRiskFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> =>
  candidate.type === "gate.created",
);
assert(approvedHighRiskGate);
assert.equal(approvedHighRiskGate.payload.reason, "repair-stop");
const approvedHighRiskGateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
  eventId: eventKey(approvedHighRiskThreadId, "gate.resolved", "repair-stop-approved"),
  threadId: approvedHighRiskThreadId,
  type: "gate.resolved",
  occurredAt: nowIso(),
  correlationId: approvedHighRiskGate.correlationId,
  causationId: approvedHighRiskGate.eventId,
  scopeKey: approvedHighRiskGate.scopeKey,
  stepKey: approvedHighRiskGate.stepKey,
  actor: { type: "human", id: "maintainer" },
  payload: {
    gateId: approvedHighRiskGate.payload.gateId,
    resolution: "approved",
    comment: "proceed with repair",
  },
};
const approvedHighRiskPlan = await createAgentPlanner(approvedHighRiskRepairAgent).plan(approvedHighRiskThreadId, [
  ...approvedHighRiskHistory,
  ...approvedHighRiskFirstPlan.events,
  approvedHighRiskGateResolved,
]);
assert(approvedHighRiskPlan);
assert.equal(approvedHighRiskPlan.events.some((candidate) => isDomainEvent(candidate, "dev.repair.started")), true);
const approvedHighRiskRequest = approvedHighRiskPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(approvedHighRiskRequest);
assert.equal(approvedHighRiskRequest.stepKey, "repair:0");

const completedSliceSummary = {
  sliceId: validSlice.id,
  title: validSlice.title,
  summary: "Contracts shipped.",
  implementationSummary: {
    ...implementation,
    docsChanged: ["examples/weave-maintainer/docs/README.md"],
    followUpSuggestions: ["Wire parent slice runner composition."],
  },
  verificationResult,
  reviewResults: [passingReview],
  repairs: [repairResult],
  docsChanged: ["examples/weave-maintainer/docs/slices/07-pr-draft-and-initiative-handoff.md"],
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
assert.equal(PrDraftInputSchema.parse({
  initiative: initiative.initiative,
  repo: initiative.repo,
  baseBranch: initiative.baseBranch,
  branch: initiative.workingBranch,
  shippedSlices: [completedSliceSummary],
}).finalization.mode, "none");
assert.equal(FinalizationConfigSchema.parse({ mode: "local-merge", repoRoot: "/tmp/weave" }).strategy, "merge-commit");
assert.equal(FinalizationResultSchema.parse({
  status: "not-requested",
  mode: "none",
  summary: "Local handoff only.",
}).status, "not-requested");
const builtHandoff = buildPrHandoffArtifact({
  prInput: {
    initiative: initiative.initiative,
    repo: initiative.repo,
    baseBranch: initiative.baseBranch,
    branch: initiative.workingBranch,
    shippedSlices: [completedSliceSummary],
    github: { mode: "create", draft: true },
  },
  draft: builtPrDraft,
});
assert.equal(builtHandoff.remote.status, "pending-approval");
assert.equal(builtHandoff.finalization.status, "not-requested");
assert.equal(builtHandoff.validation.status, "passed");
assert.equal(builtHandoff.shippedSlices[0]?.status, "completed");
assert.throws(
  () =>
    buildPrHandoffArtifact({
      prInput: {
        initiative: initiative.initiative,
        repo: initiative.repo,
        baseBranch: initiative.baseBranch,
        branch: initiative.workingBranch,
        shippedSlices: [completedSliceSummary],
      },
      draft: {
        ...builtPrDraft,
        tests: [{ command: "npm test", exitCode: 1, status: "failed", summary: "Tests failed." }],
      },
    }),
  /failed validation/,
);

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
const localMergeTool = createLocalMergeFinalizationTool({
  run(input) {
    return {
      status: "merged",
      mode: "local-merge",
      repoRoot: input.repoRoot,
      baseBranch: input.baseBranch,
      branch: input.branch,
      strategy: input.strategy,
      beforeSha: "abc123",
      afterSha: "def456",
      summary: "Merged locally.",
    };
  },
});
assert.equal(localMergeTool.name, "dev.git.localMerge");
const localMergeCapabilities =
  typeof localMergeTool.capabilities === "function"
    ? localMergeTool.capabilities({
        input: {
          repo: initiative.repo,
          repoRoot: "/tmp/weave",
          baseBranch: initiative.baseBranch,
          branch: initiative.workingBranch,
          strategy: "merge-commit",
        },
      })
    : undefined;
const localMergeCapabilityName = Array.isArray(localMergeCapabilities)
  ? localMergeCapabilities[0]?.name
  : (localMergeCapabilities as { name?: string } | undefined)?.name;
assert.equal(localMergeCapabilityName, "git.localMerge");

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
assert.equal(prFirstPlan.events.some((candidate) => candidate.type === "checkpoint.completed" && candidate.stepKey === "pr-handoff"), true);
assert.equal(prFirstPlan.events.some((candidate) => isDomainEvent(candidate, "dev.pr.ready_for_review")), true);
assert.equal(prFirstPlan.events.some((candidate) => candidate.type === "tool.requested"), false);
const prGate = prFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> =>
  candidate.type === "gate.created",
);
assert(prGate);
assert.equal(prGate.payload.reason, "pr-review-approval");

const deniedPrGateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
  eventId: eventKey(`${prThreadId}:denied`, "gate.resolved", "pr-review-approval"),
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
    resolution: "denied",
    comment: "not ready",
  },
};
const deniedPrPlan = await prPlanner.plan(prThreadId, [...prHistory, ...prFirstPlan.events, deniedPrGateResolved]);
assert(deniedPrPlan);
assert.equal(deniedPrPlan.events.some((candidate) => candidate.type === "tool.requested"), false);

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
    comment: "create draft PR",
  },
};
const prApprovedPlan = await prPlanner.plan(prThreadId, [...prHistory, ...prFirstPlan.events, prGateResolved]);
assert(prApprovedPlan);
const prRequest = prApprovedPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
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
const prFinishedPlan = await prPlanner.plan(prThreadId, [...prHistory, ...prFirstPlan.events, prGateResolved, ...prApprovedPlan.events, prCompletedTool]);
assert(prFinishedPlan);
assert.equal(prFinishedPlan.events.some((candidate) => isDomainEvent(candidate, "dev.pr.opened")), true);
assert.equal(prFinishedPlan.events.some((candidate) => candidate.type === "checkpoint.completed" && candidate.stepKey === "pr-remote-handoff"), true);
const prOutput = prFinishedPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(prOutput);
assert.equal((prOutput.payload.output as { humanApproval: string }).humanApproval, "approved");
assert.equal((prOutput.payload.output as { prUrl: string }).prUrl, "https://github.com/acme/weave/pull/123");
assert.equal((prOutput.payload.output as { handoffArtifact: { remote: { status: string } } }).handoffArtifact.remote.status, "created");

const localMergePrAgent = createPrAgent();
const localMergePrInput = {
  initiative: initiative.initiative,
  repo: initiative.repo,
  baseBranch: initiative.baseBranch,
  branch: initiative.workingBranch,
  shippedSlices: [completedSliceSummary],
  github: { mode: "none" as const, draft: true },
  finalization: { mode: "local-merge" as const, repoRoot: "/tmp/weave" },
};
const localMergeThreadId = "pr-agent-local-merge-missing-checkpoints";
const localMergeHistory = createInitialHistory(localMergeThreadId, localMergePrInput, localMergePrAgent.name);
const localMergePlanner = createAgentPlanner(localMergePrAgent);
const localMergeFirstPlan = await localMergePlanner.plan(localMergeThreadId, localMergeHistory);
assert(localMergeFirstPlan);
const localMergePrGate = localMergeFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> =>
  candidate.type === "gate.created" && candidate.payload.reason === "pr-review-approval",
);
assert(localMergePrGate);
assert.match(localMergePrGate.payload.proposedAction ?? "", /Approve local merge/);
const localMergeGateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
  eventId: eventKey(localMergeThreadId, "gate.resolved", "pr-review-approval"),
  threadId: localMergeThreadId,
  type: "gate.resolved",
  occurredAt: nowIso(),
  correlationId: localMergePrGate.correlationId,
  causationId: localMergePrGate.eventId,
  scopeKey: localMergePrGate.scopeKey,
  stepKey: localMergePrGate.stepKey,
  actor: { type: "human", id: "maintainer" },
  payload: {
    gateId: localMergePrGate.payload.gateId,
    resolution: "approved",
    comment: "merge locally",
  },
};
const localMergeApprovedPlan = await localMergePlanner.plan(localMergeThreadId, [...localMergeHistory, ...localMergeFirstPlan.events, localMergeGateResolved]);
assert(localMergeApprovedPlan);
assert.equal(localMergeApprovedPlan.events.some((candidate) => candidate.type === "tool.requested"), false);
assert.equal(localMergeApprovedPlan.events.some((candidate) => candidate.type === "checkpoint.completed" && candidate.stepKey === "finalization-result"), true);
assert.equal(localMergeApprovedPlan.events.some((candidate) => candidate.type === "gate.created" && candidate.payload.reason === "finalization-stop"), true);

const initialSliceState = createInitialSliceExecutionState({ ...sliceRunnerInput, workspaceRef, maxRepairAttempts: 1 });
assert.equal(initialSliceState.phase, "workspace-ready");
assert.deepEqual(decideNextSliceAction(initialSliceState), { type: "run-implementation" });
assert.equal(SliceExecutionStateSchema.parse(initialSliceState).sliceId, validSlice.id);

const implementationChildInput = OpenCodeImplementerInputSchema.parse({
  sliceId: validSlice.id,
  sliceTitle: validSlice.title,
  objective: validSlice.objective,
  acceptanceCriteria: validSlice.acceptanceCriteria,
  branch: workspaceRef.workingBranch,
  workspaceRef,
  constraints: [],
});
const implementationChildOutput = {
  status: "completed" as const,
  branch: workspaceRef.workingBranch,
  workspaceRef,
  summary: implementation,
};
const verificationChildInput = VerificationAgentInputSchema.parse({
  sliceId: validSlice.id,
  branch: workspaceRef.workingBranch,
  workspaceRef,
});
const composedSliceRunner = createSliceRunnerAgent({
  implementationAgent: openCodeImplementer,
  verificationAgent: verifier,
  reviewerAgents: { "architecture-reviewer": reviewerAgent },
});
const composedThreadId = "slice-runner-composed-happy";
const composedInput = {
  ...sliceRunnerInput,
  workspaceRef,
  slice: { ...initiative.slices[0]!, requiredReviewers: ["architecture-reviewer" as const] },
  maxRepairAttempts: 1,
};
const reviewChildInput = {
  slice: composedInput.slice,
  branch: workspaceRef.workingBranch,
  workspaceRef,
  reviewer: "architecture-reviewer" as const,
  implementationSummary: implementation,
  verificationResult,
};
const composedHistory = [
  ...createInitialHistory(composedThreadId, composedInput, composedSliceRunner.name),
  childSpawnedEvent(composedThreadId, "implement", openCodeImplementer.name, "child-implement", implementationChildInput, `Implement development slice ${validSlice.id}: ${validSlice.title}`),
  childSpawnedEvent(composedThreadId, "verify:0", verifier.name, "child-verify-0", verificationChildInput, `Verify development slice ${validSlice.id} attempt 0.`),
  childSpawnedEvent(composedThreadId, "review:architecture-reviewer:0", reviewerAgent.name, "child-review-architecture-0", reviewChildInput, `Review development slice ${validSlice.id} as architecture-reviewer.`),
];
const composedPlanner = createAgentPlanner(composedSliceRunner);
const composedFirstPlan = await composedPlanner.plan(composedThreadId, composedHistory);
assert(composedFirstPlan);
const composedBranchRequest = composedFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(composedBranchRequest);
const composedBranchCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(composedThreadId, "tool.completed", "read-branch-state"),
  threadId: composedThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: composedBranchRequest.correlationId,
  causationId: composedBranchRequest.eventId,
  scopeKey: composedBranchRequest.scopeKey,
  stepKey: composedBranchRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: composedBranchRequest.payload.toolCallId,
    output: branchState,
  },
};
const composedAfterBranch = await composedPlanner.plan(composedThreadId, [...composedHistory, ...composedFirstPlan.events, composedBranchCompleted]);
assert(composedAfterBranch);
assert.equal(composedAfterBranch.events.some((candidate) => isDomainEvent(candidate, "dev.slice.started")), true);
const composedAfterImplementation = await composedPlanner.plan(composedThreadId, [
  ...composedHistory,
  ...composedFirstPlan.events,
  composedBranchCompleted,
  ...composedAfterBranch.events,
  childCompletedEvent(composedThreadId, "wait-implement", "child-implement", openCodeImplementer.name, implementationChildOutput),
]);
assert.equal(composedAfterImplementation, null);
const composedAfterVerification = await composedPlanner.plan(composedThreadId, [
  ...composedHistory,
  ...composedFirstPlan.events,
  composedBranchCompleted,
  ...composedAfterBranch.events,
  childCompletedEvent(composedThreadId, "wait-implement", "child-implement", openCodeImplementer.name, implementationChildOutput),
  childCompletedEvent(composedThreadId, "wait-verify:0", "child-verify-0", verifier.name, verificationResult),
]);
assert.equal(composedAfterVerification, null);
const composedAfterReview = await composedPlanner.plan(composedThreadId, [
  ...composedHistory,
  ...composedFirstPlan.events,
  composedBranchCompleted,
  ...composedAfterBranch.events,
  childCompletedEvent(composedThreadId, "wait-implement", "child-implement", openCodeImplementer.name, implementationChildOutput),
  childCompletedEvent(composedThreadId, "wait-verify:0", "child-verify-0", verifier.name, verificationResult),
  childCompletedEvent(composedThreadId, "wait-review:architecture-reviewer:0", "child-review-architecture-0", reviewerAgent.name, passingReview),
]);
assert(composedAfterReview);
const sourceCheckpointRequest = composedAfterReview.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested" && candidate.payload.toolName === "dev.sourceCheckpoint.create",
);
assert(sourceCheckpointRequest);
const composedSourceCheckpoint = SourceCheckpointSchema.parse({
  ...sourceCheckpoint,
  checkpointId: deterministicUuid("source-checkpoint", composedThreadId),
  initiativeThreadId: composedThreadId,
  sliceThreadId: composedThreadId,
  workspaceRef,
  baseSha: workspaceRef.baseCommit,
  checkpointSha: "checkpoint-composed",
  changedFiles: ["examples/weave-maintainer/src/development-orchestrator.ts"],
  commitMessage: "feat: complete Workflow Contracts And Events",
});
const sourceCheckpointCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(composedThreadId, "tool.completed", "create-source-checkpoint:01-contracts"),
  threadId: composedThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: sourceCheckpointRequest.correlationId,
  causationId: sourceCheckpointRequest.eventId,
  scopeKey: sourceCheckpointRequest.scopeKey,
  stepKey: sourceCheckpointRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: sourceCheckpointRequest.payload.toolCallId,
    output: { ...composedSourceCheckpoint, status: "created" },
  },
};
const composedFinished = await composedPlanner.plan(composedThreadId, [
  ...composedHistory,
  ...composedFirstPlan.events,
  composedBranchCompleted,
  ...composedAfterBranch.events,
  childCompletedEvent(composedThreadId, "wait-implement", "child-implement", openCodeImplementer.name, implementationChildOutput),
  childCompletedEvent(composedThreadId, "wait-verify:0", "child-verify-0", verifier.name, verificationResult),
  childCompletedEvent(composedThreadId, "wait-review:architecture-reviewer:0", "child-review-architecture-0", reviewerAgent.name, passingReview),
  ...composedAfterReview.events,
  sourceCheckpointCompleted,
]);
assert(composedFinished);
assert.equal(composedFinished.events.some((candidate) => isDomainEvent(candidate, "dev.source_checkpoint.created")), true);
assert.equal(composedFinished.events.some((candidate) => isDomainEvent(candidate, "dev.slice.completed")), true);
assert.equal(composedFinished.events.filter((candidate) => isDomainEvent(candidate, "dev.slice.completed")).length, 1);
const composedOutput = composedFinished.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(composedOutput);
assert.equal((composedOutput.payload.output as { status: string }).status, "completed");
assert.equal((composedOutput.payload.output as { sourceCheckpoint: { checkpointSha: string } }).sourceCheckpoint.checkpointSha, "checkpoint-composed");

const failedVerificationResult = {
  status: "failed" as const,
  failureSummary: "typecheck failed",
  commands: [
    {
      command: "npm run typecheck",
      exitCode: 1,
      status: "failed" as const,
      durationMs: 100,
      summary: "Typecheck failed.",
      output: "error TS1234",
    },
  ],
};
const repairFinding = { severity: "high" as const, issue: "typecheck failed" };
const repairableState = SliceExecutionStateSchema.parse({
  ...initialSliceState,
  requiredReviewers: ["architecture-reviewer"],
  implementation: implementationChildOutput,
  verification: failedVerificationResult,
  reviews: [passingReview],
  maxRepairAttempts: 1,
});
assert.deepEqual(decideNextSliceAction(repairableState), { type: "run-repair", attempt: 0, findings: [repairFinding] });
assert.equal(
  decideNextSliceAction({
    ...initialSliceState,
    implementation: {
      status: "blocked",
      branch: workspaceRef.workingBranch,
      workspaceRef,
      reason: "OpenCode requires permission approval.",
    },
  }).type,
  "require-human-stop",
);
assert.equal(decideNextSliceAction({ ...repairableState, maxRepairAttempts: 0 }).type, "require-human-stop");
assert.equal(
  decideNextSliceAction({
    ...repairableState,
    verification: verificationResult,
    reviews: [{ reviewer: "architecture-reviewer", verdict: "needs-fixes", findings: [{ severity: "high", issue: "Auth policy risk." }] }],
  }).type,
  "require-human-stop",
);

const repairVerificationInput = VerificationAgentInputSchema.parse({
  sliceId: validSlice.id,
  branch: workspaceRef.workingBranch,
  workspaceRef,
});
const repairReviewAttemptZeroInput = {
  ...reviewChildInput,
  verificationResult: failedVerificationResult,
};
const repairChildInput = RepairAgentInputSchema.parse({
  branch: workspaceRef.workingBranch,
  workspaceRef,
  slice: composedInput.slice,
  attempt: 0,
  maxAttempts: 1,
  failingCommands: failedVerificationResult.commands,
  findings: [repairFinding],
});
const repairReviewAttemptOneInput = {
  ...reviewChildInput,
  verificationResult,
};
const repairComposedRunner = createSliceRunnerAgent({
  implementationAgent: openCodeImplementer,
  verificationAgent: verifier,
  reviewerAgents: { "architecture-reviewer": reviewerAgent },
  repairAgent,
});
const repairComposedThreadId = "slice-runner-composed-repair";
const repairComposedHistory = [
  ...createInitialHistory(repairComposedThreadId, composedInput, repairComposedRunner.name),
  childSpawnedEvent(repairComposedThreadId, "implement", openCodeImplementer.name, "repair-child-implement", implementationChildInput, `Implement development slice ${validSlice.id}: ${validSlice.title}`),
  childSpawnedEvent(repairComposedThreadId, "verify:0", verifier.name, "repair-child-verify-0", repairVerificationInput, `Verify development slice ${validSlice.id} attempt 0.`),
  childSpawnedEvent(repairComposedThreadId, "review:architecture-reviewer:0", reviewerAgent.name, "repair-child-review-0", repairReviewAttemptZeroInput, `Review development slice ${validSlice.id} as architecture-reviewer.`),
  childSpawnedEvent(repairComposedThreadId, "repair:0", repairAgent.name, "repair-child-repair-0", repairChildInput, `Repair development slice ${validSlice.id} attempt 0.`),
  childSpawnedEvent(repairComposedThreadId, "verify:1", verifier.name, "repair-child-verify-1", repairVerificationInput, `Verify development slice ${validSlice.id} attempt 1.`),
  childSpawnedEvent(repairComposedThreadId, "review:architecture-reviewer:1", reviewerAgent.name, "repair-child-review-1", repairReviewAttemptOneInput, `Review development slice ${validSlice.id} as architecture-reviewer.`),
];
const repairComposedPlanner = createAgentPlanner(repairComposedRunner);
const repairComposedFirstPlan = await repairComposedPlanner.plan(repairComposedThreadId, repairComposedHistory);
assert(repairComposedFirstPlan);
const repairComposedBranchRequest = repairComposedFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(repairComposedBranchRequest);
const repairComposedAfterReview = await repairComposedPlanner.plan(repairComposedThreadId, [
  ...repairComposedHistory,
  ...repairComposedFirstPlan.events,
  {
    eventId: eventKey(repairComposedThreadId, "tool.completed", "read-branch-state"),
    threadId: repairComposedThreadId,
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: repairComposedBranchRequest.correlationId,
    causationId: repairComposedBranchRequest.eventId,
    scopeKey: repairComposedBranchRequest.scopeKey,
    stepKey: repairComposedBranchRequest.stepKey,
    actor: { type: "worker", id: "test-worker" },
    payload: {
      toolCallId: repairComposedBranchRequest.payload.toolCallId,
      output: branchState,
    },
  } satisfies Extract<ThreadEvent, { type: "tool.completed" }>,
  childCompletedEvent(repairComposedThreadId, "wait-implement", "repair-child-implement", openCodeImplementer.name, implementationChildOutput),
  childCompletedEvent(repairComposedThreadId, "wait-verify:0", "repair-child-verify-0", verifier.name, failedVerificationResult),
  childCompletedEvent(repairComposedThreadId, "wait-review:architecture-reviewer:0", "repair-child-review-0", reviewerAgent.name, passingReview),
  childCompletedEvent(repairComposedThreadId, "wait-repair:0", "repair-child-repair-0", repairAgent.name, repairResult),
  childCompletedEvent(repairComposedThreadId, "wait-verify:1", "repair-child-verify-1", verifier.name, verificationResult),
  childCompletedEvent(repairComposedThreadId, "wait-review:architecture-reviewer:1", "repair-child-review-1", reviewerAgent.name, passingReview),
]);
assert(repairComposedAfterReview);
const repairSourceCheckpointRequest = repairComposedAfterReview.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested" && candidate.payload.toolName === "dev.sourceCheckpoint.create",
);
assert(repairSourceCheckpointRequest);
const repairSourceCheckpointCompleted: Extract<ThreadEvent, { type: "tool.completed" }> = {
  eventId: eventKey(repairComposedThreadId, "tool.completed", "create-source-checkpoint:01-contracts"),
  threadId: repairComposedThreadId,
  type: "tool.completed",
  occurredAt: nowIso(),
  correlationId: repairSourceCheckpointRequest.correlationId,
  causationId: repairSourceCheckpointRequest.eventId,
  scopeKey: repairSourceCheckpointRequest.scopeKey,
  stepKey: repairSourceCheckpointRequest.stepKey,
  actor: { type: "worker", id: "test-worker" },
  payload: {
    toolCallId: repairSourceCheckpointRequest.payload.toolCallId,
    output: {
      ...composedSourceCheckpoint,
      checkpointId: deterministicUuid("source-checkpoint", repairComposedThreadId),
      initiativeThreadId: repairComposedThreadId,
      sliceThreadId: repairComposedThreadId,
      checkpointSha: "checkpoint-repair-composed",
      status: "created",
    },
  },
};
const repairComposedFinished = await repairComposedPlanner.plan(repairComposedThreadId, [
  ...repairComposedHistory,
  ...repairComposedFirstPlan.events,
  {
    eventId: eventKey(repairComposedThreadId, "tool.completed", "read-branch-state"),
    threadId: repairComposedThreadId,
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: repairComposedBranchRequest.correlationId,
    causationId: repairComposedBranchRequest.eventId,
    scopeKey: repairComposedBranchRequest.scopeKey,
    stepKey: repairComposedBranchRequest.stepKey,
    actor: { type: "worker", id: "test-worker" },
    payload: {
      toolCallId: repairComposedBranchRequest.payload.toolCallId,
      output: branchState,
    },
  } satisfies Extract<ThreadEvent, { type: "tool.completed" }>,
  childCompletedEvent(repairComposedThreadId, "wait-implement", "repair-child-implement", openCodeImplementer.name, implementationChildOutput),
  childCompletedEvent(repairComposedThreadId, "wait-verify:0", "repair-child-verify-0", verifier.name, failedVerificationResult),
  childCompletedEvent(repairComposedThreadId, "wait-review:architecture-reviewer:0", "repair-child-review-0", reviewerAgent.name, passingReview),
  childCompletedEvent(repairComposedThreadId, "wait-repair:0", "repair-child-repair-0", repairAgent.name, repairResult),
  childCompletedEvent(repairComposedThreadId, "wait-verify:1", "repair-child-verify-1", verifier.name, verificationResult),
  childCompletedEvent(repairComposedThreadId, "wait-review:architecture-reviewer:1", "repair-child-review-1", reviewerAgent.name, passingReview),
  ...repairComposedAfterReview.events,
  repairSourceCheckpointCompleted,
]);
assert(repairComposedFinished);
assert.equal(repairComposedFinished.events.some((candidate) => isDomainEvent(candidate, "dev.slice.completed")), true);
const repairComposedOutput = repairComposedFinished.events.find((candidate): candidate is Extract<ThreadEvent, { type: "agent.output.completed" }> =>
  candidate.type === "agent.output.completed",
);
assert(repairComposedOutput);
assert.equal((repairComposedOutput.payload.output as { status: string }).status, "completed");
assert.equal((repairComposedOutput.payload.output as { repairs: unknown[] }).repairs.length, 1);

const exhaustedComposedInput = { ...composedInput, maxRepairAttempts: 0 };
const exhaustedComposedRunner = createSliceRunnerAgent({
  implementationAgent: openCodeImplementer,
  verificationAgent: verifier,
  reviewerAgents: { "architecture-reviewer": reviewerAgent },
});
const exhaustedComposedThreadId = "slice-runner-composed-exhausted";
const exhaustedComposedHistory = [
  ...createInitialHistory(exhaustedComposedThreadId, exhaustedComposedInput, exhaustedComposedRunner.name),
  childSpawnedEvent(exhaustedComposedThreadId, "implement", openCodeImplementer.name, "exhausted-child-implement", implementationChildInput, `Implement development slice ${validSlice.id}: ${validSlice.title}`),
  childSpawnedEvent(exhaustedComposedThreadId, "verify:0", verifier.name, "exhausted-child-verify-0", repairVerificationInput, `Verify development slice ${validSlice.id} attempt 0.`),
  childSpawnedEvent(exhaustedComposedThreadId, "review:architecture-reviewer:0", reviewerAgent.name, "exhausted-child-review-0", repairReviewAttemptZeroInput, `Review development slice ${validSlice.id} as architecture-reviewer.`),
];
const exhaustedComposedPlanner = createAgentPlanner(exhaustedComposedRunner);
const exhaustedSliceFirstPlan = await exhaustedComposedPlanner.plan(exhaustedComposedThreadId, exhaustedComposedHistory);
assert(exhaustedSliceFirstPlan);
const exhaustedBranchRequest = exhaustedSliceFirstPlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "tool.requested" }> =>
  candidate.type === "tool.requested",
);
assert(exhaustedBranchRequest);
const exhaustedGatePlan = await exhaustedComposedPlanner.plan(exhaustedComposedThreadId, [
  ...exhaustedComposedHistory,
  ...exhaustedSliceFirstPlan.events,
  {
    eventId: eventKey(exhaustedComposedThreadId, "tool.completed", "read-branch-state"),
    threadId: exhaustedComposedThreadId,
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: exhaustedBranchRequest.correlationId,
    causationId: exhaustedBranchRequest.eventId,
    scopeKey: exhaustedBranchRequest.scopeKey,
    stepKey: exhaustedBranchRequest.stepKey,
    actor: { type: "worker", id: "test-worker" },
    payload: {
      toolCallId: exhaustedBranchRequest.payload.toolCallId,
      output: branchState,
    },
  } satisfies Extract<ThreadEvent, { type: "tool.completed" }>,
  childCompletedEvent(exhaustedComposedThreadId, "wait-implement", "exhausted-child-implement", openCodeImplementer.name, implementationChildOutput),
  childCompletedEvent(exhaustedComposedThreadId, "wait-verify:0", "exhausted-child-verify-0", verifier.name, failedVerificationResult),
  childCompletedEvent(exhaustedComposedThreadId, "wait-review:architecture-reviewer:0", "exhausted-child-review-0", reviewerAgent.name, passingReview),
]);
assert(exhaustedGatePlan);
const exhaustedGate = exhaustedGatePlan.events.find((candidate): candidate is Extract<ThreadEvent, { type: "gate.created" }> =>
  candidate.type === "gate.created",
);
assert(exhaustedGate);
assert.equal(exhaustedGate.payload.reason, "repair-stop");
assert.equal(exhaustedGate.payload.proposedAction?.includes("Repair attempts exhausted"), true);

console.log("Development orchestrator contract tests passed");

function childSpawnedEvent(
  threadId: string,
  stepKey: string,
  childAgentName: string,
  childThreadId: string,
  input: Record<string, unknown>,
  inputSummary: string,
  parentAgentName: string = "weave.sliceRunner",
): Extract<ThreadEvent, { type: "child_thread.spawned" }> {
  const scopeKey = `agent:${parentAgentName}`;
  return {
    eventId: eventKey(threadId, "child_thread.spawned", `${scopeKey}:${stepKey}`),
    threadId,
    type: "child_thread.spawned",
    occurredAt: nowIso(),
    scopeKey,
    stepKey,
    actor: { type: "agent", id: parentAgentName },
    payload: {
      childThreadId,
      childAgentName,
      scopeKey,
      stepKey,
      mode: "attached",
      inputHash: stableJsonHash(input),
      inputSummary,
    },
  };
}

function childCompletedEvent(
  threadId: string,
  stepKey: string,
  childThreadId: string,
  childAgentName: string,
  output: unknown,
  parentAgentName: string = "weave.sliceRunner",
): Extract<ThreadEvent, { type: "child_thread.completed" }> {
  const scopeKey = `agent:${parentAgentName}`;
  return {
    eventId: eventKey(threadId, "child_thread.completed", `${scopeKey}:${stepKey}`),
    threadId,
    type: "child_thread.completed",
    occurredAt: nowIso(),
    scopeKey,
    stepKey,
    actor: { type: "worker", id: "test-worker" },
    payload: {
      childThreadId,
      childAgentName,
      output,
    },
  };
}

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
