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

const findingProduced = event({
  type: "agent.finding.produced",
  payload: z.object({
    findingId: z.string().uuid(),
    severity: z.enum(["info", "warning", "critical"]),
    summary: z.string().min(1),
    evidence: z.array(
      z.object({
        source: z.string().min(1),
        summary: z.string().min(1),
      }),
    ),
  }),
  description: "Structured finding produced by the Steel docs sync model review.",
});

const responseProduced = event({
  type: "agent.response.produced",
  payload: z.object({
    message: z.string().min(1),
  }),
  description: "Final Steel docs sync response message.",
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
        findingProduced({
          findingId: ctx.id(`model-review-finding:${index}`),
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
      responseProduced({
        message: reviewData.finalMessage,
      }),
    );

    return reviewData;
  },
});
