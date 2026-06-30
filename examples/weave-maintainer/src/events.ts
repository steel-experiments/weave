import { z } from "zod";
import { domainEvent } from "weave/runtime";

export const DevReviewVerdictSchema = z.enum(["pass", "needs-fixes", "blocked"]);
export type DevReviewVerdict = z.infer<typeof DevReviewVerdictSchema>;

export const DevReviewFindingSchema = z.object({
  severity: z.enum(["high", "medium", "low"]),
  file: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  issue: z.string().min(1),
  suggestedFix: z.string().min(1).optional(),
});
export type DevReviewFinding = z.infer<typeof DevReviewFindingSchema>;

export const DevCommandResultSchema = z.object({
  command: z.string().min(1),
  exitCode: z.number().int().nullable(),
  status: z.enum(["passed", "failed", "skipped"]),
  durationMs: z.number().int().nonnegative().optional(),
  summary: z.string().min(1),
  output: z.string().optional(),
});
export type DevCommandResult = z.infer<typeof DevCommandResultSchema>;

export const DevSourceCheckpointWorkspaceRefSchema = z.object({
  provider: z.string().min(1),
  workspaceId: z.string().min(1),
  path: z.string().min(1),
  repo: z.string().min(1),
  baseBranch: z.string().min(1),
  workingBranch: z.string().min(1),
  baseCommit: z.string().min(1),
  parentWorkspaceId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const DevSourceCheckpointVerificationSummarySchema = z.object({
  status: z.enum(["passed", "failed", "blocked"]),
  commands: z.array(DevCommandResultSchema).default([]),
});

export const DevSourceCheckpointReviewSummarySchema = z.object({
  reviewer: z.string().min(1),
  verdict: DevReviewVerdictSchema,
  findingCount: z.number().int().nonnegative(),
});

export const DevSourceCheckpointCreatedPayloadSchema = z.object({
  checkpointId: z.string().uuid(),
  initiativeThreadId: z.string().min(1),
  sliceThreadId: z.string().min(1),
  sliceId: z.string().min(1),
  title: z.string().min(1).optional(),
  workspaceRef: DevSourceCheckpointWorkspaceRefSchema,
  baseSha: z.string().min(1),
  checkpointSha: z.string().min(1),
  changedFiles: z.array(z.string().min(1)).min(1),
  commitMessage: z.string().min(1),
  verificationSummary: DevSourceCheckpointVerificationSummarySchema,
  reviewSummary: z.array(DevSourceCheckpointReviewSummarySchema).default([]),
  createdAt: z.string().datetime().optional(),
});

export const DevSourceCheckpointProposedPayloadSchema = DevSourceCheckpointCreatedPayloadSchema.omit({ checkpointSha: true, createdAt: true }).extend({
  proposedAt: z.string().datetime().optional(),
});

export const DevSourceCheckpointFailedPayloadSchema = z.object({
  checkpointId: z.string().uuid().optional(),
  initiativeThreadId: z.string().min(1),
  sliceThreadId: z.string().min(1),
  sliceId: z.string().min(1),
  title: z.string().min(1).optional(),
  workspaceRef: DevSourceCheckpointWorkspaceRefSchema.optional(),
  baseSha: z.string().min(1).optional(),
  changedFiles: z.array(z.string().min(1)).default([]),
  commitMessage: z.string().min(1).optional(),
  reason: z.string().min(1),
  errorCode: z.string().min(1).optional(),
  failedAt: z.string().datetime().optional(),
});

export const DevSourceCheckpointRestoredPayloadSchema = z.object({
  checkpointId: z.string().uuid(),
  initiativeThreadId: z.string().min(1),
  sliceThreadId: z.string().min(1),
  sliceId: z.string().min(1),
  title: z.string().min(1).optional(),
  workspaceRef: DevSourceCheckpointWorkspaceRefSchema,
  restoredBy: z.string().min(1),
  fromSha: z.string().min(1),
  checkpointSha: z.string().min(1),
  restoredSha: z.string().min(1),
  dirtyBefore: z.boolean(),
  forced: z.boolean().default(false),
  restoredAt: z.string().datetime().optional(),
});

export const DevInitiativeStartedPayloadSchema = z.object({
  initiative: z.string().min(1),
  repo: z.string().min(1),
  baseBranch: z.string().min(1),
  workingBranch: z.string().min(1),
  contextFiles: z.array(z.string().min(1)),
});

export const DevInitiativeSpecReceivedPayloadSchema = z.object({
  title: z.string().min(1),
  source: z.enum(["prd", "statement-of-work", "prompt", "markdown", "manual"]),
  summary: z.string().min(1).optional(),
  goals: z.array(z.string().min(1)).default([]),
  acceptanceCriteria: z.array(z.string().min(1)).default([]),
  contextFiles: z.array(z.string().min(1)).default([]),
});

export const DevInitiativePlanProposedPayloadSchema = z.object({
  initiative: z.string().min(1),
  repo: z.string().min(1),
  workingBranch: z.string().min(1),
  revision: z.number().int().positive(),
  sliceCount: z.number().int().positive(),
  summary: z.string().min(1),
});

export const DevInitiativePlanRevisedPayloadSchema = z.object({
  initiative: z.string().min(1),
  revision: z.number().int().positive(),
  sliceCount: z.number().int().positive(),
  summary: z.string().min(1),
  reason: z.string().min(1),
});

export const DevInitiativePlanApprovedPayloadSchema = z.object({
  initiative: z.string().min(1),
  revision: z.number().int().positive(),
  approvedBy: z.string().min(1),
  sliceCount: z.number().int().positive(),
  summary: z.string().min(1),
});

export const DevInitiativePlanRejectedPayloadSchema = z.object({
  initiative: z.string().min(1),
  revision: z.number().int().positive(),
  rejectedBy: z.string().min(1),
  reason: z.string().min(1),
});

export const DevSliceProposedPayloadSchema = z.object({
  sliceId: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)),
  requiredReviewers: z.array(z.string().min(1)).default([]),
});

export const DevSliceApprovedPayloadSchema = z.object({
  sliceId: z.string().min(1),
  title: z.string().min(1),
  approvedBy: z.string().min(1),
});

export const DevSliceStartedPayloadSchema = z.object({
  sliceId: z.string().min(1),
  title: z.string().min(1),
  branch: z.string().min(1),
});

export const DevSliceCompletedPayloadSchema = z.object({
  sliceId: z.string().min(1),
  title: z.string().min(1),
  branch: z.string().min(1),
  summary: z.string().min(1),
  testsPassed: z.boolean(),
  reviewVerdicts: z.array(DevReviewVerdictSchema),
});

export const DevSliceFailedPayloadSchema = z.object({
  sliceId: z.string().min(1),
  title: z.string().min(1),
  branch: z.string().min(1),
  reason: z.string().min(1),
  findings: z.array(DevReviewFindingSchema).default([]),
});

export const DevImplementationStartedPayloadSchema = z.object({
  sliceId: z.string().min(1),
  branch: z.string().min(1),
  agentName: z.string().min(1),
});

export const DevImplementationCompletedPayloadSchema = z.object({
  sliceId: z.string().min(1),
  branch: z.string().min(1),
  summary: z.string().min(1),
  filesChanged: z.array(z.string().min(1)),
  testsAdded: z.array(z.string().min(1)).default([]),
  knownLimitations: z.array(z.string().min(1)).default([]),
});

export const DevVerificationCompletedPayloadSchema = z.object({
  sliceId: z.string().min(1),
  branch: z.string().min(1),
  status: z.enum(["passed", "failed", "blocked"]),
  commands: z.array(DevCommandResultSchema),
});

export const DevReviewCompletedPayloadSchema = z.object({
  sliceId: z.string().min(1),
  reviewer: z.string().min(1),
  verdict: DevReviewVerdictSchema,
  findings: z.array(DevReviewFindingSchema),
});

export const DevRepairStartedPayloadSchema = z.object({
  sliceId: z.string().min(1),
  branch: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  findings: z.array(DevReviewFindingSchema),
});

export const DevRepairCompletedPayloadSchema = z.object({
  sliceId: z.string().min(1),
  branch: z.string().min(1),
  attempt: z.number().int().nonnegative(),
  status: z.enum(["completed", "failed", "blocked"]),
  summary: z.string().min(1),
});

export const DevPrOpenedPayloadSchema = z.object({
  branch: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
});

export const DevPrUpdatedPayloadSchema = z.object({
  branch: z.string().min(1),
  url: z.string().url(),
  summary: z.string().min(1),
});

export const DevPrReadyForReviewPayloadSchema = z.object({
  branch: z.string().min(1),
  url: z.string().url().optional(),
  summary: z.string().min(1),
  shippedSlices: z.array(z.string().min(1)),
});

function devEvent<Schema extends z.ZodType>(kind: string, schema: Schema) {
  return Object.assign((data: z.infer<Schema>) => domainEvent(kind, schema, data), { kind });
}

export const developmentEvents = {
  initiativeStarted: devEvent("dev.initiative.started", DevInitiativeStartedPayloadSchema),
  initiativeSpecReceived: devEvent("dev.initiative.spec_received", DevInitiativeSpecReceivedPayloadSchema),
  initiativePlanProposed: devEvent("dev.initiative.plan_proposed", DevInitiativePlanProposedPayloadSchema),
  initiativePlanRevised: devEvent("dev.initiative.plan_revised", DevInitiativePlanRevisedPayloadSchema),
  initiativePlanApproved: devEvent("dev.initiative.plan_approved", DevInitiativePlanApprovedPayloadSchema),
  initiativePlanRejected: devEvent("dev.initiative.plan_rejected", DevInitiativePlanRejectedPayloadSchema),
  sliceProposed: devEvent("dev.slice.proposed", DevSliceProposedPayloadSchema),
  sliceApproved: devEvent("dev.slice.approved", DevSliceApprovedPayloadSchema),
  sliceStarted: devEvent("dev.slice.started", DevSliceStartedPayloadSchema),
  sliceCompleted: devEvent("dev.slice.completed", DevSliceCompletedPayloadSchema),
  sliceFailed: devEvent("dev.slice.failed", DevSliceFailedPayloadSchema),
  implementationStarted: devEvent("dev.implementation.started", DevImplementationStartedPayloadSchema),
  implementationCompleted: devEvent("dev.implementation.completed", DevImplementationCompletedPayloadSchema),
  verificationCompleted: devEvent("dev.verification.completed", DevVerificationCompletedPayloadSchema),
  reviewCompleted: devEvent("dev.review.completed", DevReviewCompletedPayloadSchema),
  repairStarted: devEvent("dev.repair.started", DevRepairStartedPayloadSchema),
  repairCompleted: devEvent("dev.repair.completed", DevRepairCompletedPayloadSchema),
  prOpened: devEvent("dev.pr.opened", DevPrOpenedPayloadSchema),
  prUpdated: devEvent("dev.pr.updated", DevPrUpdatedPayloadSchema),
  prReadyForReview: devEvent("dev.pr.ready_for_review", DevPrReadyForReviewPayloadSchema),
  sourceCheckpointProposed: devEvent("dev.source_checkpoint.proposed", DevSourceCheckpointProposedPayloadSchema),
  sourceCheckpointCreated: devEvent("dev.source_checkpoint.created", DevSourceCheckpointCreatedPayloadSchema),
  sourceCheckpointFailed: devEvent("dev.source_checkpoint.failed", DevSourceCheckpointFailedPayloadSchema),
  sourceCheckpointRestored: devEvent("dev.source_checkpoint.restored", DevSourceCheckpointRestoredPayloadSchema),
} as const;
