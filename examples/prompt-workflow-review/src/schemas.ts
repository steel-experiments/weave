import { z } from "zod";

export const CapabilityRequestSchema = z.object({
  name: z.string().min(1),
  reason: z.string().min(1),
});
export type CapabilityRequest = z.infer<typeof CapabilityRequestSchema>;

export const WorkflowPlanStepSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("spawn"),
    key: z.string().min(1),
    agentName: z.string().min(1),
    input: z.unknown(),
    verifyWith: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("join"),
    key: z.string().min(1),
    childKey: z.string().min(1),
  }),
  z.object({
    kind: z.literal("synthesize"),
    key: z.string().min(1),
    inputKeys: z.array(z.string().min(1)),
  }),
]);
export type WorkflowPlanStep = z.infer<typeof WorkflowPlanStepSchema>;

export const WorkflowPlanSchema = z.object({
  objective: z.string().min(1),
  pattern: z.enum(["fan-out-and-synthesize", "adversarial-verification"]),
  budget: z.object({
    maxChildAgents: z.number().int().positive(),
    maxDepth: z.number().int().nonnegative(),
    maxToolCalls: z.number().int().positive().optional(),
  }),
  requiredCapabilities: z.array(CapabilityRequestSchema),
  steps: z.array(WorkflowPlanStepSchema),
});
export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;

export const WorkflowInputSchema = z.object({
  prompt: z.string().min(1),
  document: z.string().min(1),
});
export type WorkflowInput = z.infer<typeof WorkflowInputSchema>;

export const ExtractedClaimSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  impact: z.enum(["low", "medium", "high"]),
});
export type ExtractedClaim = z.infer<typeof ExtractedClaimSchema>;

export const ClaimExtractionInputSchema = z.object({
  document: z.string().min(1),
});
export type ClaimExtractionInput = z.infer<typeof ClaimExtractionInputSchema>;

export const ClaimExtractionOutputSchema = z.object({
  claims: z.array(ExtractedClaimSchema).min(1),
});
export type ClaimExtractionOutput = z.infer<typeof ClaimExtractionOutputSchema>;

export const ClaimCheckInputSchema = z.object({
  claim: ExtractedClaimSchema,
});
export type ClaimCheckInput = z.infer<typeof ClaimCheckInputSchema>;

export const RepoEvidenceInputSchema = z.object({
  claim: z.string().min(1),
});
export type RepoEvidenceInput = z.infer<typeof RepoEvidenceInputSchema>;

export const RepoEvidenceOutputSchema = z.object({
  status: z.enum(["verified", "unsupported", "needs-review"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)),
  notes: z.string().min(1),
});
export type RepoEvidenceOutput = z.infer<typeof RepoEvidenceOutputSchema>;

export const ClaimCheckOutputSchema = z.object({
  claim: z.string().min(1),
  status: RepoEvidenceOutputSchema.shape.status,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)),
  checkerNotes: z.string().min(1),
});
export type ClaimCheckOutput = z.infer<typeof ClaimCheckOutputSchema>;

export const ClaimVerificationInputSchema = z.object({
  check: ClaimCheckOutputSchema,
});
export type ClaimVerificationInput = z.infer<typeof ClaimVerificationInputSchema>;

export const ClaimVerificationOutputSchema = z.object({
  claim: z.string().min(1),
  verifierNotes: z.string().min(1),
  confidenceAdjustment: z.number().min(-1).max(1),
});
export type ClaimVerificationOutput = z.infer<typeof ClaimVerificationOutputSchema>;

export const SynthesisInputSchema = z.object({
  objective: z.string().min(1),
  checks: z.array(ClaimCheckOutputSchema),
  verifications: z.array(ClaimVerificationOutputSchema),
});
export type SynthesisInput = z.infer<typeof SynthesisInputSchema>;

export const FinalClaimReportSchema = z.object({
  claim: z.string().min(1),
  status: RepoEvidenceOutputSchema.shape.status,
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1)),
  verifierNotes: z.string().optional(),
});
export type FinalClaimReport = z.infer<typeof FinalClaimReportSchema>;

export const FinalReportSchema = z.object({
  recommendation: z.enum(["publish", "revise", "do-not-publish"]),
  summary: z.string().min(1),
  claims: z.array(FinalClaimReportSchema),
});
export type FinalReport = z.infer<typeof FinalReportSchema>;
