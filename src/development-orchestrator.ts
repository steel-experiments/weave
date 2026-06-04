import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { agent, event, type AgentContext, type AgentContract } from "./agent-contract.js";
import { capability } from "./capability-contract.js";
import {
  DevImplementationCompletedPayloadSchema,
  DevImplementationStartedPayloadSchema,
  DevInitiativeStartedPayloadSchema,
  DevPrOpenedPayloadSchema,
  DevPrReadyForReviewPayloadSchema,
  DevPrUpdatedPayloadSchema,
  DevRepairCompletedPayloadSchema,
  DevRepairStartedPayloadSchema,
  DevReviewCompletedPayloadSchema,
  DevReviewFindingSchema,
  DevReviewVerdictSchema,
  DevSliceApprovedPayloadSchema,
  DevSliceCompletedPayloadSchema,
  DevSliceFailedPayloadSchema,
  DevSliceProposedPayloadSchema,
  DevSliceStartedPayloadSchema,
  DevVerificationCompletedPayloadSchema,
  DevCommandResultSchema,
  type DevReviewFinding,
} from "./events.js";
import { tool } from "./tool-contract.js";
import {
  WorkspaceRefSchema,
  WorkspaceAllocateInputSchema,
  createWorkspaceAllocateTool,
  createWorkspaceRemoveTool,
  workspaceDiffCapability,
  type WorkspaceProvider,
  type WorkspaceRef,
  type WorkspaceRemovalResult,
} from "./workspace-provider.js";

const NonEmptyStringSchema = z.string().min(1);
const execFileAsync = promisify(execFile);

export const DevelopmentCheckpointKeys = {
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
  prUrl: "pr-url",
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

export const DevelopmentSliceInputSchema = z.object({
  id: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  objective: NonEmptyStringSchema,
  acceptanceCriteria: z.array(NonEmptyStringSchema).min(1),
  allowedFiles: z.array(NonEmptyStringSchema).optional(),
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

export const DevelopmentInitiativeInputSchema = z.object({
  initiative: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  workingBranch: NonEmptyStringSchema,
  contextFiles: z.array(NonEmptyStringSchema).min(1),
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
  slices: z.array(DevelopmentSliceInputSchema).min(1),
  approvalRequired: z.literal(true),
  summary: NonEmptyStringSchema,
});
export type DevelopmentSlicePlan = z.infer<typeof DevelopmentSlicePlanSchema>;

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

export type OpenCodeImplementationRunner = {
  run(input: OpenCodeImplementerInput): Promise<ImplementationSummary> | ImplementationSummary;
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
  run(input: z.infer<typeof RepairAgentInputSchema>): Promise<RepairResult> | RepairResult;
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
};

export const CompletedDevelopmentSliceSummarySchema = z.object({
  sliceId: NonEmptyStringSchema,
  title: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  implementationSummary: ImplementationSummarySchema.optional(),
  verificationResult: VerificationResultSchema,
  reviewResults: z.array(ReviewResultSchema),
  repairs: z.array(RepairResultSchema).default([]),
  docsChanged: z.array(NonEmptyStringSchema).default([]),
  knownLimitations: z.array(NonEmptyStringSchema).default([]),
  followUps: z.array(NonEmptyStringSchema).default([]),
});
export type CompletedDevelopmentSliceSummary = z.infer<typeof CompletedDevelopmentSliceSummarySchema>;

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
});
export type PrDraftResult = z.infer<typeof PrDraftResultSchema>;

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
  sliceRunnerAgent?: AgentContract<string, any, SliceRunnerOutput>;
  prAgent?: AgentContract<string, any, PrDraftResult>;
  workspaceProvider?: WorkspaceProvider;
  github?: z.input<typeof PrDraftInputSchema>["github"];
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

export function createOpenCodeImplementationTool(runner: OpenCodeImplementationRunner) {
  return tool({
    name: "dev.opencode.implement",
    description: "Run OpenCode to implement one bounded development slice inside a configured workspace.",
    input: OpenCodeImplementerInputSchema,
    output: ImplementationSummarySchema,
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
      ];
    },
    summarize(output) {
      return output.summary;
    },
    async run(ctx) {
      const result = await runner.run(ctx.input);
      return ImplementationSummarySchema.parse(result);
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
      ];
    },
    summarize(output) {
      return output.summary;
    },
    async run(ctx) {
      const result = await runner.run(RepairAgentInputSchema.parse(ctx.input));
      return RepairResultSchema.parse(result);
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

export const developmentEvents = {
  initiativeStarted: event({
    type: "dev.initiative.started",
    payload: DevInitiativeStartedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "A development initiative thread started.",
  }),
  sliceProposed: event({
    type: "dev.slice.proposed",
    payload: DevSliceProposedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "A development slice was proposed for human approval.",
  }),
  sliceApproved: event({
    type: "dev.slice.approved",
    payload: DevSliceApprovedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "A development slice was approved for implementation.",
  }),
  sliceStarted: event({
    type: "dev.slice.started",
    payload: DevSliceStartedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "Implementation work started for one development slice.",
  }),
  sliceCompleted: event({
    type: "dev.slice.completed",
    payload: DevSliceCompletedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "A development slice passed required verification and review.",
  }),
  sliceFailed: event({
    type: "dev.slice.failed",
    payload: DevSliceFailedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "A development slice failed or stopped before completion.",
  }),
  implementationStarted: event({
    type: "dev.implementation.started",
    payload: DevImplementationStartedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "An OpenCode-backed implementation child thread started.",
  }),
  implementationCompleted: event({
    type: "dev.implementation.completed",
    payload: DevImplementationCompletedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "An OpenCode-backed implementation child thread returned its summary.",
  }),
  verificationCompleted: event({
    type: "dev.verification.completed",
    payload: DevVerificationCompletedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "Deterministic verification finished for a development slice.",
  }),
  reviewCompleted: event({
    type: "dev.review.completed",
    payload: DevReviewCompletedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "A read-only reviewer finished evaluating a development slice.",
  }),
  repairStarted: event({
    type: "dev.repair.started",
    payload: DevRepairStartedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "A bounded repair attempt started for a development slice.",
  }),
  repairCompleted: event({
    type: "dev.repair.completed",
    payload: DevRepairCompletedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "A bounded repair attempt completed for a development slice.",
  }),
  prOpened: event({
    type: "dev.pr.opened",
    payload: DevPrOpenedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "A development initiative PR was opened.",
  }),
  prUpdated: event({
    type: "dev.pr.updated",
    payload: DevPrUpdatedPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "A development initiative PR was updated.",
  }),
  prReadyForReview: event({
    type: "dev.pr.ready_for_review",
    payload: DevPrReadyForReviewPayloadSchema,
    visibility: "internal",
    version: 1,
    description: "A development initiative PR draft is ready for human review.",
  }),
} as const;

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
    return SliceActionSchema.parse({ type: "fail-slice", reason: state.implementation.reason, findings: [] });
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

      if (decision.status === "human-gate") {
        await ctx.gate("repair-stop", {
          reason: "repair-stop",
          proposedAction: decision.reason,
        });
        return RepairResultSchema.parse({
          status: "blocked",
          attempt: input.attempt,
          branch: input.branch,
          workspaceRef: input.workspaceRef,
          summary: decision.reason,
          limitations: ["Repair stopped for human decision."],
        });
      }

      await ctx.emit(
        `repair-started:${input.slice.id}:${decision.repairKey}`,
        developmentEvents.repairStarted({
          sliceId: input.slice.id,
          branch: input.branch,
          attempt: decision.attempt,
          findings: input.findings,
        }),
      );

      const repairResult = await ctx.tool(decision.repairKey, repairTool, input);
      await ctx.emit(
        `repair-completed:${input.slice.id}:${decision.repairKey}`,
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
} = {}) {
  const githubTool = options.githubRunner ? createGithubPrUpsertTool(options.githubRunner) : undefined;
  const tools = githubTool ? [githubTool] : [];

  return agent({
    name: options.name ?? "weave.prAgent",
    description: options.description ?? "Creates a durable PR draft and stops for human review before merge.",
    input: PrDraftInputSchema,
    output: PrDraftResultSchema,
    tools,
    async run(ctx, rawInput) {
      const input = PrDraftInputSchema.parse(rawInput);
      const draft = await ctx.checkpoint(DevelopmentCheckpointKeys.prDraft, () => buildPrDraft(input));
      let prUrl = draft.prUrl;

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

      const finalDraft = PrDraftResultSchema.parse({ ...draft, prUrl });
      await ctx.emit(
        "pr-ready-for-review",
        developmentEvents.prReadyForReview({
          branch: input.branch,
          url: prUrl,
          summary: `PR draft ready for ${input.initiative}.`,
          shippedSlices: finalDraft.shippedSlices,
        }),
      );

      const gate = await ctx.gate("pr-review-approval", {
        reason: "pr-review-approval",
        proposedAction: "Review the PR draft before merge. This agent cannot merge the PR.",
      });

      return PrDraftResultSchema.parse({ ...finalDraft, humanApproval: gate.resolution });
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

      const claimedSummary = await ctx.tool("run-opencode-implementation", implementationTool, input);
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
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

      const context = await ctx.tool("read-repo-context", developmentRepoContextReadTool, {
        repo: input.repo,
        contextFiles: input.contextFiles,
        maxFileBytes: 64_000,
        maxTotalBytes: 256_000,
      });

      const repoContext = await ctx.checkpoint(DevelopmentCheckpointKeys.repoContext, () => context);

      const plan = await ctx.checkpoint(DevelopmentCheckpointKeys.slicePlan, () => buildDevelopmentSlicePlan(input));

      for (const slice of plan.slices) {
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
        proposedAction: `Approve ${plan.slices.length} slice${plan.slices.length === 1 ? "" : "s"} for ${plan.initiative}.`,
      });

      if (gate.resolution !== "approved") {
        return InitiativePlannerOutputSchema.parse({
          status: "denied",
          plan,
          contextFilesRead: input.contextFiles,
          repoContext,
          proposedEventCount: plan.slices.length,
          gateComment: gate.comment,
        });
      }

      const approvedPlan = await ctx.checkpoint(DevelopmentCheckpointKeys.approvedSlicePlan, () => plan);

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
        const prInput = PrDraftInputSchema.parse({
          initiative: approvedPlan.initiative,
          repo: approvedPlan.repo,
          baseBranch: approvedPlan.baseBranch,
          branch: approvedPlan.workingBranch,
          shippedSlices: completedSlices,
          github: options.github ?? { mode: "none", draft: true },
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
  return agent({
    name: "weave.sliceRunner",
    description: "Coordinates one approved development slice through implementation, verification, review, and bounded repair.",
    input: SliceRunnerInputSchema,
    output: SliceRunnerOutputSchema,
    tools: [developmentBranchStateReadTool],
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
  if (!state.workspaceRef || !state.implementation || state.implementation.status !== "completed" || !state.verification) {
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
