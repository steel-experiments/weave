import { z } from "zod";
import { agent, event } from "./agent-contract.js";
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

const NonEmptyStringSchema = z.string().min(1);

export const DevelopmentCheckpointKeys = {
  initiativeContext: "initiative-context",
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

export const weaveMaintainer = agent({
  name: "weave.maintainer",
  description: "Plans a Weave-managed development initiative and gates the approved slice plan before implementation.",
  input: DevelopmentInitiativeInputSchema,
  output: InitiativePlannerOutputSchema,
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
      proposedEventCount: approvedPlan.slices.length,
      gateComment: gate.comment,
    });
  },
});
