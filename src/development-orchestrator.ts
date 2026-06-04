import { readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { agent, event } from "./agent-contract.js";
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
import { WorkspaceRefSchema, workspaceDiffCapability } from "./workspace-provider.js";

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

export const DevelopmentInitiativeInputSchema = z.object({
  initiative: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  workingBranch: NonEmptyStringSchema,
  contextFiles: z.array(NonEmptyStringSchema).min(1),
  slices: z.array(DevelopmentSliceInputSchema).optional(),
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
  status: z.enum(["approved", "denied"]),
  plan: DevelopmentSlicePlanSchema,
  contextFilesRead: z.array(NonEmptyStringSchema),
  repoContext: DevelopmentRepoContextSchema,
  proposedEventCount: z.number().int().nonnegative(),
  gateComment: NonEmptyStringSchema.optional(),
});
export type InitiativePlannerOutput = z.infer<typeof InitiativePlannerOutputSchema>;

export const SliceRunnerInputSchema = z.object({
  initiative: NonEmptyStringSchema,
  repo: NonEmptyStringSchema.default("weave"),
  branch: NonEmptyStringSchema,
  baseCommit: NonEmptyStringSchema.optional(),
  workspaceRef: WorkspaceRefSchema.optional(),
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

export const PrDraftResultSchema = z.object({
  title: NonEmptyStringSchema,
  branch: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  body: NonEmptyStringSchema,
  shippedSlices: z.array(NonEmptyStringSchema),
  tests: z.array(DevCommandResultSchema),
  reviewerVerdicts: z.array(ReviewResultSchema),
  knownLimitations: z.array(NonEmptyStringSchema).default([]),
  followUps: z.array(NonEmptyStringSchema).default([]),
  prUrl: z.string().url().optional(),
});
export type PrDraftResult = z.infer<typeof PrDraftResultSchema>;

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

function pathMatchesAllowedFile(changedFile: string, allowedFile: string): boolean {
  const normalizedChanged = changedFile.replace(/^\.\//, "");
  const normalizedAllowed = allowedFile.replace(/^\.\//, "");
  return normalizedChanged === normalizedAllowed || (normalizedAllowed.endsWith("/") && normalizedChanged.startsWith(normalizedAllowed));
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd });
  return String(stdout);
}

export const weaveMaintainer = agent({
  name: "weave.maintainer",
  description: "Plans a Weave-managed development initiative and gates the approved slice plan before implementation.",
  input: DevelopmentInitiativeInputSchema,
  output: InitiativePlannerOutputSchema,
  tools: [developmentRepoContextReadTool],
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

    return InitiativePlannerOutputSchema.parse({
      status: "approved",
      plan: approvedPlan,
      contextFilesRead: input.contextFiles,
      repoContext,
      proposedEventCount: approvedPlan.slices.length,
      gateComment: gate.comment,
    });
  },
});

export const weaveSliceRunner = agent({
  name: "weave.sliceRunner",
  description: "Confirms branch/worktree state for one approved development slice before implementation starts.",
  input: SliceRunnerInputSchema,
  output: SliceRunnerOutputSchema,
  tools: [developmentBranchStateReadTool],
  async run(ctx, rawInput) {
    const input = SliceRunnerInputSchema.parse(rawInput);
    const workingBranch = await ctx.checkpoint(DevelopmentCheckpointKeys.workingBranch, () => input.branch);
    const branchState = await ctx.tool("read-branch-state", developmentBranchStateReadTool, {
      repo: input.repo,
    });
    const decision = evaluateSliceBranchState({ ...input, branch: workingBranch }, branchState);

    if (decision.status === "blocked") {
      return decision;
    }

    await ctx.emit(
      `slice-started:${input.slice.id}`,
      developmentEvents.sliceStarted({
        sliceId: input.slice.id,
        title: input.slice.title,
        branch: workingBranch,
      }),
    );

    return decision;
  },
});
