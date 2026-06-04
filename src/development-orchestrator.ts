import { readFile, stat } from "node:fs/promises";
import path from "node:path";
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
} from "./events.js";
import { tool } from "./tool-contract.js";

const NonEmptyStringSchema = z.string().min(1);

export const DevelopmentCheckpointKeys = {
  initiativeContext: "initiative-context",
  repoContext: "repo-context",
  slicePlan: "slice-plan",
  approvedSlicePlan: "approved-slice-plan",
  workingBranch: "working-branch",
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
  branch: NonEmptyStringSchema,
  baseCommit: NonEmptyStringSchema.optional(),
  slice: DevelopmentSliceInputSchema,
  maxRepairAttempts: z.number().int().nonnegative().default(0),
});
export type SliceRunnerInput = z.infer<typeof SliceRunnerInputSchema>;

export const OpenCodeImplementerInputSchema = z.object({
  sliceTitle: NonEmptyStringSchema,
  objective: NonEmptyStringSchema,
  acceptanceCriteria: z.array(NonEmptyStringSchema).min(1),
  allowedFiles: z.array(NonEmptyStringSchema).optional(),
  branch: NonEmptyStringSchema,
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

export const VerificationResultSchema = z.object({
  status: z.enum(["passed", "failed", "blocked"]),
  commands: z.array(DevCommandResultSchema).min(1),
  failureSummary: NonEmptyStringSchema.optional(),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export const ReviewResultSchema = z.object({
  reviewer: DevelopmentReviewerRoleSchema,
  verdict: DevReviewVerdictSchema,
  findings: z.array(DevReviewFindingSchema),
  summary: NonEmptyStringSchema.optional(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

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
  slice: DevelopmentSliceInputSchema,
  attempt: z.number().int().nonnegative(),
  failingCommands: z.array(DevCommandResultSchema).default([]),
  findings: z.array(DevReviewFindingSchema),
});
export type RepairAgentInput = z.infer<typeof RepairAgentInputSchema>;

export const RepairResultSchema = z.object({
  status: z.enum(["completed", "failed", "blocked"]),
  attempt: z.number().int().nonnegative(),
  filesChanged: z.array(NonEmptyStringSchema).default([]),
  fixesAttempted: z.array(NonEmptyStringSchema).default([]),
  findingsAddressed: z.array(DevReviewFindingSchema).default([]),
  limitations: z.array(NonEmptyStringSchema).default([]),
  summary: NonEmptyStringSchema,
});
export type RepairResult = z.infer<typeof RepairResultSchema>;

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
