import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { agent, capability, tool, type AgentContext, type AgentContract, type CapabilityDeclaration, type ToolProgressUpdate } from "weave/runtime";
import { deterministicUuid } from "weave/runtime";
import {
  DevCommandResultSchema,
  DevReviewFindingSchema,
  DevReviewVerdictSchema,
  DevSourceCheckpointCreatedPayloadSchema,
  DevSourceCheckpointFailedPayloadSchema,
  DevSourceCheckpointProposedPayloadSchema,
  DevSourceCheckpointReviewSummarySchema,
  DevSourceCheckpointRestoredPayloadSchema,
  DevSourceCheckpointVerificationSummarySchema,
  developmentEvents,
  type DevReviewFinding,
} from "./events.js";
export { developmentEvents };
import {
  WorkspaceRefSchema,
  WorkspaceAllocateInputSchema,
  createWorkspaceAllocateTool,
  createWorkspaceRemoveTool,
  workspaceDiffCapability,
  type WorkspaceProvider,
  type WorkspaceRef,
  type WorkspaceRemovalResult,
} from "weave/runtime";

const NonEmptyStringSchema = z.string().min(1);
const execFileAsync = promisify(execFile);

export const DevelopmentCheckpointKeys = {
  initiativeSpec: "initiative-spec",
  proposedInitiativePlan: "proposed-initiative-plan",
  approvedInitiativePlan: "approved-initiative-plan",
  latestPlanDecision: "latest-plan-decision",
  initiativeContext: "initiative-context",
  repoContext: "repo-context",
  slicePlan: "slice-plan",
  approvedSlicePlan: "approved-slice-plan",
  workingBranch: "working-branch",
  workspaceRef: "workspace-ref",
  baseCommit: "base-commit",
  sliceAcceptanceCriteria: "slice-acceptance-criteria",
  implementationSummary: "implementation-summary",
  testResults: "test-results",
  reviewFindings: "review-findings",
  repairAttemptCount: "repair-attempt-count",
  prDraft: "pr-draft",
  prHandoff: "pr-handoff",
  prRemoteHandoff: "pr-remote-handoff",
  prUrl: "pr-url",
  sourceCheckpoint: "source-checkpoint",
  finalizationResult: "finalization-result",
} as const;
export type DevelopmentCheckpointKey = (typeof DevelopmentCheckpointKeys)[keyof typeof DevelopmentCheckpointKeys];

export const DevelopmentCapabilityNameSchema = z.enum([
  "repo.read",
  "repo.write.branch",
  "repo.createBranch",
  "repo.runTests",
  "github.pr.create",
  "github.pr.comment",
  "github.pr.read",
  "github.pr.merge",
  "opencode.run",
]);
export type DevelopmentCapabilityName = z.infer<typeof DevelopmentCapabilityNameSchema>;

export const DevelopmentReviewerRoleSchema = z.enum([
  "architecture-reviewer",
  "replay-safety-reviewer",
  "compatibility-reviewer",
  "docs-reviewer",
  "security-reviewer",
]);
export type DevelopmentReviewerRole = z.infer<typeof DevelopmentReviewerRoleSchema>;

export const DevelopmentSliceStatusSchema = z.enum([
  "proposed",
  "approved",
  "started",
  "completed",
  "failed",
  "blocked",
]);
export type DevelopmentSliceStatus = z.infer<typeof DevelopmentSliceStatusSchema>;

export const InitiativeSpecSourceSchema = z.enum(["prd", "statement-of-work", "prompt", "markdown", "manual"]);
export type InitiativeSpecSource = z.infer<typeof InitiativeSpecSourceSchema>;

export const InitiativeSpecSchema = z.object({
  title: NonEmptyStringSchema,
  statementOfWork: NonEmptyStringSchema,
  source: InitiativeSpecSourceSchema.default("statement-of-work"),
  summary: NonEmptyStringSchema.optional(),
  goals: z.array(NonEmptyStringSchema).default([]),
  nonGoals: z.array(NonEmptyStringSchema).default([]),
  constraints: z.array(NonEmptyStringSchema).default([]),
  acceptanceCriteria: z.array(NonEmptyStringSchema).default([]),
  risks: z.array(NonEmptyStringSchema).default([]),
  implementationHints: z.array(NonEmptyStringSchema).default([]),
  affectedAreas: z.array(NonEmptyStringSchema).default([]),
  contextFiles: z.array(NonEmptyStringSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type InitiativeSpec = z.infer<typeof InitiativeSpecSchema>;

export const InitiativePlanDecisionSchema = z.object({
  status: z.enum(["approved", "rejected", "revision-requested"]),
  decidedBy: NonEmptyStringSchema,
  decidedAt: z.string().datetime().optional(),
  note: NonEmptyStringSchema.optional(),
});
export type InitiativePlanDecision = z.infer<typeof InitiativePlanDecisionSchema>;

export const InitiativePlanRevisionSchema = z.object({
  revision: z.number().int().positive(),
  reason: NonEmptyStringSchema,
  changedBy: NonEmptyStringSchema,
  changedAt: z.string().datetime().optional(),
});
export type InitiativePlanRevision = z.infer<typeof InitiativePlanRevisionSchema>;

export const DevelopmentSliceInputSchema = z.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  objective: NonEmptyStringSchema,
  acceptanceCriteria: z.array(NonEmptyStringSchema).min(1),
  allowedFiles: z.array(NonEmptyStringSchema).optional(),
  expectedTouchpoints: z.array(NonEmptyStringSchema).default([]),
  verificationStrategy: z.array(NonEmptyStringSchema).default([]),
  constraints: z.array(NonEmptyStringSchema).default([]),
  requiredReviewers: z.array(DevelopmentReviewerRoleSchema).default([]),
  riskNotes: z.array(NonEmptyStringSchema).default([]),
  status: DevelopmentSliceStatusSchema.default("proposed"),
});
export type DevelopmentSliceInput = z.infer<typeof DevelopmentSliceInputSchema>;

export const DevelopmentWorkspaceModeSchema = z.enum(["initiative", "slice"]);
export type DevelopmentWorkspaceMode = z.infer<typeof DevelopmentWorkspaceModeSchema>;

const DefaultDevelopmentWorkspacePolicy = {
  mode: "initiative" as const,
  provider: "git-worktree",
  preserveOnFailure: true,
  preserveOnHumanGate: true,
  cleanupOnSuccess: false,
  requireCleanOnCleanup: true,
  forceCleanup: false,
};

export const DevelopmentWorkspacePolicySchema = z.object({
  mode: DevelopmentWorkspaceModeSchema.default("initiative"),
  provider: NonEmptyStringSchema.default("git-worktree"),
  sourceRepoPath: NonEmptyStringSchema.optional(),
  workspaceRoot: NonEmptyStringSchema.optional(),
  preserveOnFailure: z.boolean().default(true),
  preserveOnHumanGate: z.boolean().default(true),
  cleanupOnSuccess: z.boolean().default(false),
  requireCleanOnCleanup: z.boolean().default(true),
  forceCleanup: z.boolean().default(false),
});
export type DevelopmentWorkspacePolicy = z.infer<typeof DevelopmentWorkspacePolicySchema>;

export const InitiativePlanCompilerInputSchema = z.object({
  spec: InitiativeSpecSchema,
  repo: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  workingBranch: NonEmptyStringSchema,
  contextFiles: z.array(NonEmptyStringSchema).default([]),
  repoContext: z.unknown().optional(),
});
export type InitiativePlanCompilerInput = z.input<typeof InitiativePlanCompilerInputSchema>;

export type InitiativePlanCompiler = {
  compile(input: InitiativePlanCompilerInput): Promise<unknown> | unknown;
};

export const DevelopmentInitiativeInputSchema = z.object({
  initiative: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  workingBranch: NonEmptyStringSchema,
  contextFiles: z.array(NonEmptyStringSchema).min(1),
  initiativeSpec: InitiativeSpecSchema.optional(),
  slices: z.array(DevelopmentSliceInputSchema).optional(),
  workspaceRef: WorkspaceRefSchema.optional(),
  workspacePolicy: DevelopmentWorkspacePolicySchema.default(DefaultDevelopmentWorkspacePolicy),
});
export type DevelopmentInitiativeInput = z.infer<typeof DevelopmentInitiativeInputSchema>;

export const DevelopmentRepoContextReadInputSchema = z.object({
  repo: NonEmptyStringSchema,
  contextFiles: z.array(NonEmptyStringSchema).min(1),
  repoRoot: NonEmptyStringSchema.optional(),
  maxFileBytes: z.number().int().positive().default(64_000),
  maxTotalBytes: z.number().int().positive().default(256_000),
});
export type DevelopmentRepoContextReadInput = z.infer<typeof DevelopmentRepoContextReadInputSchema>;

export const DevelopmentRepoContextEntrySchema = z.object({
  path: NonEmptyStringSchema,
  kind: z.enum(["file", "directory", "missing", "denied", "too-large"]),
  bytes: z.number().int().nonnegative().default(0),
  content: z.string().optional(),
  reason: NonEmptyStringSchema.optional(),
});
export type DevelopmentRepoContextEntry = z.infer<typeof DevelopmentRepoContextEntrySchema>;

export const DevelopmentRepoContextSchema = z.object({
  repo: NonEmptyStringSchema,
  filesRead: z.array(NonEmptyStringSchema),
  entries: z.array(DevelopmentRepoContextEntrySchema),
  totalBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type DevelopmentRepoContext = z.infer<typeof DevelopmentRepoContextSchema>;

export const DevelopmentSlicePlanSchema = z.object({
  initiative: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  workingBranch: NonEmptyStringSchema,
  specTitle: NonEmptyStringSchema.optional(),
  goals: z.array(NonEmptyStringSchema).default([]),
  nonGoals: z.array(NonEmptyStringSchema).default([]),
  constraints: z.array(NonEmptyStringSchema).default([]),
  acceptanceCriteria: z.array(NonEmptyStringSchema).default([]),
  risks: z.array(NonEmptyStringSchema).default([]),
  affectedAreas: z.array(NonEmptyStringSchema).default([]),
  slices: z.array(DevelopmentSliceInputSchema).min(1),
  approvalRequired: z.literal(true),
  summary: NonEmptyStringSchema,
  status: z.enum(["proposed", "approved", "rejected", "revision-requested"]).default("proposed"),
  revision: z.number().int().positive().default(1),
  revisionHistory: z.array(InitiativePlanRevisionSchema).default([]),
  decision: InitiativePlanDecisionSchema.optional(),
});
export type DevelopmentSlicePlan = z.infer<typeof DevelopmentSlicePlanSchema>;
export const InitiativePlanSchema = DevelopmentSlicePlanSchema;
export type InitiativePlan = DevelopmentSlicePlan;

export const InitiativePlannerOutputSchema = z.object({
  status: z.enum(["approved", "denied", "completed", "blocked"]),
  plan: DevelopmentSlicePlanSchema,
  contextFilesRead: z.array(NonEmptyStringSchema),
  repoContext: DevelopmentRepoContextSchema,
  proposedEventCount: z.number().int().nonnegative(),
  gateComment: NonEmptyStringSchema.optional(),
  completedSlices: z.array(z.unknown()).default([]),
  blockedSlice: NonEmptyStringSchema.optional(),
  blockerReason: NonEmptyStringSchema.optional(),
  prDraft: z.unknown().optional(),
  workspacePolicy: DevelopmentWorkspacePolicySchema.optional(),
  workspaceRefs: z.array(WorkspaceRefSchema).default([]),
  workspaceCleanup: z.array(z.unknown()).default([]),
});
export type InitiativePlannerOutput = z.infer<typeof InitiativePlannerOutputSchema>;

export const SliceRunnerInputSchema = z.object({
  initiativeThreadId: NonEmptyStringSchema.optional(),
  initiative: NonEmptyStringSchema,
  repo: NonEmptyStringSchema.default("weave"),
  branch: NonEmptyStringSchema,
  baseCommit: NonEmptyStringSchema.optional(),
  workspaceRef: WorkspaceRefSchema.optional(),
  workspacePolicy: DevelopmentWorkspacePolicySchema.optional(),
  slice: DevelopmentSliceInputSchema,
  maxRepairAttempts: z.number().int().nonnegative().default(0),
});
export type SliceRunnerInput = z.infer<typeof SliceRunnerInputSchema>;

export const DevelopmentBranchStateReadInputSchema = z.object({
  repo: NonEmptyStringSchema,
  repoRoot: NonEmptyStringSchema.optional(),
});
export type DevelopmentBranchStateReadInput = z.infer<typeof DevelopmentBranchStateReadInputSchema>;

export const DevelopmentBranchStateSchema = z.object({
  repo: NonEmptyStringSchema,
  repoRoot: NonEmptyStringSchema,
  currentBranch: NonEmptyStringSchema,
  headCommit: NonEmptyStringSchema,
  isDetachedHead: z.boolean(),
});
export type DevelopmentBranchState = z.infer<typeof DevelopmentBranchStateSchema>;

export const SourceCheckpointVerificationSummarySchema = DevSourceCheckpointVerificationSummarySchema;
export type SourceCheckpointVerificationSummary = z.infer<typeof SourceCheckpointVerificationSummarySchema>;

export const SourceCheckpointReviewSummarySchema = DevSourceCheckpointReviewSummarySchema;
export type SourceCheckpointReviewSummary = z.infer<typeof SourceCheckpointReviewSummarySchema>;

export const SourceCheckpointSchema = DevSourceCheckpointCreatedPayloadSchema.extend({
  workspaceRef: WorkspaceRefSchema,
});
export type SourceCheckpoint = z.infer<typeof SourceCheckpointSchema>;

export const SourceCheckpointProposedSchema = DevSourceCheckpointProposedPayloadSchema.extend({
  workspaceRef: WorkspaceRefSchema,
});
export type SourceCheckpointProposed = z.infer<typeof SourceCheckpointProposedSchema>;

export const SourceCheckpointFailedSchema = DevSourceCheckpointFailedPayloadSchema.extend({
  workspaceRef: WorkspaceRefSchema.optional(),
});
export type SourceCheckpointFailed = z.infer<typeof SourceCheckpointFailedSchema>;

export const SourceCheckpointRestoredSchema = DevSourceCheckpointRestoredPayloadSchema.extend({
  workspaceRef: WorkspaceRefSchema,
});
export type SourceCheckpointRestored = z.infer<typeof SourceCheckpointRestoredSchema>;

export const SourceCheckpointCreateInputSchema = z.object({
  initiativeThreadId: NonEmptyStringSchema,
  sliceThreadId: NonEmptyStringSchema,
  sliceId: NonEmptyStringSchema,
  title: NonEmptyStringSchema.optional(),
  workspaceRef: WorkspaceRefSchema,
  commitMessage: NonEmptyStringSchema,
  verificationSummary: SourceCheckpointVerificationSummarySchema,
  reviewSummary: z.array(SourceCheckpointReviewSummarySchema).default([]),
});
export type SourceCheckpointCreateInput = z.infer<typeof SourceCheckpointCreateInputSchema>;

export const SourceCheckpointCreateResultSchema = z.discriminatedUnion("status", [
  SourceCheckpointSchema.extend({ status: z.literal("created") }),
  SourceCheckpointFailedSchema.extend({ status: z.literal("failed") }),
]);
export type SourceCheckpointCreateResult = z.infer<typeof SourceCheckpointCreateResultSchema>;

export type SourceCheckpointRunner = {
  run(input: SourceCheckpointCreateInput): Promise<SourceCheckpointCreateResult> | SourceCheckpointCreateResult;
};

export const SliceRunnerOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"),
    sliceId: NonEmptyStringSchema,
    branch: NonEmptyStringSchema,
    branchState: DevelopmentBranchStateSchema,
    workspaceRef: WorkspaceRefSchema.optional(),
  }),
  z.object({
    status: z.literal("blocked"),
    sliceId: NonEmptyStringSchema,
    branch: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    branchState: DevelopmentBranchStateSchema.optional(),
  }),
  z.object({
    status: z.literal("completed"),
    sliceId: NonEmptyStringSchema,
    branch: NonEmptyStringSchema,
    workspaceRef: WorkspaceRefSchema,
    implementationSummary: z.unknown(),
    verificationResult: z.unknown(),
    reviewResults: z.array(z.unknown()),
    sourceCheckpoint: SourceCheckpointSchema.optional(),
    repairs: z.array(z.unknown()).default([]),
    summary: NonEmptyStringSchema,
  }),
  z.object({
    status: z.literal("failed"),
    sliceId: NonEmptyStringSchema,
    branch: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    findings: z.array(DevReviewFindingSchema).default([]),
    workspaceRef: WorkspaceRefSchema.optional(),
  }),
]);
export type SliceRunnerOutput = z.infer<typeof SliceRunnerOutputSchema>;

export const OpenCodeImplementerInputSchema = z.object({
  sliceId: NonEmptyStringSchema.optional(),
  sliceTitle: NonEmptyStringSchema,
  objective: NonEmptyStringSchema,
  acceptanceCriteria: z.array(NonEmptyStringSchema).min(1),
  allowedFiles: z.array(NonEmptyStringSchema).optional(),
  branch: NonEmptyStringSchema,
  workspaceRef: WorkspaceRefSchema,
  constraints: z.array(NonEmptyStringSchema).default([]),
});
export type OpenCodeImplementerInput = z.infer<typeof OpenCodeImplementerInputSchema>;

export const ImplementationSummarySchema = z.object({
  filesChanged: z.array(NonEmptyStringSchema),
  testsAdded: z.array(NonEmptyStringSchema).default([]),
  behaviorChanged: z.array(NonEmptyStringSchema).default([]),
  docsChanged: z.array(NonEmptyStringSchema).default([]),
  knownLimitations: z.array(NonEmptyStringSchema).default([]),
  followUpSuggestions: z.array(NonEmptyStringSchema).default([]),
  summary: NonEmptyStringSchema,
});
export type ImplementationSummary = z.infer<typeof ImplementationSummarySchema>;

export const OpenCodeImplementerOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    branch: NonEmptyStringSchema,
    workspaceRef: WorkspaceRefSchema,
    summary: ImplementationSummarySchema,
  }),
  z.object({
    status: z.literal("blocked"),
    branch: NonEmptyStringSchema,
    workspaceRef: WorkspaceRefSchema.optional(),
    reason: NonEmptyStringSchema,
  }),
]);
export type OpenCodeImplementerOutput = z.infer<typeof OpenCodeImplementerOutputSchema>;

export type DevelopmentRunnerContext = {
  progress?: (update: ToolProgressUpdate) => Promise<void> | void;
};

export class DevelopmentBlockedRunnerError extends Error {
  constructor(
    readonly reason: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(reason);
    this.name = "DevelopmentBlockedRunnerError";
  }
}

export type OpenCodeImplementationRunner = {
  capabilities?: readonly CapabilityDeclaration[];
  run(input: OpenCodeImplementerInput, context?: DevelopmentRunnerContext): Promise<ImplementationSummary> | ImplementationSummary;
};

export const VerificationResultSchema = z.object({
  status: z.enum(["passed", "failed", "blocked"]),
  commands: z.array(DevCommandResultSchema).min(1),
  failureSummary: NonEmptyStringSchema.optional(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const VerificationCommandSpecSchema = z.object({
  command: NonEmptyStringSchema,
  args: z.array(NonEmptyStringSchema).default([]),
  required: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(120_000),
});
export type VerificationCommandSpec = z.input<typeof VerificationCommandSpecSchema>;

export const VerificationAgentInputSchema = z.object({
  sliceId: NonEmptyStringSchema,
  branch: NonEmptyStringSchema,
  workspaceRef: WorkspaceRefSchema,
  commands: z.array(VerificationCommandSpecSchema).default([
    { command: "npm", args: ["test"], required: true, timeoutMs: 120_000 },
    { command: "npm", args: ["run", "typecheck"], required: true, timeoutMs: 120_000 },
    { command: "git", args: ["diff", "--check"], required: true, timeoutMs: 120_000 },
  ]),
  maxOutputBytes: z.number().int().positive().default(32_000),
});
export type VerificationAgentInput = z.input<typeof VerificationAgentInputSchema>;

export type VerificationRunner = {
  run(input: z.infer<typeof VerificationAgentInputSchema>): Promise<VerificationResult> | VerificationResult;
};

export const ReviewResultSchema = z.object({
  reviewer: DevelopmentReviewerRoleSchema,
  verdict: DevReviewVerdictSchema,
  findings: z.array(DevReviewFindingSchema),
  summary: NonEmptyStringSchema.optional(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export const ReviewerAgentInputSchema = z.object({
  slice: DevelopmentSliceInputSchema,
  branch: NonEmptyStringSchema,
  workspaceRef: WorkspaceRefSchema,
  reviewer: DevelopmentReviewerRoleSchema,
  implementationSummary: ImplementationSummarySchema.optional(),
  verificationResult: VerificationResultSchema.optional(),
  diffSummary: z.string().optional(),
});
export type ReviewerAgentInput = z.infer<typeof ReviewerAgentInputSchema>;

export type ReviewerRunner = {
  run(input: ReviewerAgentInput): Promise<ReviewResult> | ReviewResult;
};

export const SliceDecisionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    summary: NonEmptyStringSchema,
  }),
  z.object({
    status: z.literal("needs-repair"),
    findings: z.array(DevReviewFindingSchema).min(1),
  }),
  z.object({
    status: z.literal("blocked"),
    reason: NonEmptyStringSchema,
    findings: z.array(DevReviewFindingSchema).default([]),
  }),
]);
export type SliceDecision = z.infer<typeof SliceDecisionSchema>;

export const RepairAgentInputSchema = z.object({
  branch: NonEmptyStringSchema,
  workspaceRef: WorkspaceRefSchema,
  slice: DevelopmentSliceInputSchema,
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive().default(2),
  failingCommands: z.array(DevCommandResultSchema).default([]),
  findings: z.array(DevReviewFindingSchema),
});
export type RepairAgentInput = z.input<typeof RepairAgentInputSchema>;

export const RepairResultSchema = z.object({
  status: z.enum(["completed", "failed", "blocked"]),
  attempt: z.number().int().nonnegative(),
  branch: NonEmptyStringSchema.optional(),
  workspaceRef: WorkspaceRefSchema.optional(),
  filesChanged: z.array(NonEmptyStringSchema).default([]),
  fixesAttempted: z.array(NonEmptyStringSchema).default([]),
  findingsAddressed: z.array(DevReviewFindingSchema).default([]),
  limitations: z.array(NonEmptyStringSchema).default([]),
  summary: NonEmptyStringSchema,
});
export type RepairResult = z.infer<typeof RepairResultSchema>;

export const RepairLoopDecisionSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("attempt-repair"),
    attempt: z.number().int().nonnegative(),
    repairKey: NonEmptyStringSchema,
  }),
  z.object({
    status: z.literal("human-gate"),
    reason: NonEmptyStringSchema,
    findings: z.array(DevReviewFindingSchema).default([]),
  }),
]);
export type RepairLoopDecision = z.infer<typeof RepairLoopDecisionSchema>;

export type RepairRunner = {
  capabilities?: readonly CapabilityDeclaration[];
  run(input: z.infer<typeof RepairAgentInputSchema>, context?: DevelopmentRunnerContext): Promise<RepairResult> | RepairResult;
};

export const SliceExecutionPhaseSchema = z.enum([
  "approved",
  "workspace-ready",
  "implementation-running",
  "implementation-completed",
  "verification-running",
  "verification-completed",
  "review-running",
  "review-completed",
  "source-checkpoint-running",
  "repair-running",
  "repair-completed",
  "blocked",
  "completed",
  "failed",
]);
export type SliceExecutionPhase = z.infer<typeof SliceExecutionPhaseSchema>;

export const SliceExecutionStateSchema = z.object({
  sliceId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  phase: SliceExecutionPhaseSchema,
  branch: NonEmptyStringSchema,
  workspaceRef: WorkspaceRefSchema.optional(),
  requiredReviewers: z.array(DevelopmentReviewerRoleSchema).default([]),
  implementation: OpenCodeImplementerOutputSchema.optional(),
  verification: VerificationResultSchema.optional(),
  reviews: z.array(ReviewResultSchema).default([]),
  repairs: z.array(RepairResultSchema).default([]),
  sourceCheckpoint: SourceCheckpointSchema.optional(),
  repairAttempts: z.number().int().nonnegative().default(0),
  maxRepairAttempts: z.number().int().nonnegative().default(0),
  blockers: z.array(DevReviewFindingSchema).default([]),
  finalSummary: NonEmptyStringSchema.optional(),
});
export type SliceExecutionState = z.infer<typeof SliceExecutionStateSchema>;

export const SliceActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("allocate-workspace") }),
  z.object({ type: z.literal("run-implementation") }),
  z.object({ type: z.literal("run-verification"), attempt: z.number().int().nonnegative() }),
  z.object({ type: z.literal("run-reviewers"), reviewers: z.array(DevelopmentReviewerRoleSchema).min(1), attempt: z.number().int().nonnegative() }),
  z.object({ type: z.literal("create-source-checkpoint") }),
  z.object({ type: z.literal("run-repair"), attempt: z.number().int().nonnegative(), findings: z.array(DevReviewFindingSchema).min(1) }),
  z.object({ type: z.literal("require-human-stop"), reason: NonEmptyStringSchema, findings: z.array(DevReviewFindingSchema).default([]) }),
  z.object({ type: z.literal("complete-slice"), summary: NonEmptyStringSchema }),
  z.object({ type: z.literal("fail-slice"), reason: NonEmptyStringSchema, findings: z.array(DevReviewFindingSchema).default([]) }),
]);
export type SliceAction = z.infer<typeof SliceActionSchema>;

export type SliceRunnerAgentOptions = {
  implementationAgent?: AgentContract<string, any, OpenCodeImplementerOutput>;
  verificationAgent?: AgentContract<string, any, VerificationResult>;
  reviewerAgents?: Partial<Record<DevelopmentReviewerRole, AgentContract<string, any, ReviewResult>>>;
  repairAgent?: AgentContract<string, any, RepairResult>;
  sourceCheckpointRunner?: SourceCheckpointRunner;
};

export const CompletedDevelopmentSliceSummarySchema = z.object({
  sliceId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  implementationSummary: ImplementationSummarySchema.optional(),
  verificationResult: VerificationResultSchema,
  reviewResults: z.array(ReviewResultSchema),
  sourceCheckpoint: SourceCheckpointSchema.optional(),
  repairs: z.array(RepairResultSchema).default([]),
  docsChanged: z.array(NonEmptyStringSchema).default([]),
  knownLimitations: z.array(NonEmptyStringSchema).default([]),
  followUps: z.array(NonEmptyStringSchema).default([]),
});
export type CompletedDevelopmentSliceSummary = z.infer<typeof CompletedDevelopmentSliceSummarySchema>;

export const FinalizationModeSchema = z.enum(["none", "local-merge"]);
export type FinalizationMode = z.infer<typeof FinalizationModeSchema>;

export const FinalizationConfigSchema = z
  .object({
    mode: FinalizationModeSchema.default("none"),
    repoRoot: NonEmptyStringSchema.optional(),
    strategy: z.enum(["merge-commit", "ff-only"]).default("merge-commit"),
  })
  .default({ mode: "none", strategy: "merge-commit" });
export type FinalizationConfig = z.infer<typeof FinalizationConfigSchema>;

export const LocalMergeFinalizationInputSchema = z.object({
  repo: NonEmptyStringSchema,
  repoRoot: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  branch: NonEmptyStringSchema,
  strategy: z.enum(["merge-commit", "ff-only"]).default("merge-commit"),
});
export type LocalMergeFinalizationInput = z.input<typeof LocalMergeFinalizationInputSchema>;

export const FinalizationResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("not-requested"),
    mode: z.literal("none"),
    summary: NonEmptyStringSchema,
  }),
  z.object({
    status: z.literal("merged"),
    mode: z.literal("local-merge"),
    repoRoot: NonEmptyStringSchema,
    baseBranch: NonEmptyStringSchema,
    branch: NonEmptyStringSchema,
    strategy: z.enum(["merge-commit", "ff-only"]),
    beforeSha: NonEmptyStringSchema,
    afterSha: NonEmptyStringSchema,
    summary: NonEmptyStringSchema,
  }),
  z.object({
    status: z.literal("blocked"),
    mode: z.literal("local-merge"),
    repoRoot: NonEmptyStringSchema.optional(),
    baseBranch: NonEmptyStringSchema,
    branch: NonEmptyStringSchema,
    strategy: z.enum(["merge-commit", "ff-only"]).default("merge-commit"),
    reason: NonEmptyStringSchema,
    beforeSha: NonEmptyStringSchema.optional(),
    currentBranch: NonEmptyStringSchema.optional(),
    conflictFiles: z.array(NonEmptyStringSchema).default([]),
    summary: NonEmptyStringSchema,
  }),
]);
export type FinalizationResult = z.infer<typeof FinalizationResultSchema>;

export type LocalMergeFinalizationRunner = {
  run(input: z.infer<typeof LocalMergeFinalizationInputSchema>): Promise<FinalizationResult> | FinalizationResult;
};

export const PrDraftInputSchema = z.object({
  initiative: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  branch: NonEmptyStringSchema,
  shippedSlices: z.array(CompletedDevelopmentSliceSummarySchema).min(1),
  knownLimitations: z.array(NonEmptyStringSchema).default([]),
  followUps: z.array(NonEmptyStringSchema).default([]),
  prUrl: z.string().url().optional(),
  github: z
    .object({
      mode: z.enum(["none", "create", "update"]).default("none"),
      draft: z.boolean().default(true),
    })
    .default({ mode: "none", draft: true }),
  finalization: FinalizationConfigSchema,
});
export type PrDraftInput = z.input<typeof PrDraftInputSchema>;

export const PrDraftResultSchema = z.object({
  title: NonEmptyStringSchema,
  branch: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  body: NonEmptyStringSchema,
  shippedSlices: z.array(NonEmptyStringSchema),
  changedBehavior: z.array(NonEmptyStringSchema).default([]),
  filesChanged: z.array(NonEmptyStringSchema).default([]),
  docsChanged: z.array(NonEmptyStringSchema).default([]),
  repairAttempts: z.number().int().nonnegative().default(0),
  tests: z.array(DevCommandResultSchema),
  reviewerVerdicts: z.array(ReviewResultSchema),
  knownLimitations: z.array(NonEmptyStringSchema).default([]),
  followUps: z.array(NonEmptyStringSchema).default([]),
  prUrl: z.string().url().optional(),
  mergeRequiresHumanApproval: z.literal(true).default(true),
  humanApproval: z.enum(["approved", "denied"]).optional(),
  handoffArtifact: z.unknown().optional(),
  finalization: FinalizationResultSchema.optional(),
});
export type PrDraftResult = z.infer<typeof PrDraftResultSchema>;

export const PrHandoffArtifactSchema = z.object({
  initiative: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  branch: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  body: NonEmptyStringSchema,
  shippedSlices: z.array(
    z.object({
      sliceId: NonEmptyStringSchema,
      title: NonEmptyStringSchema,
      summary: NonEmptyStringSchema,
      status: z.literal("completed"),
    }),
  ),
  commits: z.array(
    z.object({
      sha: NonEmptyStringSchema,
      title: NonEmptyStringSchema,
    }),
  ).default([]),
  changedFiles: z.array(NonEmptyStringSchema).default([]),
  docsChanged: z.array(NonEmptyStringSchema).default([]),
  validation: z.object({
    status: z.enum(["passed", "failed"]),
    commands: z.array(DevCommandResultSchema),
  }),
  reviewers: z.array(ReviewResultSchema),
  repairAttempts: z.number().int().nonnegative().default(0),
  knownLimitations: z.array(NonEmptyStringSchema).default([]),
  followUps: z.array(NonEmptyStringSchema).default([]),
  remote: z.object({
    mode: z.enum(["none", "create", "update"]),
    draft: z.boolean(),
    approved: z.boolean(),
    status: z.enum(["not-requested", "pending-approval", "created", "updated", "skipped", "blocked"]).default("pending-approval"),
    prUrl: z.string().url().optional(),
    summary: NonEmptyStringSchema.optional(),
  }),
  finalization: FinalizationResultSchema.default({
    status: "not-requested",
    mode: "none",
    summary: "Local handoff only; no final Git side effect requested.",
  }),
});
export type PrHandoffArtifact = z.infer<typeof PrHandoffArtifactSchema>;

export const InitiativeExecutionPhaseSchema = z.enum([
  "planned",
  "approved",
  "slice-running",
  "slice-completed",
  "blocked",
  "completed",
  "pr-draft-ready",
]);
export type InitiativeExecutionPhase = z.infer<typeof InitiativeExecutionPhaseSchema>;

export const InitiativeExecutionStateSchema = z.object({
  initiative: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  workingBranch: NonEmptyStringSchema,
  phase: InitiativeExecutionPhaseSchema,
  plan: DevelopmentSlicePlanSchema,
  currentSliceIndex: z.number().int().nonnegative(),
  completedSlices: z.array(CompletedDevelopmentSliceSummarySchema).default([]),
  blockedSlice: NonEmptyStringSchema.optional(),
  blockerReason: NonEmptyStringSchema.optional(),
  prDraft: PrDraftResultSchema.optional(),
});
export type InitiativeExecutionState = z.infer<typeof InitiativeExecutionStateSchema>;

export const InitiativeActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run-slice"), slice: DevelopmentSliceInputSchema, index: z.number().int().nonnegative() }),
  z.object({ type: z.literal("run-pr-draft") }),
  z.object({ type: z.literal("complete-initiative") }),
  z.object({ type: z.literal("stop-initiative"), sliceId: NonEmptyStringSchema.optional(), reason: NonEmptyStringSchema }),
]);
export type InitiativeAction = z.infer<typeof InitiativeActionSchema>;

export type InitiativeRunnerAgentOptions = {
  planCompiler?: InitiativePlanCompiler;
  sliceRunnerAgent?: AgentContract<string, any, SliceRunnerOutput>;
  prAgent?: AgentContract<string, any, PrDraftResult>;
  workspaceProvider?: WorkspaceProvider;
  github?: z.input<typeof PrDraftInputSchema>["github"];
  finalization?: z.input<typeof FinalizationConfigSchema>;
};

export const GithubPrUpsertInputSchema = z.object({
  repo: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  body: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  branch: NonEmptyStringSchema,
  existingUrl: z.string().url().optional(),
  draft: z.boolean().default(true),
});
export type GithubPrUpsertInput = z.input<typeof GithubPrUpsertInputSchema>;

export const GithubPrUpsertResultSchema = z.object({
  status: z.enum(["created", "updated", "skipped"]),
  url: z.string().url().optional(),
  summary: NonEmptyStringSchema,
});
export type GithubPrUpsertResult = z.infer<typeof GithubPrUpsertResultSchema>;

export type GithubPrRunner = {
  run(input: z.infer<typeof GithubPrUpsertInputSchema>): Promise<GithubPrUpsertResult> | GithubPrUpsertResult;
};

export const repoReadCapability = capability({
  name: "repo.read",
  description: "Read bounded repository context for development planning.",
  params: z.object({
    repo: NonEmptyStringSchema,
    paths: z.array(NonEmptyStringSchema).min(1),
  }),
});

export const repoWriteBranchCapability = capability({
  name: "repo.write.branch",
  description: "Write repository files only on the configured working branch.",
  params: z.object({
    repo: NonEmptyStringSchema,
    branch: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
  }),
});

export const opencodeRunCapability = capability({
  name: "opencode.run",
  description: "Run OpenCode as a bounded implementation worker.",
  params: z.object({
    workspaceId: NonEmptyStringSchema,
    agentRole: NonEmptyStringSchema,
  }),
});

export const boundedShellCapability = capability({
  name: "shell.exec.bounded",
  description: "Run bounded local commands inside a configured workspace.",
  params: z.object({
    workspaceId: NonEmptyStringSchema,
    purpose: NonEmptyStringSchema,
  }),
});

export const repoRunTestsCapability = capability({
  name: "repo.runTests",
  description: "Run bounded repository verification commands inside a configured workspace.",
  params: z.object({
    repo: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
  }),
});

export const githubPrCreateCapability = capability({
  name: "github.pr.create",
  description: "Create or update a GitHub pull request draft for a development initiative.",
  params: z.object({
    repo: NonEmptyStringSchema,
    baseBranch: NonEmptyStringSchema,
    branch: NonEmptyStringSchema,
    draft: z.boolean(),
  }),
  scope(params) {
    return {
      provider: "github",
      resource: `${params.repo}:${params.branch}`,
      permissions: ["pull_request:write"],
      reason: "Create or update a development initiative pull request draft.",
    };
  },
});

export const localGitMergeCapability = capability({
  name: "git.localMerge",
  description: "Merge a completed development working branch into its base branch locally.",
  params: z.object({
    repo: NonEmptyStringSchema,
    repoRoot: NonEmptyStringSchema,
    baseBranch: NonEmptyStringSchema,
    branch: NonEmptyStringSchema,
  }),
  scope(params) {
    return {
      provider: "git",
      resource: `${params.repo}:${params.baseBranch}`,
      permissions: ["branch:checkout", "branch:merge"],
      reason: `Merge ${params.branch} into ${params.baseBranch} locally after final approval.`,
    };
  },
});

export const developmentRepoContextReadTool = tool({
  name: "dev.repoContext.read",
  description: "Read bounded, explicit repository context files for development initiative planning.",
  input: DevelopmentRepoContextReadInputSchema,
  output: DevelopmentRepoContextSchema,
  capabilities(context) {
    return repoReadCapability.request({ repo: context.input.repo, paths: context.input.contextFiles });
  },
  summarize(output) {
    return `Read ${output.filesRead.length} context file${output.filesRead.length === 1 ? "" : "s"}.`;
  },
  async run(ctx) {
    return readDevelopmentRepoContext(ctx.input);
  },
});

export const developmentBranchStateReadTool = tool({
  name: "dev.branchState.read",
  description: "Read current repository branch and head commit for development slice branch control.",
  input: DevelopmentBranchStateReadInputSchema,
  output: DevelopmentBranchStateSchema,
  capabilities(context) {
    return repoReadCapability.request({ repo: context.input.repo, paths: [".git"] });
  },
  summarize(output) {
    return `Current branch is ${output.currentBranch} at ${output.headCommit.slice(0, 12)}.`;
  },
  async run(ctx) {
    return readDevelopmentBranchState(ctx.input);
  },
});

export function createSourceCheckpointTool(runner: SourceCheckpointRunner = createGitSourceCheckpointRunner()) {
  return tool({
    name: "dev.sourceCheckpoint.create",
    description: "Create a Git commit checkpoint for one completed development slice workspace.",
    input: SourceCheckpointCreateInputSchema,
    output: SourceCheckpointCreateResultSchema,
    capabilities(context) {
      return [
        repoReadCapability.request({ repo: context.input.workspaceRef.repo, paths: [context.input.workspaceRef.path] }),
        repoWriteBranchCapability.request({
          repo: context.input.workspaceRef.repo,
          branch: context.input.workspaceRef.workingBranch,
          workspaceId: context.input.workspaceRef.workspaceId,
        }),
        boundedShellCapability.request({ workspaceId: context.input.workspaceRef.workspaceId, purpose: "source checkpoint commit" }),
      ];
    },
    summarize(output) {
      return output.status === "created" ? `Created source checkpoint ${output.checkpointSha.slice(0, 12)}.` : output.reason;
    },
    async run(ctx) {
      return SourceCheckpointCreateResultSchema.parse(await runner.run(ctx.input));
    },
  });
}

export function createGitSourceCheckpointRunner(): SourceCheckpointRunner {
  return {
    run: createGitSourceCheckpoint,
  };
}

export async function createGitSourceCheckpoint(rawInput: SourceCheckpointCreateInput): Promise<SourceCheckpointCreateResult> {
  const input = SourceCheckpointCreateInputSchema.parse(rawInput);
  let baseSha: string | undefined;
  let changedFiles: string[] = [];

  try {
    const currentBranch = (await git(input.workspaceRef.path, ["branch", "--show-current"])).trim();
    if (currentBranch !== input.workspaceRef.workingBranch) {
      return SourceCheckpointCreateResultSchema.parse({
        status: "failed",
        initiativeThreadId: input.initiativeThreadId,
        sliceThreadId: input.sliceThreadId,
        sliceId: input.sliceId,
        title: input.title,
        workspaceRef: input.workspaceRef,
        reason: `Workspace branch ${currentBranch || "DETACHED_HEAD"} does not match ${input.workspaceRef.workingBranch}.`,
        errorCode: "branch-mismatch",
        failedAt: new Date().toISOString(),
      });
    }

    baseSha = (await git(input.workspaceRef.path, ["rev-parse", "HEAD"])).trim();
    changedFiles = parseGitStatusChangedFiles(await git(input.workspaceRef.path, ["status", "--porcelain", "--untracked-files=all"]));
    if (changedFiles.length === 0) {
      return SourceCheckpointCreateResultSchema.parse({
        status: "failed",
        initiativeThreadId: input.initiativeThreadId,
        sliceThreadId: input.sliceThreadId,
        sliceId: input.sliceId,
        title: input.title,
        workspaceRef: input.workspaceRef,
        baseSha,
        changedFiles,
        commitMessage: input.commitMessage,
        reason: "No source changes to checkpoint.",
        errorCode: "empty-diff",
        failedAt: new Date().toISOString(),
      });
    }

    await git(input.workspaceRef.path, ["add", "--all", "--", "."]);
    await git(input.workspaceRef.path, ["commit", "-m", input.commitMessage]);
    const checkpointSha = (await git(input.workspaceRef.path, ["rev-parse", "HEAD"])).trim();

    return SourceCheckpointCreateResultSchema.parse({
      status: "created",
      checkpointId: deterministicUuid("source-checkpoint", input.initiativeThreadId, input.sliceThreadId, input.sliceId, checkpointSha),
      initiativeThreadId: input.initiativeThreadId,
      sliceThreadId: input.sliceThreadId,
      sliceId: input.sliceId,
      title: input.title,
      workspaceRef: input.workspaceRef,
      baseSha,
      checkpointSha,
      changedFiles,
      commitMessage: input.commitMessage,
      verificationSummary: input.verificationSummary,
      reviewSummary: input.reviewSummary,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return SourceCheckpointCreateResultSchema.parse({
      status: "failed",
      initiativeThreadId: input.initiativeThreadId,
      sliceThreadId: input.sliceThreadId,
      sliceId: input.sliceId,
      title: input.title,
      workspaceRef: input.workspaceRef,
      baseSha,
      changedFiles,
      commitMessage: input.commitMessage,
      reason: error instanceof Error ? error.message : String(error),
      errorCode: "git-checkpoint-failed",
      failedAt: new Date().toISOString(),
    });
  }
}

export function createOpenCodeImplementationTool(runner: OpenCodeImplementationRunner) {
  const adapterCapabilities = runner.capabilities ?? [];
  return tool({
    name: "dev.opencode.implement",
    description: "Run OpenCode to implement one bounded development slice inside a configured workspace.",
    input: OpenCodeImplementerInputSchema,
    output: OpenCodeImplementerOutputSchema,
    capabilities(context) {
      return [
        repoReadCapability.request({ repo: context.input.workspaceRef.repo, paths: [context.input.workspaceRef.path] }),
        repoWriteBranchCapability.request({
          repo: context.input.workspaceRef.repo,
          branch: context.input.branch,
          workspaceId: context.input.workspaceRef.workspaceId,
        }),
        opencodeRunCapability.request({ workspaceId: context.input.workspaceRef.workspaceId, agentRole: "implementer" }),
        boundedShellCapability.request({ workspaceId: context.input.workspaceRef.workspaceId, purpose: "implementation" }),
        ...adapterCapabilities,
      ];
    },
    summarize(output) {
      return output.status === "completed" ? output.summary.summary : output.reason;
    },
    async run(ctx) {
      try {
        const result = await runner.run(ctx.input, { progress: ctx.progress });
        return OpenCodeImplementerOutputSchema.parse({
          status: "completed",
          branch: ctx.input.branch,
          workspaceRef: ctx.input.workspaceRef,
          summary: ImplementationSummarySchema.parse(result),
        });
      } catch (error) {
        if (error instanceof DevelopmentBlockedRunnerError) {
          return OpenCodeImplementerOutputSchema.parse({
            status: "blocked",
            branch: ctx.input.branch,
            workspaceRef: ctx.input.workspaceRef,
            reason: error.reason,
          });
        }
        throw error;
      }
    },
  });
}

export function createVerificationTool(runner: VerificationRunner) {
  return tool({
    name: "dev.verification.run",
    description: "Run bounded verification commands for one development slice workspace.",
    input: VerificationAgentInputSchema,
    output: VerificationResultSchema,
    capabilities(context) {
      return [
        repoRunTestsCapability.request({ repo: context.input.workspaceRef.repo, workspaceId: context.input.workspaceRef.workspaceId }),
        boundedShellCapability.request({ workspaceId: context.input.workspaceRef.workspaceId, purpose: "verification" }),
      ];
    },
    summarize(output) {
      return `Verification ${output.status} with ${output.commands.length} command(s).`;
    },
    async run(ctx) {
      const result = await runner.run(VerificationAgentInputSchema.parse(ctx.input));
      return VerificationResultSchema.parse(result);
    },
  });
}

export function createReviewerTool(runner: ReviewerRunner) {
  return tool({
    name: "dev.review.run",
    description: "Run a read-only reviewer for one development slice workspace.",
    input: ReviewerAgentInputSchema,
    output: ReviewResultSchema,
    capabilities(context) {
      return [
        repoReadCapability.request({ repo: context.input.workspaceRef.repo, paths: [context.input.workspaceRef.path] }),
        workspaceDiffCapability.request({
          provider: context.input.workspaceRef.provider,
          repo: context.input.workspaceRef.repo,
          workspaceId: context.input.workspaceRef.workspaceId,
        }),
      ];
    },
    summarize(output) {
      return `${output.reviewer} verdict: ${output.verdict}`;
    },
    async run(ctx) {
      const result = await runner.run(ReviewerAgentInputSchema.parse(ctx.input));
      return ReviewResultSchema.parse(result);
    },
  });
}

export function createRepairTool(runner: RepairRunner) {
  const adapterCapabilities = runner.capabilities ?? [];
  return tool({
    name: "dev.opencode.repair",
    description: "Run OpenCode to repair only supplied verification failures and reviewer findings.",
    input: RepairAgentInputSchema,
    output: RepairResultSchema,
    capabilities(context) {
      return [
        repoReadCapability.request({ repo: context.input.workspaceRef.repo, paths: [context.input.workspaceRef.path] }),
        repoWriteBranchCapability.request({
          repo: context.input.workspaceRef.repo,
          branch: context.input.branch,
          workspaceId: context.input.workspaceRef.workspaceId,
        }),
        opencodeRunCapability.request({ workspaceId: context.input.workspaceRef.workspaceId, agentRole: "repair" }),
        boundedShellCapability.request({ workspaceId: context.input.workspaceRef.workspaceId, purpose: "repair" }),
        ...adapterCapabilities,
      ];
    },
    summarize(output) {
      return output.summary;
    },
    async run(ctx) {
      const input = RepairAgentInputSchema.parse(ctx.input);
      try {
        const result = await runner.run(input, { progress: ctx.progress });
        return RepairResultSchema.parse(result);
      } catch (error) {
        if (error instanceof DevelopmentBlockedRunnerError) {
          return RepairResultSchema.parse({
            status: "blocked",
            attempt: input.attempt,
            branch: input.branch,
            workspaceRef: input.workspaceRef,
            summary: error.reason,
            limitations: ["Repair stopped for human decision."],
          });
        }
        throw error;
      }
    },
  });
}

export function createGithubPrUpsertTool(runner: GithubPrRunner) {
  return tool({
    name: "dev.github.pr.upsert",
    description: "Create or update a GitHub PR draft for a completed development initiative.",
    input: GithubPrUpsertInputSchema,
    output: GithubPrUpsertResultSchema,
    capabilities(context) {
      return githubPrCreateCapability.request({
        repo: context.input.repo,
        baseBranch: context.input.baseBranch,
        branch: context.input.branch,
        draft: context.input.draft,
      });
    },
    summarize(output) {
      return output.summary;
    },
    async run(ctx) {
      const result = await runner.run(GithubPrUpsertInputSchema.parse(ctx.input));
      return GithubPrUpsertResultSchema.parse(result);
    },
  });
}

export function createLocalMergeFinalizationTool(runner: LocalMergeFinalizationRunner) {
  return tool({
    name: "dev.git.localMerge",
    description: "Merge a completed initiative branch into its base branch in the local repository.",
    input: LocalMergeFinalizationInputSchema,
    output: FinalizationResultSchema,
    capabilities(context) {
      return localGitMergeCapability.request({
        repo: context.input.repo,
        repoRoot: context.input.repoRoot,
        baseBranch: context.input.baseBranch,
        branch: context.input.branch,
      });
    },
    summarize(output) {
      return output.summary;
    },
    async run(ctx) {
      const result = await runner.run(LocalMergeFinalizationInputSchema.parse(ctx.input));
      return FinalizationResultSchema.parse(result);
    },
  });
}

export function createGitLocalMergeFinalizationRunner(): LocalMergeFinalizationRunner {
  return {
    async run(rawInput) {
      const input = LocalMergeFinalizationInputSchema.parse(rawInput);
      if (input.baseBranch === input.branch) {
        return FinalizationResultSchema.parse({
          status: "blocked",
          mode: "local-merge",
          repoRoot: input.repoRoot,
          baseBranch: input.baseBranch,
          branch: input.branch,
          strategy: input.strategy,
          reason: "Base branch and working branch are the same.",
          summary: "Local merge blocked because base and working branch match.",
        });
      }

      let dirtyFiles: string[];
      try {
        dirtyFiles = parseGitStatusChangedFiles(await git(input.repoRoot, ["status", "--porcelain", "--untracked-files=all"]));
      } catch (error) {
        return FinalizationResultSchema.parse({
          status: "blocked",
          mode: "local-merge",
          repoRoot: input.repoRoot,
          baseBranch: input.baseBranch,
          branch: input.branch,
          strategy: input.strategy,
          reason: `Could not inspect repository status: ${errorToMessage(error)}.`,
          summary: "Local merge blocked during Git preflight.",
        });
      }

      let currentBranch: string;
      try {
        currentBranch = (await git(input.repoRoot, ["branch", "--show-current"])).trim() || "DETACHED_HEAD";
      } catch (error) {
        return FinalizationResultSchema.parse({
          status: "blocked",
          mode: "local-merge",
          repoRoot: input.repoRoot,
          baseBranch: input.baseBranch,
          branch: input.branch,
          strategy: input.strategy,
          reason: `Could not determine current branch: ${errorToMessage(error)}.`,
          summary: "Local merge blocked during Git preflight.",
        });
      }

      let beforeSha: string;
      try {
        beforeSha = (await git(input.repoRoot, ["rev-parse", input.baseBranch])).trim();
      } catch (error) {
        return FinalizationResultSchema.parse({
          status: "blocked",
          mode: "local-merge",
          repoRoot: input.repoRoot,
          baseBranch: input.baseBranch,
          branch: input.branch,
          strategy: input.strategy,
          reason: `Could not resolve base branch ${input.baseBranch}: ${errorToMessage(error)}.`,
          currentBranch,
          summary: "Local merge blocked during Git preflight.",
        });
      }
      if (dirtyFiles.length > 0) {
        return FinalizationResultSchema.parse({
          status: "blocked",
          mode: "local-merge",
          repoRoot: input.repoRoot,
          baseBranch: input.baseBranch,
          branch: input.branch,
          strategy: input.strategy,
          reason: `Repository has uncommitted changes: ${dirtyFiles.join(", ")}.`,
          beforeSha,
          currentBranch,
          summary: "Local merge blocked because the repository is dirty.",
        });
      }

      try {
        await git(input.repoRoot, ["checkout", input.baseBranch]);
      } catch (error) {
        return FinalizationResultSchema.parse({
          status: "blocked",
          mode: "local-merge",
          repoRoot: input.repoRoot,
          baseBranch: input.baseBranch,
          branch: input.branch,
          strategy: input.strategy,
          reason: `Could not checkout ${input.baseBranch}: ${errorToMessage(error)}.`,
          beforeSha,
          currentBranch,
          summary: "Local merge blocked before changing the base branch.",
        });
      }

      try {
        const mergeArgs = input.strategy === "ff-only"
          ? ["merge", "--ff-only", input.branch]
          : ["merge", "--no-ff", input.branch, "-m", `Merge ${input.branch} into ${input.baseBranch}`];
        await git(input.repoRoot, mergeArgs);
      } catch (error) {
        const conflictFiles = parseGitStatusChangedFiles(await git(input.repoRoot, ["status", "--porcelain", "--untracked-files=all"]));
        return FinalizationResultSchema.parse({
          status: "blocked",
          mode: "local-merge",
          repoRoot: input.repoRoot,
          baseBranch: input.baseBranch,
          branch: input.branch,
          strategy: input.strategy,
          reason: `Local merge failed: ${errorToMessage(error)}.`,
          beforeSha,
          currentBranch: input.baseBranch,
          conflictFiles,
          summary: conflictFiles.length > 0 ? "Local merge blocked with conflicts." : "Local merge blocked by Git.",
        });
      }

      const afterSha = (await git(input.repoRoot, ["rev-parse", "HEAD"])).trim();
      return FinalizationResultSchema.parse({
        status: "merged",
        mode: "local-merge",
        repoRoot: input.repoRoot,
        baseBranch: input.baseBranch,
        branch: input.branch,
        strategy: input.strategy,
        beforeSha,
        afterSha,
        summary: `Merged ${input.branch} into ${input.baseBranch} locally.`,
      });
    },
  };
}


export function buildDevelopmentSlicePlan(input: DevelopmentInitiativeInput): DevelopmentSlicePlan {
  if (!input.slices?.length) {
    throw new Error("Development initiatives require at least one slice until model-backed planning ships.");
  }

  const slices = input.slices.map((slice) => DevelopmentSliceInputSchema.parse(slice));

  return DevelopmentSlicePlanSchema.parse({
    initiative: input.initiative,
    repo: input.repo,
    baseBranch: input.baseBranch,
    workingBranch: input.workingBranch,
    slices,
    approvalRequired: true,
    summary: `Plan ${slices.length} development slice${slices.length === 1 ? "" : "s"} for ${input.initiative}.`,
  });
}

export async function compileInitiativePlan(rawInput: InitiativePlanCompilerInput, compiler: InitiativePlanCompiler): Promise<InitiativePlan> {
  const input = InitiativePlanCompilerInputSchema.parse(rawInput);
  const compiled = InitiativePlanSchema.parse(await compiler.compile(input));

  if (compiled.repo !== input.repo) {
    throw new Error(`Compiled plan repo ${compiled.repo} does not match requested repo ${input.repo}.`);
  }

  if (compiled.baseBranch !== input.baseBranch) {
    throw new Error(`Compiled plan base branch ${compiled.baseBranch} does not match requested base branch ${input.baseBranch}.`);
  }

  if (compiled.workingBranch !== input.workingBranch) {
    throw new Error(`Compiled plan working branch ${compiled.workingBranch} does not match requested working branch ${input.workingBranch}.`);
  }

  if (compiled.status !== "proposed") {
    throw new Error(`Compiled plans must be proposed, received ${compiled.status}.`);
  }

  return compiled;
}

export function createMarkdownInitiativePlanCompiler(options: {
  defaultVerificationStrategy?: readonly string[];
  defaultReviewers?: readonly DevelopmentReviewerRole[];
} = {}): InitiativePlanCompiler {
  return {
    compile(input) {
      return compileMarkdownInitiativePlan(input, options);
    },
  };
}

export function compileMarkdownInitiativePlan(
  rawInput: InitiativePlanCompilerInput,
  options: {
    defaultVerificationStrategy?: readonly string[];
    defaultReviewers?: readonly DevelopmentReviewerRole[];
  } = {},
): InitiativePlan {
  const input = InitiativePlanCompilerInputSchema.parse(rawInput);
  const sections = extractSliceSections(input.spec.statementOfWork);
  const defaultVerificationStrategy = [...(options.defaultVerificationStrategy ?? ["npm test", "npm run typecheck", "git diff --check"])];
  const defaultReviewers = [...(options.defaultReviewers ?? ["architecture-reviewer"])] satisfies DevelopmentReviewerRole[];
  const sliceSections = sections.length > 0 ? sections : [{ title: input.spec.title, body: input.spec.statementOfWork }];
  const slices = sliceSections.map((section, index) => {
    const title = normalizeSliceTitle(section.title);
    return DevelopmentSliceInputSchema.parse({
      id: `${String(index + 1).padStart(2, "0")}-${slugify(title)}`,
      title,
      objective: firstSentence(section.body) ?? `Implement ${title}.`,
      acceptanceCriteria: extractAcceptanceCriteria(section.body, input.spec.acceptanceCriteria, title),
      expectedTouchpoints: uniqueStrings([...input.spec.affectedAreas, ...extractBacktickPaths(section.body)]),
      verificationStrategy: defaultVerificationStrategy,
      constraints: input.spec.constraints,
      requiredReviewers: defaultReviewers,
      riskNotes: input.spec.risks,
      status: "proposed",
    });
  });

  return InitiativePlanSchema.parse({
    initiative: input.spec.title,
    repo: input.repo,
    baseBranch: input.baseBranch,
    workingBranch: input.workingBranch,
    specTitle: input.spec.title,
    goals: input.spec.goals,
    nonGoals: input.spec.nonGoals,
    constraints: input.spec.constraints,
    acceptanceCriteria: input.spec.acceptanceCriteria,
    risks: input.spec.risks,
    affectedAreas: input.spec.affectedAreas,
    slices,
    approvalRequired: true,
    summary: `Proposed ${slices.length} development slice${slices.length === 1 ? "" : "s"} for ${input.spec.title}.`,
    status: "proposed",
    revision: 1,
    revisionHistory: [{ revision: 1, reason: "Initial PRD/SOW compiler proposal.", changedBy: "weave.maintainer" }],
  });
}

export async function readDevelopmentRepoContext(
  rawInput: DevelopmentRepoContextReadInput,
): Promise<DevelopmentRepoContext> {
  const input = DevelopmentRepoContextReadInputSchema.parse(rawInput);
  const root = path.resolve(input.repoRoot ?? process.cwd());
  const entries: DevelopmentRepoContextEntry[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (const requestedPath of input.contextFiles) {
    const relativePath = requestedPath.replace(/\/+$|^\.\//g, "");
    const resolvedPath = path.resolve(root, relativePath);
    const relativeResolved = path.relative(root, resolvedPath);

    if (relativeResolved.startsWith("..") || path.isAbsolute(relativeResolved)) {
      entries.push({ path: requestedPath, kind: "denied", bytes: 0, reason: "Path escapes repository root." });
      continue;
    }

    let fileStat;
    try {
      fileStat = await stat(resolvedPath);
    } catch {
      entries.push({ path: requestedPath, kind: "missing", bytes: 0, reason: "Path does not exist." });
      continue;
    }

    if (fileStat.isDirectory()) {
      entries.push({ path: requestedPath, kind: "directory", bytes: 0, reason: "Directory expansion is not part of this tool." });
      continue;
    }

    if (!fileStat.isFile()) {
      entries.push({ path: requestedPath, kind: "denied", bytes: 0, reason: "Path is not a regular file." });
      continue;
    }

    if (fileStat.size > input.maxFileBytes) {
      entries.push({ path: requestedPath, kind: "too-large", bytes: fileStat.size, reason: "File exceeds maxFileBytes." });
      truncated = true;
      continue;
    }

    if (totalBytes + fileStat.size > input.maxTotalBytes) {
      entries.push({ path: requestedPath, kind: "too-large", bytes: fileStat.size, reason: "Reading file would exceed maxTotalBytes." });
      truncated = true;
      continue;
    }

    const content = await readFile(resolvedPath, "utf8");
    totalBytes += Buffer.byteLength(content);
    entries.push({ path: requestedPath, kind: "file", bytes: Buffer.byteLength(content), content });
  }

  return DevelopmentRepoContextSchema.parse({
    repo: input.repo,
    filesRead: entries.filter((entry) => entry.kind === "file").map((entry) => entry.path),
    entries,
    totalBytes,
    truncated,
  });
}

export async function readDevelopmentBranchState(
  rawInput: DevelopmentBranchStateReadInput,
): Promise<DevelopmentBranchState> {
  const input = DevelopmentBranchStateReadInputSchema.parse(rawInput);
  const cwd = path.resolve(input.repoRoot ?? process.cwd());
  const [root, branch, head] = await Promise.all([
    git(cwd, ["rev-parse", "--show-toplevel"]),
    git(cwd, ["branch", "--show-current"]),
    git(cwd, ["rev-parse", "HEAD"]),
  ]);
  const currentBranch = branch.trim();

  return DevelopmentBranchStateSchema.parse({
    repo: input.repo,
    repoRoot: root.trim(),
    currentBranch: currentBranch || "DETACHED_HEAD",
    headCommit: head.trim(),
    isDetachedHead: currentBranch.length === 0,
  });
}

export function evaluateSliceBranchState(input: SliceRunnerInput, branchState: DevelopmentBranchState): SliceRunnerOutput {
  if (input.branch === "main") {
    return SliceRunnerOutputSchema.parse({
      status: "blocked",
      sliceId: input.slice.id,
      branch: input.branch,
      reason: "Refusing to run development slices on main.",
      branchState,
    });
  }

  if (branchState.isDetachedHead) {
    return SliceRunnerOutputSchema.parse({
      status: "blocked",
      sliceId: input.slice.id,
      branch: input.branch,
      reason: "Current worktree is in detached HEAD state.",
      branchState,
    });
  }

  if (branchState.currentBranch !== input.branch) {
    return SliceRunnerOutputSchema.parse({
      status: "blocked",
      sliceId: input.slice.id,
      branch: input.branch,
      reason: `Current branch ${branchState.currentBranch} does not match required branch ${input.branch}.`,
      branchState,
    });
  }

  return SliceRunnerOutputSchema.parse({
    status: "ready",
    sliceId: input.slice.id,
    branch: input.branch,
    branchState,
    workspaceRef: input.workspaceRef,
  });
}

export function evaluateOpenCodeImplementerInput(input: OpenCodeImplementerInput): OpenCodeImplementerOutput | undefined {
  if (input.branch === "main") {
    return OpenCodeImplementerOutputSchema.parse({
      status: "blocked",
      branch: input.branch,
      workspaceRef: input.workspaceRef,
      reason: "Refusing to run OpenCode implementation on main.",
    });
  }

  if (input.workspaceRef.workingBranch !== input.branch) {
    return OpenCodeImplementerOutputSchema.parse({
      status: "blocked",
      branch: input.branch,
      workspaceRef: input.workspaceRef,
      reason: `Workspace branch ${input.workspaceRef.workingBranch} does not match requested branch ${input.branch}.`,
    });
  }

  return undefined;
}

export function outOfScopeImplementationFiles(input: OpenCodeImplementerInput, summary: ImplementationSummary): string[] {
  if (!input.allowedFiles?.length) {
    return [];
  }

  return summary.filesChanged.filter((changedFile) => !input.allowedFiles?.some((allowedFile) => pathMatchesAllowedFile(changedFile, allowedFile)));
}

export function evaluateSliceReadinessForCompletion(input: {
  implementationSummary?: ImplementationSummary;
  verificationResult: VerificationResult;
  reviewResults: readonly ReviewResult[];
}): SliceDecision {
  if (input.verificationResult.status !== "passed") {
    return SliceDecisionSchema.parse({
      status: "needs-repair",
      findings: [
        {
          severity: "high",
          issue: input.verificationResult.failureSummary ?? "Verification failed.",
        },
      ],
    });
  }

  const blockedReview = input.reviewResults.find((review) => review.verdict === "blocked");
  if (blockedReview) {
    return SliceDecisionSchema.parse({
      status: "blocked",
      reason: blockedReview.summary ?? `${blockedReview.reviewer} blocked the slice.`,
      findings: blockedReview.findings,
    });
  }

  const fixFindings = input.reviewResults.flatMap((review) => (review.verdict === "needs-fixes" ? review.findings : []));
  if (fixFindings.length > 0) {
    return SliceDecisionSchema.parse({ status: "needs-repair", findings: fixFindings });
  }

  return SliceDecisionSchema.parse({
    status: "completed",
    summary: input.implementationSummary?.summary ?? "Verification and review passed.",
  });
}

export function requiredReviewersForSlice(slice: DevelopmentSliceInput): DevelopmentReviewerRole[] {
  return slice.requiredReviewers.length > 0 ? slice.requiredReviewers : ["architecture-reviewer"];
}

export function createInitialSliceExecutionState(input: SliceRunnerInput): SliceExecutionState {
  return SliceExecutionStateSchema.parse({
    sliceId: input.slice.id,
    title: input.slice.title,
    phase: input.workspaceRef ? "workspace-ready" : "approved",
    branch: input.branch,
    workspaceRef: input.workspaceRef,
    requiredReviewers: requiredReviewersForSlice(input.slice),
    reviews: [],
    repairs: [],
    repairAttempts: 0,
    maxRepairAttempts: input.maxRepairAttempts,
    blockers: [],
  });
}

export function decideNextSliceAction(rawState: SliceExecutionState): SliceAction {
  const state = SliceExecutionStateSchema.parse(rawState);

  if (!state.workspaceRef) {
    return SliceActionSchema.parse({ type: "allocate-workspace" });
  }

  if (!state.implementation) {
    return SliceActionSchema.parse({ type: "run-implementation" });
  }

  if (state.implementation.status === "blocked") {
    return SliceActionSchema.parse({ type: "require-human-stop", reason: state.implementation.reason, findings: [] });
  }

  const attempt = state.repairs.length;
  if (!state.verification) {
    return SliceActionSchema.parse({ type: "run-verification", attempt });
  }

  const missingReviewers = state.requiredReviewers.filter((reviewer) => !state.reviews.some((review) => review.reviewer === reviewer));
  if (missingReviewers.length > 0) {
    return SliceActionSchema.parse({ type: "run-reviewers", reviewers: missingReviewers, attempt });
  }

  const decision = evaluateSliceReadinessForCompletion({
    implementationSummary: state.implementation.summary,
    verificationResult: state.verification,
    reviewResults: state.reviews,
  });

  if (decision.status === "completed") {
    if (!state.sourceCheckpoint) {
      return SliceActionSchema.parse({ type: "create-source-checkpoint" });
    }
    return SliceActionSchema.parse({ type: "complete-slice", summary: decision.summary });
  }

  const highRiskFinding = highRiskReviewerFinding(state.reviews);
  if (highRiskFinding) {
    return SliceActionSchema.parse({
      type: "require-human-stop",
      reason: `High-risk reviewer finding requires human approval: ${highRiskFinding.issue}`,
      findings: [highRiskFinding],
    });
  }

  if (decision.status === "blocked") {
    return SliceActionSchema.parse({ type: "fail-slice", reason: decision.reason, findings: decision.findings });
  }

  if (attempt >= state.maxRepairAttempts) {
    return SliceActionSchema.parse({
      type: "require-human-stop",
      reason: `Repair attempts exhausted after ${attempt} attempt(s).`,
      findings: decision.findings,
    });
  }

  return SliceActionSchema.parse({ type: "run-repair", attempt, findings: decision.findings });
}

export function createVerificationAgent(options: {
  name?: string;
  description?: string;
  runner: VerificationRunner;
}) {
  const verificationTool = createVerificationTool(options.runner);

  return agent({
    name: options.name ?? "weave.verifier",
    description: options.description ?? "Runs bounded deterministic verification for one development slice workspace.",
    input: VerificationAgentInputSchema,
    output: VerificationResultSchema,
    tools: [verificationTool],
    async run(ctx, rawInput) {
      const input = VerificationAgentInputSchema.parse(rawInput);
      const result = await ctx.tool("run-verification", verificationTool, input);
      const checkpointed = await ctx.checkpoint(DevelopmentCheckpointKeys.testResults, () => result);
      await ctx.emit(
        `verification-completed:${input.sliceId}`,
        developmentEvents.verificationCompleted({
          sliceId: input.sliceId,
          branch: input.branch,
          status: checkpointed.status,
          commands: checkpointed.commands,
        }),
      );
      return checkpointed;
    },
  });
}

export function repairAttemptKey(attempt: number): string {
  return `repair:${attempt}`;
}

export function decideRepairLoop(input: {
  currentAttempt: number;
  maxAttempts: number;
  findings: readonly DevReviewFinding[];
  highRiskFiles?: readonly string[];
}): RepairLoopDecision {
  const highRiskFinding = input.findings.find((finding) => {
    if (finding.severity === "high") {
      return true;
    }
    return Boolean(finding.file && input.highRiskFiles?.some((highRiskFile) => pathMatchesAllowedFile(finding.file!, highRiskFile)));
  });

  if (highRiskFinding) {
    return RepairLoopDecisionSchema.parse({
      status: "human-gate",
      reason: `High-risk repair requires human approval: ${highRiskFinding.issue}`,
      findings: input.findings,
    });
  }

  if (input.currentAttempt >= input.maxAttempts) {
    return RepairLoopDecisionSchema.parse({
      status: "human-gate",
      reason: `Repair attempts exhausted after ${input.currentAttempt} attempt(s).`,
      findings: input.findings,
    });
  }

  return RepairLoopDecisionSchema.parse({
    status: "attempt-repair",
    attempt: input.currentAttempt,
    repairKey: repairAttemptKey(input.currentAttempt),
  });
}

export function createRepairAgent(options: {
  name?: string;
  description?: string;
  runner: RepairRunner;
}) {
  const repairTool = createRepairTool(options.runner);

  return agent({
    name: options.name ?? "weave.opencodeRepair",
    description: options.description ?? "Runs bounded OpenCode repair for supplied verification failures and reviewer findings.",
    input: RepairAgentInputSchema,
    output: RepairResultSchema,
    tools: [repairTool],
    async run(ctx, rawInput) {
      const input = RepairAgentInputSchema.parse(rawInput);
      const attemptCount = await ctx.checkpoint(DevelopmentCheckpointKeys.repairAttemptCount, () => input.attempt);
      const decision = decideRepairLoop({
        currentAttempt: attemptCount,
        maxAttempts: input.maxAttempts,
        findings: input.findings,
        highRiskFiles: ["src/events.ts", "src/postgres-engine.ts", "src/capability-contract.ts", "src/policy-contract.ts"],
      });

      let repairAttempt: { attempt: number; repairKey: string };
      if (decision.status === "human-gate") {
        const resolution = await ctx.gate("repair-stop", {
          reason: "repair-stop",
          proposedAction: decision.reason,
        });
        if (resolution.resolution !== "approved") {
          return RepairResultSchema.parse({
            status: "blocked",
            attempt: input.attempt,
            branch: input.branch,
            workspaceRef: input.workspaceRef,
            summary: resolution.comment?.trim() ? `Repair denied: ${resolution.comment}` : decision.reason,
            limitations: ["Repair stopped for human decision."],
          });
        }
        repairAttempt = { attempt: attemptCount, repairKey: repairAttemptKey(attemptCount) };
      } else {
        repairAttempt = decision;
      }

      await ctx.emit(
        `repair-started:${input.slice.id}:${repairAttempt.repairKey}`,
        developmentEvents.repairStarted({
          sliceId: input.slice.id,
          branch: input.branch,
          attempt: repairAttempt.attempt,
          findings: input.findings,
        }),
      );

      const repairResult = await ctx.tool(repairAttempt.repairKey, repairTool, input);
      await ctx.emit(
        `repair-completed:${input.slice.id}:${repairAttempt.repairKey}`,
        developmentEvents.repairCompleted({
          sliceId: input.slice.id,
          branch: input.branch,
          attempt: repairResult.attempt,
          status: repairResult.status,
          summary: repairResult.summary,
        }),
      );

      return RepairResultSchema.parse({
        ...repairResult,
        branch: repairResult.branch ?? input.branch,
        workspaceRef: repairResult.workspaceRef ?? input.workspaceRef,
      });
    },
  });
}

export function buildPrDraft(rawInput: PrDraftInput): PrDraftResult {
  const input = PrDraftInputSchema.parse(rawInput);
  const shippedSlices = input.shippedSlices.map((slice) => slice.sliceId);
  const changedBehavior = uniqueStrings(input.shippedSlices.flatMap((slice) => slice.implementationSummary?.behaviorChanged ?? []));
  const filesChanged = uniqueStrings(
    input.shippedSlices.flatMap((slice) => [
      ...(slice.implementationSummary?.filesChanged ?? []),
      ...slice.repairs.flatMap((repair) => repair.filesChanged),
    ]),
  );
  const docsChanged = uniqueStrings(
    input.shippedSlices.flatMap((slice) => [...slice.docsChanged, ...(slice.implementationSummary?.docsChanged ?? [])]),
  );
  const tests = input.shippedSlices.flatMap((slice) => slice.verificationResult.commands);
  const reviewerVerdicts = input.shippedSlices.flatMap((slice) => slice.reviewResults);
  const repairAttempts = input.shippedSlices.reduce((count, slice) => count + slice.repairs.length, 0);
  const knownLimitations = uniqueStrings(
    input.shippedSlices.flatMap((slice) => [
      ...slice.knownLimitations,
      ...(slice.implementationSummary?.knownLimitations ?? []),
      ...slice.repairs.flatMap((repair) => repair.limitations),
    ]).concat(input.knownLimitations),
  );
  const followUps = uniqueStrings(
    input.shippedSlices.flatMap((slice) => [
      ...slice.followUps,
      ...(slice.implementationSummary?.followUpSuggestions ?? []),
    ]).concat(input.followUps),
  );
  const title = input.initiative;
  const body = renderPrDraftBody({
    title,
    baseBranch: input.baseBranch,
    branch: input.branch,
    slices: input.shippedSlices,
    changedBehavior,
    filesChanged,
    docsChanged,
    tests,
    reviewerVerdicts,
    repairAttempts,
    knownLimitations,
    followUps,
  });

  return PrDraftResultSchema.parse({
    title,
    branch: input.branch,
    baseBranch: input.baseBranch,
    body,
    shippedSlices,
    changedBehavior,
    filesChanged,
    docsChanged,
    repairAttempts,
    tests,
    reviewerVerdicts,
    knownLimitations,
    followUps,
    prUrl: input.prUrl,
    mergeRequiresHumanApproval: true,
  });
}

export function buildPrHandoffArtifact(input: {
  prInput: PrDraftInput;
  draft: PrDraftResult;
  remoteApproved?: boolean;
  remoteResult?: GithubPrUpsertResult;
  finalizationResult?: FinalizationResult;
}): PrHandoffArtifact {
  const prInput = PrDraftInputSchema.parse(input.prInput);
  const draft = PrDraftResultSchema.parse(input.draft);
  const failedCommands = draft.tests.filter((command) => command.status === "failed");
  if (failedCommands.length > 0) {
    throw new Error(`Cannot create PR handoff with failed validation: ${failedCommands.map((command) => command.command).join(", ")}.`);
  }

  const remoteApproved = input.remoteApproved ?? false;
  const remoteResult = input.remoteResult;
  return PrHandoffArtifactSchema.parse({
    initiative: prInput.initiative,
    repo: prInput.repo,
    baseBranch: prInput.baseBranch,
    branch: prInput.branch,
    title: draft.title,
    body: draft.body,
    shippedSlices: prInput.shippedSlices.map((slice) => ({
      sliceId: slice.sliceId,
      title: slice.title,
      summary: slice.summary,
      status: "completed",
    })),
    commits: prInput.shippedSlices.flatMap((slice) =>
      slice.sourceCheckpoint ? [{ sha: slice.sourceCheckpoint.checkpointSha, title: slice.title }] : [],
    ),
    changedFiles: draft.filesChanged,
    docsChanged: draft.docsChanged,
    validation: {
      status: "passed",
      commands: draft.tests,
    },
    reviewers: draft.reviewerVerdicts,
    repairAttempts: draft.repairAttempts,
    knownLimitations: draft.knownLimitations,
    followUps: draft.followUps,
    remote: {
      mode: prInput.github.mode,
      draft: prInput.github.draft,
      approved: remoteApproved,
      status: remoteResult?.status ?? (prInput.github.mode === "none" ? "not-requested" : remoteApproved ? "blocked" : "pending-approval"),
      prUrl: remoteResult?.url ?? draft.prUrl,
      summary: remoteResult?.summary ?? (remoteApproved && prInput.github.mode !== "none" ? "Remote PR mode was approved, but no GitHub PR runner result was recorded." : undefined),
    },
    finalization: input.finalizationResult,
  });
}

export function createInitialInitiativeExecutionState(input: {
  plan: DevelopmentSlicePlan;
  completedSlices?: CompletedDevelopmentSliceSummary[];
  prDraft?: PrDraftResult;
}): InitiativeExecutionState {
  const completedSlices = input.completedSlices ?? [];
  return InitiativeExecutionStateSchema.parse({
    initiative: input.plan.initiative,
    repo: input.plan.repo,
    baseBranch: input.plan.baseBranch,
    workingBranch: input.plan.workingBranch,
    phase: completedSlices.length === 0 ? "approved" : completedSlices.length < input.plan.slices.length ? "slice-completed" : input.prDraft ? "pr-draft-ready" : "completed",
    plan: input.plan,
    currentSliceIndex: completedSlices.length,
    completedSlices,
    prDraft: input.prDraft,
  });
}

export function decideNextInitiativeAction(rawState: InitiativeExecutionState): InitiativeAction {
  const state = InitiativeExecutionStateSchema.parse(rawState);

  if (state.phase === "blocked") {
    return InitiativeActionSchema.parse({
      type: "stop-initiative",
      sliceId: state.blockedSlice,
      reason: state.blockerReason ?? "Initiative is blocked.",
    });
  }

  if (state.completedSlices.length < state.plan.slices.length) {
    const index = state.completedSlices.length;
    const slice = state.plan.slices[index];
    if (!slice) {
      return InitiativeActionSchema.parse({ type: "stop-initiative", reason: `Missing slice at index ${index}.` });
    }
    return InitiativeActionSchema.parse({ type: "run-slice", slice, index });
  }

  if (!state.prDraft) {
    return InitiativeActionSchema.parse({ type: "run-pr-draft" });
  }

  return InitiativeActionSchema.parse({ type: "complete-initiative" });
}

export function shouldCleanupWorkspace(input: {
  policy: DevelopmentWorkspacePolicy;
  outcome: "success" | "failure" | "human-gate";
}): boolean {
  if (input.outcome === "success") {
    return input.policy.cleanupOnSuccess;
  }

  if (input.outcome === "failure") {
    return !input.policy.preserveOnFailure;
  }

  return !input.policy.preserveOnHumanGate;
}

export function buildWorkspaceAllocateInput(input: {
  policy: DevelopmentWorkspacePolicy;
  plan: DevelopmentSlicePlan;
  slice?: DevelopmentSliceInput;
  parentWorkspaceId?: string;
}): z.infer<typeof WorkspaceAllocateInputSchema> {
  if (!input.policy.sourceRepoPath || !input.policy.workspaceRoot) {
    throw new Error("Workspace allocation requires workspacePolicy.sourceRepoPath and workspacePolicy.workspaceRoot.");
  }

  return WorkspaceAllocateInputSchema.parse({
    provider: input.policy.provider,
    repo: input.plan.repo,
    sourceRepoPath: input.policy.sourceRepoPath,
    workspaceRoot: input.policy.workspaceRoot,
    initiative: input.plan.initiative,
    sliceId: input.slice?.id,
    baseBranch: input.plan.baseBranch,
    workingBranch: input.plan.workingBranch,
    parentWorkspaceId: input.parentWorkspaceId,
    metadata: {
      workspaceMode: input.policy.mode,
      ...(input.slice ? { sliceId: input.slice.id } : {}),
    },
  });
}

export function createPrAgent(options: {
  name?: string;
  description?: string;
  githubRunner?: GithubPrRunner;
  localMergeRunner?: LocalMergeFinalizationRunner;
} = {}) {
  const githubTool = options.githubRunner ? createGithubPrUpsertTool(options.githubRunner) : undefined;
  const localMergeTool = createLocalMergeFinalizationTool(options.localMergeRunner ?? createGitLocalMergeFinalizationRunner());
  const tools = githubTool ? [localMergeTool, githubTool] : [localMergeTool];

  return agent({
    name: options.name ?? "weave.prAgent",
    description: options.description ?? "Creates a durable PR draft and stops for human review before merge.",
    input: PrDraftInputSchema,
    output: PrDraftResultSchema,
    tools,
    async run(ctx, rawInput) {
      const input = PrDraftInputSchema.parse(rawInput);
      const draft = await ctx.checkpoint(DevelopmentCheckpointKeys.prDraft, () => buildPrDraft(input));
      const localHandoff = await ctx.checkpoint(DevelopmentCheckpointKeys.prHandoff, () =>
        buildPrHandoffArtifact({ prInput: input, draft, remoteApproved: false }),
      );
      let prUrl = draft.prUrl;

      const localDraft = PrDraftResultSchema.parse({ ...draft, handoffArtifact: localHandoff });
      await ctx.emit(
        "pr-ready-for-review",
        developmentEvents.prReadyForReview({
          branch: input.branch,
          url: prUrl,
          summary: `PR handoff ready for ${input.initiative}.`,
          shippedSlices: localDraft.shippedSlices,
        }),
      );

      const gate = await ctx.gate("pr-review-approval", {
        reason: "pr-review-approval",
        proposedAction: input.finalization.mode === "local-merge"
          ? `Approve local merge of ${input.branch} into ${input.baseBranch} after reviewing the handoff.`
          : input.github.mode === "none"
          ? "Review the local PR handoff before merge. This agent cannot merge the PR."
          : `Approve remote ${input.github.mode === "create" ? "draft PR creation" : "PR update"} for ${input.branch}.`,
      });

      if (gate.resolution !== "approved") {
        return PrDraftResultSchema.parse({ ...localDraft, humanApproval: gate.resolution });
      }

      let finalizationResult = FinalizationResultSchema.parse({
        status: "not-requested",
        mode: "none",
        summary: "Local handoff only; no final Git side effect requested.",
      });
      if (input.finalization.mode === "local-merge") {
        const missingCheckpoints = input.shippedSlices.filter((slice) => !slice.sourceCheckpoint).map((slice) => slice.sliceId);
        if (missingCheckpoints.length > 0 || !input.finalization.repoRoot) {
          const blockedReason = missingCheckpoints.length > 0
            ? `Missing source checkpoints for slices: ${missingCheckpoints.join(", ")}.`
            : "Local merge finalization requires finalization.repoRoot.";
          const blockedFinalizationResult = FinalizationResultSchema.parse({
            status: "blocked",
            mode: "local-merge",
            repoRoot: input.finalization.repoRoot,
            baseBranch: input.baseBranch,
            branch: input.branch,
            strategy: input.finalization.strategy,
            reason: blockedReason,
            summary: "Local merge finalization blocked before Git side effects.",
          });
          finalizationResult = await ctx.checkpoint(DevelopmentCheckpointKeys.finalizationResult, () =>
            blockedFinalizationResult,
          );
          await ctx.gate("finalization-stop", {
            reason: "finalization-stop",
            proposedAction: blockedReason,
          });
          return PrDraftResultSchema.parse({ ...localDraft, humanApproval: gate.resolution, finalization: finalizationResult });
        }

        const mergeResult = await ctx.tool("local-merge-finalization", localMergeTool, {
          repo: input.repo,
          repoRoot: input.finalization.repoRoot,
          baseBranch: input.baseBranch,
          branch: input.branch,
          strategy: input.finalization.strategy,
        });
        finalizationResult = await ctx.checkpoint(DevelopmentCheckpointKeys.finalizationResult, () => mergeResult);
        if (finalizationResult.status === "blocked") {
          await ctx.gate("finalization-stop", {
            reason: "finalization-stop",
            proposedAction: finalizationResult.reason,
          });
          return PrDraftResultSchema.parse({ ...localDraft, humanApproval: gate.resolution, finalization: finalizationResult });
        }
      }

      let remoteResult: GithubPrUpsertResult | undefined;
      if (input.github.mode !== "none" && githubTool) {
        const prResult = await ctx.tool("github-pr-upsert", githubTool, {
          repo: input.repo,
          title: draft.title,
          body: draft.body,
          baseBranch: input.baseBranch,
          branch: input.branch,
          existingUrl: input.prUrl,
          draft: input.github.draft,
        });
        remoteResult = prResult;
        prUrl = prResult.url ?? prUrl;

        if (prUrl) {
          await ctx.checkpoint(DevelopmentCheckpointKeys.prUrl, () => prUrl);
        }

        if (prResult.status === "created" && prUrl) {
          await ctx.emit(
            "pr-opened",
            developmentEvents.prOpened({ branch: input.branch, url: prUrl, title: draft.title }),
          );
        }

        if (prResult.status === "updated" && prUrl) {
          await ctx.emit(
            "pr-updated",
            developmentEvents.prUpdated({ branch: input.branch, url: prUrl, summary: prResult.summary }),
          );
        }
      }

      const remoteHandoff = await ctx.checkpoint(DevelopmentCheckpointKeys.prRemoteHandoff, () =>
        buildPrHandoffArtifact({
          prInput: input,
          draft: PrDraftResultSchema.parse({ ...draft, prUrl }),
          remoteApproved: true,
          finalizationResult,
          remoteResult: remoteResult ?? (input.github.mode === "none" ? { status: "skipped", summary: "Remote PR creation not requested." } : undefined),
        }),
      );

      return PrDraftResultSchema.parse({ ...draft, prUrl, humanApproval: gate.resolution, handoffArtifact: remoteHandoff, finalization: finalizationResult });
    },
  });
}

export function createReviewerAgent(options: {
  name?: string;
  description?: string;
  reviewer: DevelopmentReviewerRole;
  runner: ReviewerRunner;
}) {
  const reviewerTool = createReviewerTool(options.runner);

  return agent({
    name: options.name ?? `weave.${options.reviewer}`,
    description: options.description ?? `Runs read-only ${options.reviewer} review for one development slice workspace.`,
    input: ReviewerAgentInputSchema,
    output: ReviewResultSchema,
    tools: [reviewerTool],
    async run(ctx, rawInput) {
      const input = ReviewerAgentInputSchema.parse({ ...rawInput, reviewer: options.reviewer });
      const result = await ctx.tool("run-review", reviewerTool, input);
      const checkpointed = await ctx.checkpoint(`${DevelopmentCheckpointKeys.reviewFindings}:${options.reviewer}`, () => result);
      await ctx.emit(
        `review-completed:${input.slice.id}:${options.reviewer}`,
        developmentEvents.reviewCompleted({
          sliceId: input.slice.id,
          reviewer: options.reviewer,
          verdict: checkpointed.verdict,
          findings: checkpointed.findings,
        }),
      );
      return checkpointed;
    },
  });
}

export function createOpenCodeImplementerAgent(options: {
  name?: string;
  description?: string;
  runner: OpenCodeImplementationRunner;
}) {
  const implementationTool = createOpenCodeImplementationTool(options.runner);

  return agent({
    name: options.name ?? "weave.opencodeImplementer",
    description: options.description ?? "Runs OpenCode for one bounded implementation slice inside a configured workspace.",
    input: OpenCodeImplementerInputSchema,
    output: OpenCodeImplementerOutputSchema,
    tools: [implementationTool],
    async run(ctx, rawInput) {
      const input = OpenCodeImplementerInputSchema.parse(rawInput);
      const blocked = evaluateOpenCodeImplementerInput(input);
      if (blocked) {
        return blocked;
      }

      await ctx.emit(
        `implementation-started:${input.workspaceRef.workspaceId}`,
        developmentEvents.implementationStarted({
          sliceId: input.sliceId ?? input.sliceTitle,
          branch: input.branch,
          agentName: ctx.actor.id,
        }),
      );

      const implementationResult = await ctx.tool("run-opencode-implementation", implementationTool, input);
      if (implementationResult.status === "blocked") {
        return implementationResult;
      }

      const claimedSummary = implementationResult.summary;
      const outOfScopeFiles = outOfScopeImplementationFiles(input, claimedSummary);
      if (outOfScopeFiles.length > 0) {
        return OpenCodeImplementerOutputSchema.parse({
          status: "blocked",
          branch: input.branch,
          workspaceRef: input.workspaceRef,
          reason: `OpenCode changed files outside allowed scope: ${outOfScopeFiles.join(", ")}.`,
        });
      }

      const summary = await ctx.checkpoint(DevelopmentCheckpointKeys.implementationSummary, () => claimedSummary);

      await ctx.emit(
        `implementation-completed:${input.workspaceRef.workspaceId}`,
        developmentEvents.implementationCompleted({
          sliceId: input.sliceId ?? input.sliceTitle,
          branch: input.branch,
          summary: summary.summary,
          filesChanged: summary.filesChanged,
          testsAdded: summary.testsAdded,
          knownLimitations: summary.knownLimitations,
        }),
      );

      return OpenCodeImplementerOutputSchema.parse({
        status: "completed",
        branch: input.branch,
        workspaceRef: input.workspaceRef,
        summary,
      });
    },
  });
}

function renderPrDraftBody(input: {
  title: string;
  baseBranch: string;
  branch: string;
  slices: readonly CompletedDevelopmentSliceSummary[];
  changedBehavior: readonly string[];
  filesChanged: readonly string[];
  docsChanged: readonly string[];
  tests: readonly z.infer<typeof DevCommandResultSchema>[];
  reviewerVerdicts: readonly ReviewResult[];
  repairAttempts: number;
  knownLimitations: readonly string[];
  followUps: readonly string[];
}): string {
  const lines = [
    `## Summary`,
    "",
    `${input.title} is ready for review from \`${input.branch}\` into \`${input.baseBranch}\`.`,
    "",
    "## Shipped Slices",
    "",
    ...input.slices.map((slice) => `- \`${slice.sliceId}\` ${slice.title}: ${slice.summary}`),
    "",
    "## Changed Behavior",
    "",
    ...markdownList(input.changedBehavior, "No externally visible behavior changes were reported."),
    "",
    "## Files Changed",
    "",
    ...markdownList(input.filesChanged.map((file) => `\`${file}\``), "No changed files were reported."),
    "",
    "## Docs Updated",
    "",
    ...markdownList(input.docsChanged.map((file) => `\`${file}\``), "No documentation updates were reported."),
    "",
    "## Verification",
    "",
    ...input.tests.map((command) => `- \`${command.command}\` ${command.status} (${command.exitCode}) - ${command.summary ?? "no summary"}`),
    "",
    "## Review Verdicts",
    "",
    ...input.reviewerVerdicts.map((review) => `- ${review.reviewer}: ${review.verdict}${review.summary ? ` - ${review.summary}` : ""}`),
    "",
    "## Repair Attempts",
    "",
    `- ${input.repairAttempts} repair attempt${input.repairAttempts === 1 ? "" : "s"} performed.`,
    "",
    "## Known Limitations",
    "",
    ...markdownList(input.knownLimitations, "No known limitations reported."),
    "",
    "## Follow-Ups",
    "",
    ...markdownList(input.followUps, "No follow-ups reported."),
    "",
    "## Human Approval Checklist",
    "",
    "- [ ] Review shipped slice summaries.",
    "- [ ] Confirm verification output is acceptable.",
    "- [ ] Confirm reviewer verdicts are acceptable.",
    "- [ ] Decide whether to merge outside this agent.",
  ];

  return lines.join("\n");
}

function markdownList(values: readonly string[], emptyText: string): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : [`- ${emptyText}`];
}

function extractSliceSections(markdown: string): Array<{ title: string; body: string }> {
  const lines = markdown.split(/\r?\n/);
  const headings = lines
    .map((line, index) => ({ line, index, match: /^(#{2,6})\s+(?:slice\s*)?(\d+)?[:.)\-\s]*(.+)$/i.exec(line.trim()) }))
    .filter((entry): entry is { line: string; index: number; match: RegExpExecArray } => Boolean(entry.match))
    .filter((entry) => /\bslice\b/i.test(entry.line));

  return headings.map((heading, index) => {
    const next = headings[index + 1]?.index ?? lines.length;
    return {
      title: heading.match[3]?.trim() ?? `Slice ${index + 1}`,
      body: lines.slice(heading.index + 1, next).join("\n").trim(),
    };
  });
}

function normalizeSliceTitle(title: string): string {
  return title.replace(/^slice\s*\d*[:.)\-\s]*/i, "").trim() || "Development Slice";
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "slice";
}

function firstSentence(markdown: string): string | undefined {
  const paragraph = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("-") && !line.startsWith("*"));
  return paragraph?.replace(/\s+/g, " ").trim();
}

function extractAcceptanceCriteria(markdown: string, fallback: readonly string[], title: string): string[] {
  const criteriaSection = sectionAfterHeading(markdown, /acceptance criteria|acceptance/i);
  const bullets = extractBullets(criteriaSection ?? markdown);
  return bullets.length > 0 ? bullets : fallback.length > 0 ? [...fallback] : [`${title} is implemented and verified.`];
}

function sectionAfterHeading(markdown: string, headingPattern: RegExp): string | undefined {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{2,6}\s+/.test(line.trim()) && headingPattern.test(line));
  if (start === -1) {
    return undefined;
  }
  const end = lines.findIndex((line, index) => index > start && /^#{2,6}\s+/.test(line.trim()));
  return lines.slice(start + 1, end === -1 ? lines.length : end).join("\n");
}

function extractBullets(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => /^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.+)$/.exec(line)?.[1]?.trim())
    .filter((line): line is string => Boolean(line));
}

function extractBacktickPaths(markdown: string): string[] {
  const paths: string[] = [];
  for (const match of markdown.matchAll(/`([^`]+)`/g)) {
    const value = match[1]?.trim();
    if (value && /[/.]/.test(value) && !/\s/.test(value)) {
      paths.push(value);
    }
  }
  return paths;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

export function buildSourceCheckpointCommitMessage(slice: DevelopmentSliceInput): string {
  const title = slice.title.trim().replace(/\s+/g, " ");
  return `feat: complete ${title}`;
}

function parseGitStatusChangedFiles(output: string): string[] {
  return uniqueStrings(
    output
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .map((file) => file.split(" -> ").at(-1)?.trim() ?? file)
      .filter(Boolean),
  );
}

function pathMatchesAllowedFile(changedFile: string, allowedFile: string): boolean {
  const normalizedChanged = changedFile.replace(/^\.\//, "");
  const normalizedAllowed = allowedFile.replace(/^\.\//, "");
  return normalizedChanged === normalizedAllowed || (normalizedAllowed.endsWith("/") && normalizedChanged.startsWith(normalizedAllowed));
}

function completedSliceSummaryFromOutput(slice: DevelopmentSliceInput, output: Extract<SliceRunnerOutput, { status: "completed" }>): CompletedDevelopmentSliceSummary {
  return CompletedDevelopmentSliceSummarySchema.parse({
    sliceId: slice.id,
    title: slice.title,
    summary: output.summary,
    implementationSummary: output.implementationSummary,
    verificationResult: output.verificationResult,
    reviewResults: output.reviewResults,
    sourceCheckpoint: output.sourceCheckpoint,
    repairs: output.repairs,
    docsChanged: [],
    knownLimitations: [],
    followUps: [],
  });
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd });
  return String(stdout);
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWeaveMaintainerAgent(options: InitiativeRunnerAgentOptions = {}) {
  const workspaceAllocateTool = options.workspaceProvider ? createWorkspaceAllocateTool(options.workspaceProvider) : undefined;
  const workspaceRemoveTool = options.workspaceProvider ? createWorkspaceRemoveTool(options.workspaceProvider) : undefined;
  const tools = [developmentRepoContextReadTool, ...(workspaceAllocateTool ? [workspaceAllocateTool] : []), ...(workspaceRemoveTool ? [workspaceRemoveTool] : [])];

  return agent({
    name: "weave.maintainer",
    description: "Plans a Weave-managed development initiative and optionally coordinates approved slices serially.",
    input: DevelopmentInitiativeInputSchema,
    output: InitiativePlannerOutputSchema,
    tools,
    async run(ctx, rawInput) {
      const input = await ctx.checkpoint(DevelopmentCheckpointKeys.initiativeContext, () =>
        DevelopmentInitiativeInputSchema.parse(rawInput),
      );

      await ctx.emit(
        "initiative-started",
        developmentEvents.initiativeStarted({
          initiative: input.initiative,
          repo: input.repo,
          baseBranch: input.baseBranch,
          workingBranch: input.workingBranch,
          contextFiles: input.contextFiles,
        }),
      );

      const initiativeSpec = input.initiativeSpec
        ? await ctx.checkpoint(DevelopmentCheckpointKeys.initiativeSpec, () => input.initiativeSpec)
        : undefined;

      if (initiativeSpec) {
        await ctx.emit(
          "initiative-spec-received",
          developmentEvents.initiativeSpecReceived({
            title: initiativeSpec.title,
            source: initiativeSpec.source,
            summary: initiativeSpec.summary,
            goals: initiativeSpec.goals,
            acceptanceCriteria: initiativeSpec.acceptanceCriteria,
            contextFiles: initiativeSpec.contextFiles,
          }),
        );
      }

      const context = await ctx.tool("read-repo-context", developmentRepoContextReadTool, {
        repo: input.repo,
        contextFiles: input.contextFiles,
        maxFileBytes: 64_000,
        maxTotalBytes: 256_000,
      });

      const repoContext = await ctx.checkpoint(DevelopmentCheckpointKeys.repoContext, () => context);

      const plan = await ctx.checkpoint(DevelopmentCheckpointKeys.slicePlan, async () => {
        if (input.slices?.length) {
          return buildDevelopmentSlicePlan(input);
        }

        if (!initiativeSpec || !options.planCompiler) {
          return buildDevelopmentSlicePlan(input);
        }

        return compileInitiativePlan(
          {
            spec: initiativeSpec,
            repo: input.repo,
            baseBranch: input.baseBranch,
            workingBranch: input.workingBranch,
            contextFiles: input.contextFiles,
            repoContext,
          },
          options.planCompiler,
        );
      });

      const proposedPlan = await ctx.checkpoint(DevelopmentCheckpointKeys.proposedInitiativePlan, () => plan);

      await ctx.emit(
        "initiative-plan-proposed",
        developmentEvents.initiativePlanProposed({
          initiative: proposedPlan.initiative,
          repo: proposedPlan.repo,
          workingBranch: proposedPlan.workingBranch,
          revision: proposedPlan.revision,
          sliceCount: proposedPlan.slices.length,
          summary: proposedPlan.summary,
        }),
      );

      for (const slice of proposedPlan.slices) {
        await ctx.emit(
          `slice-proposed:${slice.id}`,
          developmentEvents.sliceProposed({
            sliceId: slice.id,
            title: slice.title,
            objective: slice.objective,
            acceptanceCriteria: slice.acceptanceCriteria,
            requiredReviewers: slice.requiredReviewers,
          }),
        );
      }

      const gate = await ctx.gate("approve-slice-plan", {
        reason: "slice-plan-approval",
        proposedAction: `Approve ${proposedPlan.slices.length} slice${proposedPlan.slices.length === 1 ? "" : "s"} for ${proposedPlan.initiative}.`,
      });

      if (gate.resolution !== "approved") {
        const decision = await ctx.checkpoint(DevelopmentCheckpointKeys.latestPlanDecision, () =>
          InitiativePlanDecisionSchema.parse({ status: "rejected", decidedBy: ctx.actor.id, note: gate.comment }),
        );
        await ctx.emit(
          "initiative-plan-rejected",
          developmentEvents.initiativePlanRejected({
            initiative: proposedPlan.initiative,
            revision: proposedPlan.revision,
            rejectedBy: decision.decidedBy,
            reason: decision.note ?? "Slice plan gate denied.",
          }),
        );
        return InitiativePlannerOutputSchema.parse({
          status: "denied",
          plan: InitiativePlanSchema.parse({ ...proposedPlan, status: "rejected", decision }),
          contextFilesRead: input.contextFiles,
          repoContext,
          proposedEventCount: proposedPlan.slices.length,
          gateComment: gate.comment,
        });
      }

      const approvalDecision = await ctx.checkpoint(DevelopmentCheckpointKeys.latestPlanDecision, () =>
        InitiativePlanDecisionSchema.parse({ status: "approved", decidedBy: ctx.actor.id, note: gate.comment }),
      );
      const approvedPlan = await ctx.checkpoint(DevelopmentCheckpointKeys.approvedSlicePlan, () =>
        InitiativePlanSchema.parse({ ...proposedPlan, status: "approved", decision: approvalDecision }),
      );
      await ctx.checkpoint(DevelopmentCheckpointKeys.approvedInitiativePlan, () => approvedPlan);
      await ctx.emit(
        "initiative-plan-approved",
        developmentEvents.initiativePlanApproved({
          initiative: approvedPlan.initiative,
          revision: approvedPlan.revision,
          approvedBy: approvalDecision.decidedBy,
          sliceCount: approvedPlan.slices.length,
          summary: approvedPlan.summary,
        }),
      );

      for (const slice of approvedPlan.slices) {
        await ctx.emit(
          `slice-approved:${slice.id}`,
          developmentEvents.sliceApproved({
            sliceId: slice.id,
            title: slice.title,
            approvedBy: ctx.actor.id,
          }),
        );
      }

      if (!options.sliceRunnerAgent) {
        return InitiativePlannerOutputSchema.parse({
          status: "approved",
          plan: approvedPlan,
          contextFilesRead: input.contextFiles,
          repoContext,
          proposedEventCount: approvedPlan.slices.length,
          gateComment: gate.comment,
        });
      }

      const workspacePolicy = await ctx.checkpoint("workspace-policy", () => input.workspacePolicy);
      const workspaceRefs: WorkspaceRef[] = [];
      const workspaceCleanup: WorkspaceRemovalResult[] = [];
      let initiativeWorkspaceRef = input.workspaceRef;
      if (initiativeWorkspaceRef) {
        workspaceRefs.push(initiativeWorkspaceRef);
      }

      if (workspacePolicy.mode === "initiative" && !initiativeWorkspaceRef && workspaceAllocateTool) {
        const allocated = await ctx.tool(
          "workspace-allocate:initiative",
          workspaceAllocateTool,
          buildWorkspaceAllocateInput({ policy: workspacePolicy, plan: approvedPlan }),
        );
        initiativeWorkspaceRef = await ctx.checkpoint(`${DevelopmentCheckpointKeys.workspaceRef}:initiative`, () => allocated);
        workspaceRefs.push(initiativeWorkspaceRef);
      }

      const completedSlices: CompletedDevelopmentSliceSummary[] = [];
      for (const [index, slice] of approvedPlan.slices.entries()) {
        const state = createInitialInitiativeExecutionState({ plan: approvedPlan, completedSlices });
        const action = decideNextInitiativeAction(state);
        if (action.type !== "run-slice") {
          break;
        }

        let sliceWorkspaceRef = workspacePolicy.mode === "initiative" ? initiativeWorkspaceRef : input.workspaceRef;
        if (workspacePolicy.mode === "slice" && workspaceAllocateTool) {
          const allocated = await ctx.tool(
            `workspace-allocate:${slice.id}`,
            workspaceAllocateTool,
            buildWorkspaceAllocateInput({
              policy: workspacePolicy,
              plan: approvedPlan,
              slice,
              parentWorkspaceId: initiativeWorkspaceRef?.workspaceId,
            }),
          );
          sliceWorkspaceRef = await ctx.checkpoint(`${DevelopmentCheckpointKeys.workspaceRef}:${slice.id}`, () => allocated);
          workspaceRefs.push(sliceWorkspaceRef);
        }

        const sliceThread = await ctx.spawn(
          `slice:${slice.id}`,
          options.sliceRunnerAgent,
          {
            initiative: approvedPlan.initiative,
            initiativeThreadId: ctx.threadId,
            repo: approvedPlan.repo,
            branch: approvedPlan.workingBranch,
            slice,
            workspaceRef: sliceWorkspaceRef,
            workspacePolicy,
            maxRepairAttempts: 1,
          },
          { source: "system", prompt: `Run development slice ${slice.id}: ${slice.title}` },
        );
        const sliceRun = await ctx.join(`wait-slice:${slice.id}`, sliceThread);
        if (sliceRun.status === "failed" || !sliceRun.output) {
          return InitiativePlannerOutputSchema.parse({
            status: "blocked",
            plan: approvedPlan,
            contextFilesRead: input.contextFiles,
            repoContext,
            proposedEventCount: approvedPlan.slices.length,
            gateComment: gate.comment,
            completedSlices,
            blockedSlice: slice.id,
            blockerReason: `Slice child failed: ${sliceRun.status === "failed" ? sliceRun.message : "missing output"}.`,
            workspacePolicy,
            workspaceRefs,
            workspaceCleanup,
          });
        }

        if (sliceRun.output.status !== "completed") {
          return InitiativePlannerOutputSchema.parse({
            status: "blocked",
            plan: approvedPlan,
            contextFilesRead: input.contextFiles,
            repoContext,
            proposedEventCount: approvedPlan.slices.length,
            gateComment: gate.comment,
            completedSlices,
            blockedSlice: slice.id,
            blockerReason: "reason" in sliceRun.output ? sliceRun.output.reason : `Slice ${slice.id} did not complete.`,
            workspacePolicy,
            workspaceRefs,
            workspaceCleanup,
          });
        }

        completedSlices.push(completedSliceSummaryFromOutput(slice, sliceRun.output));
        await ctx.checkpoint(`initiative-slice-completed:${slice.id}`, () => ({ sliceId: slice.id, index }));

        if (workspacePolicy.mode === "slice" && sliceWorkspaceRef && workspaceRemoveTool && workspacePolicy.workspaceRoot && shouldCleanupWorkspace({ policy: workspacePolicy, outcome: "success" })) {
          const cleanup = await ctx.tool(`workspace-remove:${slice.id}`, workspaceRemoveTool, {
            ref: sliceWorkspaceRef,
            workspaceRoot: workspacePolicy.workspaceRoot,
            requireClean: workspacePolicy.requireCleanOnCleanup,
            force: workspacePolicy.forceCleanup,
          });
          workspaceCleanup.push(cleanup);
        }
      }

      let prDraft: PrDraftResult | undefined;
      if (options.prAgent) {
        const finalization = FinalizationConfigSchema.parse(options.finalization ?? { mode: "none" });
        const prInput = PrDraftInputSchema.parse({
          initiative: approvedPlan.initiative,
          repo: approvedPlan.repo,
          baseBranch: approvedPlan.baseBranch,
          branch: approvedPlan.workingBranch,
          shippedSlices: completedSlices,
          github: options.github ?? { mode: "none", draft: true },
          finalization: finalization.mode === "local-merge" && !finalization.repoRoot && workspacePolicy.sourceRepoPath
            ? { ...finalization, repoRoot: workspacePolicy.sourceRepoPath }
            : finalization,
        });
        const prThread = await ctx.spawn("pr-draft", options.prAgent, prInput, {
          source: "system",
          prompt: `Draft PR handoff for ${approvedPlan.initiative}.`,
        });
        const prRun = await ctx.join("wait-pr-draft", prThread);
        if (prRun.status === "failed" || !prRun.output) {
          return InitiativePlannerOutputSchema.parse({
            status: "blocked",
            plan: approvedPlan,
            contextFilesRead: input.contextFiles,
            repoContext,
            proposedEventCount: approvedPlan.slices.length,
            gateComment: gate.comment,
            completedSlices,
            blockerReason: `PR draft child failed: ${prRun.status === "failed" ? prRun.message : "missing output"}.`,
            workspacePolicy,
            workspaceRefs,
            workspaceCleanup,
          });
        }
        prDraft = prRun.output;
      }

      if (workspacePolicy.mode === "initiative" && initiativeWorkspaceRef && workspaceRemoveTool && workspacePolicy.workspaceRoot && shouldCleanupWorkspace({ policy: workspacePolicy, outcome: "success" })) {
        const cleanup = await ctx.tool("workspace-remove:initiative", workspaceRemoveTool, {
          ref: initiativeWorkspaceRef,
          workspaceRoot: workspacePolicy.workspaceRoot,
          requireClean: workspacePolicy.requireCleanOnCleanup,
          force: workspacePolicy.forceCleanup,
        });
        workspaceCleanup.push(cleanup);
      }

      return InitiativePlannerOutputSchema.parse({
        status: "completed",
        plan: approvedPlan,
        contextFilesRead: input.contextFiles,
        repoContext,
        proposedEventCount: approvedPlan.slices.length,
        gateComment: gate.comment,
        completedSlices,
        prDraft,
        workspacePolicy,
        workspaceRefs,
        workspaceCleanup,
      });
    },
  });
}

export const weaveMaintainer = createWeaveMaintainerAgent();

export function createSliceRunnerAgent(options: SliceRunnerAgentOptions = {}) {
  const sourceCheckpointTool = createSourceCheckpointTool(options.sourceCheckpointRunner ?? createGitSourceCheckpointRunner());

  return agent({
    name: "weave.sliceRunner",
    description: "Coordinates one approved development slice through implementation, verification, review, and bounded repair.",
    input: SliceRunnerInputSchema,
    output: SliceRunnerOutputSchema,
    tools: [developmentBranchStateReadTool, sourceCheckpointTool],
    async run(ctx, rawInput) {
      const input = SliceRunnerInputSchema.parse(rawInput);
      const workingBranch = await ctx.checkpoint(DevelopmentCheckpointKeys.workingBranch, () => input.branch);
      const branchState = await ctx.tool("read-branch-state", developmentBranchStateReadTool, {
        repo: input.repo,
        repoRoot: input.workspaceRef?.path,
      });
      const branchDecision = evaluateSliceBranchState({ ...input, branch: workingBranch }, branchState);

      if (branchDecision.status === "blocked") {
        return branchDecision;
      }

      await ctx.emit(
        `slice-started:${input.slice.id}`,
        developmentEvents.sliceStarted({
          sliceId: input.slice.id,
          title: input.slice.title,
          branch: workingBranch,
        }),
      );

      if (!options.implementationAgent || !options.verificationAgent || !options.reviewerAgents) {
        return branchDecision;
      }

      let state = createInitialSliceExecutionState({ ...input, branch: workingBranch, workspaceRef: branchDecision.workspaceRef });
      let action = decideNextSliceAction(state);
      if (action.type === "allocate-workspace") {
        return await stopSliceForHuman(ctx, input, workingBranch, "WorkspaceRef is required before composed slice execution can start.", []);
      }

      const implementationThread = await ctx.spawn(
        "implement",
        options.implementationAgent,
        {
          sliceId: input.slice.id,
          sliceTitle: input.slice.title,
          objective: input.slice.objective,
          acceptanceCriteria: input.slice.acceptanceCriteria,
          allowedFiles: input.slice.allowedFiles,
          branch: workingBranch,
          workspaceRef: state.workspaceRef!,
          constraints: input.slice.constraints,
        },
        { source: "system", prompt: `Implement development slice ${input.slice.id}: ${input.slice.title}` },
      );
      const implementationRun = await ctx.join("wait-implement", implementationThread);
      if (implementationRun.status === "failed" || !implementationRun.output) {
        return await failSlice(
          ctx,
          input,
          workingBranch,
          `Implementation child failed: ${implementationRun.status === "failed" ? implementationRun.message : "missing output"}.`,
          [],
          state.workspaceRef,
        );
      }
      state = SliceExecutionStateSchema.parse({ ...state, phase: "implementation-completed", implementation: implementationRun.output });
      action = decideNextSliceAction(state);
      if (action.type === "fail-slice") {
        return await failSlice(ctx, input, workingBranch, action.reason, action.findings, state.workspaceRef);
      }

      while (true) {
        action = decideNextSliceAction(state);

        if (action.type === "complete-slice") {
          return await completeSlice(ctx, input, workingBranch, action.summary, state);
        }

        if (action.type === "fail-slice") {
          return await failSlice(ctx, input, workingBranch, action.reason, action.findings, state.workspaceRef);
        }

        if (action.type === "require-human-stop") {
          return await stopSliceForHuman(ctx, input, workingBranch, action.reason, action.findings, state.workspaceRef);
        }

        if (action.type === "create-source-checkpoint") {
          if (!state.workspaceRef || !state.verification) {
            return await failSlice(ctx, input, workingBranch, "Source checkpoint state is incomplete.", state.blockers, state.workspaceRef);
          }

          const checkpointInput = SourceCheckpointCreateInputSchema.parse({
            initiativeThreadId: input.initiativeThreadId ?? ctx.threadId,
            sliceThreadId: ctx.threadId,
            sliceId: input.slice.id,
            title: input.slice.title,
            workspaceRef: state.workspaceRef,
            commitMessage: buildSourceCheckpointCommitMessage(input.slice),
            verificationSummary: {
              status: state.verification.status,
              commands: state.verification.commands,
            },
            reviewSummary: state.reviews.map((review) => ({
              reviewer: review.reviewer,
              verdict: review.verdict,
              findingCount: review.findings.length,
            })),
          });

          const checkpointResult = await ctx.tool(`create-source-checkpoint:${input.slice.id}`, sourceCheckpointTool, checkpointInput);
          if (checkpointResult.status === "failed") {
            await ctx.emit(`source-checkpoint-failed:${input.slice.id}`, developmentEvents.sourceCheckpointFailed(checkpointResult));
            await ctx.gate("source-checkpoint-stop", {
              reason: "source-checkpoint-stop",
              proposedAction: `Source checkpoint failed for ${input.slice.id}: ${checkpointResult.reason}`,
            });
            return SliceRunnerOutputSchema.parse({
              status: "blocked",
              sliceId: input.slice.id,
              branch: workingBranch,
              reason: checkpointResult.reason,
              workspaceRef: state.workspaceRef,
              findings: [],
            });
          }

          const checkpoint = await ctx.checkpoint(`${DevelopmentCheckpointKeys.sourceCheckpoint}:${input.slice.id}`, () =>
            SourceCheckpointSchema.parse(checkpointResult),
          );
          await ctx.emit(`source-checkpoint-created:${input.slice.id}`, developmentEvents.sourceCheckpointCreated(checkpoint));
          state = SliceExecutionStateSchema.parse({ ...state, phase: "source-checkpoint-running", sourceCheckpoint: checkpoint });
          continue;
        }

        if (action.type === "run-verification") {
          const verificationThread = await ctx.spawn(
            `verify:${action.attempt}`,
            options.verificationAgent,
            {
              sliceId: input.slice.id,
              branch: workingBranch,
              workspaceRef: state.workspaceRef!,
            },
            { source: "system", prompt: `Verify development slice ${input.slice.id} attempt ${action.attempt}.` },
          );
          const verificationRun = await ctx.join(`wait-verify:${action.attempt}`, verificationThread);
          if (verificationRun.status === "failed" || !verificationRun.output) {
            return await failSlice(
              ctx,
              input,
              workingBranch,
              `Verification child failed: ${verificationRun.status === "failed" ? verificationRun.message : "missing output"}.`,
              [],
              state.workspaceRef,
            );
          }
          state = SliceExecutionStateSchema.parse({ ...state, phase: "verification-completed", verification: verificationRun.output, reviews: [] });
          continue;
        }

        if (action.type === "run-reviewers") {
          const reviewResults: ReviewResult[] = [...state.reviews];
          for (const reviewer of action.reviewers) {
            const reviewerAgent = options.reviewerAgents[reviewer];
            if (!reviewerAgent) {
              return await failSlice(ctx, input, workingBranch, `Missing reviewer agent for ${reviewer}.`, [], state.workspaceRef);
            }
            const reviewThread = await ctx.spawn(
              `review:${reviewer}:${action.attempt}`,
              reviewerAgent,
              {
                slice: input.slice,
                branch: workingBranch,
                workspaceRef: state.workspaceRef!,
                reviewer,
                implementationSummary: state.implementation?.status === "completed" ? state.implementation.summary : undefined,
                verificationResult: state.verification,
              },
              { source: "system", prompt: `Review development slice ${input.slice.id} as ${reviewer}.` },
            );
            const reviewRun = await ctx.join(`wait-review:${reviewer}:${action.attempt}`, reviewThread);
            if (reviewRun.status === "failed" || !reviewRun.output) {
              return await failSlice(
                ctx,
                input,
                workingBranch,
                `Reviewer child ${reviewer} failed: ${reviewRun.status === "failed" ? reviewRun.message : "missing output"}.`,
                [],
                state.workspaceRef,
              );
            }
            reviewResults.push(reviewRun.output);
          }
          state = SliceExecutionStateSchema.parse({ ...state, phase: "review-completed", reviews: reviewResults });
          continue;
        }

        if (action.type === "run-repair") {
          if (!options.repairAgent) {
            return await stopSliceForHuman(ctx, input, workingBranch, "Repair is required but no repair agent is configured.", action.findings, state.workspaceRef);
          }
          const repairThread = await ctx.spawn(
            repairAttemptKey(action.attempt),
            options.repairAgent,
            {
              branch: workingBranch,
              workspaceRef: state.workspaceRef!,
              slice: input.slice,
              attempt: action.attempt,
              maxAttempts: input.maxRepairAttempts,
              failingCommands: state.verification?.status === "passed" ? [] : state.verification?.commands ?? [],
              findings: action.findings,
            },
            { source: "system", prompt: `Repair development slice ${input.slice.id} attempt ${action.attempt}.` },
          );
          const repairRun = await ctx.join(`wait-repair:${action.attempt}`, repairThread);
          if (repairRun.status === "failed" || !repairRun.output) {
            return await failSlice(
              ctx,
              input,
              workingBranch,
              `Repair child failed: ${repairRun.status === "failed" ? repairRun.message : "missing output"}.`,
              action.findings,
              state.workspaceRef,
            );
          }
          if (repairRun.output.status !== "completed") {
            return await stopSliceForHuman(ctx, input, workingBranch, repairRun.output.summary, action.findings, state.workspaceRef);
          }
          state = SliceExecutionStateSchema.parse({
            ...state,
            phase: "repair-completed",
            verification: undefined,
            reviews: [],
            repairs: [...state.repairs, repairRun.output],
            repairAttempts: state.repairs.length + 1,
          });
          continue;
        }

        return await failSlice(ctx, input, workingBranch, `Unsupported slice action: ${action.type}.`, [], state.workspaceRef);
      }
    },
  });
}

export const weaveSliceRunner = createSliceRunnerAgent();

async function completeSlice(
  ctx: AgentContext,
  input: SliceRunnerInput,
  branch: string,
  summary: string,
  state: SliceExecutionState,
): Promise<SliceRunnerOutput> {
  if (!state.workspaceRef || !state.implementation || state.implementation.status !== "completed" || !state.verification || !state.sourceCheckpoint) {
    return failSlice(ctx, input, branch, "Slice completion state is incomplete.", state.blockers, state.workspaceRef);
  }

  await ctx.emit(
    `slice-completed:${input.slice.id}`,
    developmentEvents.sliceCompleted({
      sliceId: input.slice.id,
      title: input.slice.title,
      branch,
      summary,
      testsPassed: state.verification.status === "passed",
      reviewVerdicts: state.reviews.map((review) => review.verdict),
    }),
  );

  return SliceRunnerOutputSchema.parse({
    status: "completed",
    sliceId: input.slice.id,
    branch,
    workspaceRef: state.workspaceRef,
    implementationSummary: state.implementation.summary,
    verificationResult: state.verification,
    reviewResults: state.reviews,
    sourceCheckpoint: state.sourceCheckpoint,
    repairs: state.repairs,
    summary,
  });
}

async function failSlice(
  ctx: AgentContext,
  input: SliceRunnerInput,
  branch: string,
  reason: string,
  findings: DevReviewFinding[] = [],
  workspaceRef?: z.infer<typeof WorkspaceRefSchema>,
): Promise<SliceRunnerOutput> {
  await ctx.emit(
    `slice-failed:${input.slice.id}`,
    developmentEvents.sliceFailed({
      sliceId: input.slice.id,
      title: input.slice.title,
      branch,
      reason,
      findings,
    }),
  );

  return SliceRunnerOutputSchema.parse({
    status: "failed",
    sliceId: input.slice.id,
    branch,
    reason,
    findings,
    workspaceRef,
  });
}

async function stopSliceForHuman(
  ctx: AgentContext,
  input: SliceRunnerInput,
  branch: string,
  reason: string,
  findings: DevReviewFinding[] = [],
  workspaceRef?: z.infer<typeof WorkspaceRefSchema>,
): Promise<SliceRunnerOutput> {
  await ctx.gate("repair-stop", {
    reason: "repair-stop",
    proposedAction: reason,
  });

  return SliceRunnerOutputSchema.parse({
    status: "blocked",
    sliceId: input.slice.id,
    branch,
    reason,
    branchState: undefined,
    workspaceRef,
    findings,
  });
}

function highRiskReviewerFinding(reviews: readonly ReviewResult[]): DevReviewFinding | undefined {
  return reviews.flatMap((review) => review.findings).find((finding) => finding.severity === "high");
}
