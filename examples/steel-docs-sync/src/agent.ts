import { agent, event } from "weave";
import { z } from "zod";
import {
  steelAuditTool,
  steelModelReviewTool,
} from "./tools.js";

export const SteelDocsSessionMetadataSchema = z.object({
  repository: z.literal("steel-dev/docs"),
  ref: z.string().min(1),
  sha: z.string().min(7),
  mode: z.enum(["production-drift", "pull-request", "manual"]),
  docsBaseUrl: z.string().url(),
  llmsTxtUrl: z.string().url(),
  openApiSpecUrl: z.string().url().optional(),
});

export const steelDocsAgent = agent({
  name: "steel-docs",
  description: "Deterministic Steel docs sync audit agent.",
  input: SteelDocsSessionMetadataSchema,
  tools: [steelAuditTool, steelModelReviewTool],
  async run(ctx, input) {
    const audit = await ctx.tool("audit-docs", steelAuditTool, input);
    const reviewData = await ctx.tool("model-review", steelModelReviewTool, audit);

    for (const [index, finding] of reviewData.findings.entries()) {
      await ctx.emit(
        `model-review-finding:${index}`,
        event("agent.finding.produced", {
          findingId: ctx.uuid(`model-review-finding:${index}`),
          severity: finding.severity,
          summary: finding.summary,
          evidence: finding.evidence.map((evidence, evidenceIndex) => ({
            source: `model:${index}:${evidenceIndex}`,
            summary: evidence,
          })),
        }),
      );
    }

    await ctx.emit(
      "final-response",
      event("agent.response.produced", {
        message: reviewData.finalMessage,
      }),
    );

    return reviewData;
  },
});
