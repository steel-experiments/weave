import { agent, event } from "weave";
import { z } from "zod";
import {
  BladeReviewArtifactSchema,
  ReviewFindingSchema,
  bladeReviewTools,
  type BladeReviewTools,
} from "./tools.js";

const GitHubLoginSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/);
const GitHubFullNameSchema = z.string().min(3).max(200).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);

export const BladeGithubPullRequestReviewWorkSchema = z.object({
  workItem: z.object({
    source: z.literal("github"),
    mode: z.literal("review"),
    trigger: z.literal("pull_request.review_requested"),
    sourceReference: z.string().url(),
    idempotencyKey: z.string().min(1),
    requestedReviewer: GitHubLoginSchema,
    createdBy: z.object({
      kind: z.literal("github-user"),
      login: GitHubLoginSchema,
    }),
  }),
  repository: z.object({
    owner: GitHubLoginSchema,
    name: GitHubLoginSchema,
    fullName: GitHubFullNameSchema,
    private: z.boolean(),
    htmlUrl: z.string().url(),
  }),
  pullRequest: z.object({
    number: z.number().int().positive(),
    title: z.string().min(1),
    bodySummary: z.string().nullable(),
    htmlUrl: z.string().url(),
    baseRef: z.string().min(1),
    baseSha: z.string().min(1),
    headRef: z.string().min(1),
    headSha: z.string().min(1),
    authorLogin: GitHubLoginSchema,
    draft: z.boolean(),
  }),
  policy: z.object({
    publishRequiresGate: z.literal(true),
    publicRepository: z.boolean(),
    repositoryAllowed: z.literal(true),
  }),
});
export type BladeGithubPullRequestReviewWork = z.infer<typeof BladeGithubPullRequestReviewWorkSchema>;

export const BladeReviewAgentOutputSchema = z.object({
  status: z.enum(["published", "publish-denied"]),
  findings: z.array(ReviewFindingSchema),
  reviewSummary: z.string().min(1),
  artifacts: z.object({
    pullRequestMetadata: BladeReviewArtifactSchema,
    rawDiff: BladeReviewArtifactSchema,
    diffSummary: BladeReviewArtifactSchema,
    structuredFindings: BladeReviewArtifactSchema,
    reviewSummary: BladeReviewArtifactSchema,
  }),
  publishGateId: z.string().uuid(),
  publishedReviewUrl: z.string().url().nullable(),
});
export type BladeReviewAgentOutput = z.infer<typeof BladeReviewAgentOutputSchema>;

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
    ).min(1),
  }),
  description: "Compact event pointer for a full Blade PR review finding artifact.",
});

const responseProduced = event({
  type: "agent.response.produced",
  payload: z.object({
    message: z.string().min(1),
  }),
  description: "Final Blade PR review response.",
});

export function createBladeReviewAgent(tools: BladeReviewTools = bladeReviewTools) {
  return agent({
    name: "blade.github-pr-review",
    description: "Blade PR review agent for one normalized GitHub review-requested work item.",
    input: BladeGithubPullRequestReviewWorkSchema,
    output: BladeReviewAgentOutputSchema,
    tools: tools.all,
    async run(ctx, input) {
      const inspection = await ctx.tool("github-inspect-pr", tools.githubInspectPullRequestTool, {
        owner: input.repository.owner,
        repository: input.repository.name,
        pullNumber: input.pullRequest.number,
      });

      const review = await ctx.tool("blade-synthesize-review", tools.bladeSynthesizeReviewTool, inspection);

      for (const [index, finding] of review.findings.entries()) {
        await ctx.emit(`review-finding:${index}`, findingProduced({
          findingId: finding.id,
          severity: finding.severity === "blocking" ? "critical" : finding.severity,
          summary: finding.summary,
          evidence: finding.evidence.map((evidence) => ({
            source: evidence.artifactId ? `${evidence.source}:${evidence.artifactId}` : evidence.source,
            summary: evidence.summary,
          })),
        }));
      }

      const gate = await ctx.gate("github-publish-review-policy", {
        reason: review.publishPolicy.reason,
        proposedAction: review.publishPolicy.proposedAction,
      });

      const artifacts = {
        pullRequestMetadata: inspection.artifacts.pullRequestMetadata,
        rawDiff: inspection.artifacts.rawDiff,
        diffSummary: inspection.artifacts.diffSummary,
        structuredFindings: review.artifacts.structuredFindings,
        reviewSummary: review.artifacts.reviewSummary,
      };

      if (gate.resolution === "denied") {
        const message = `Blade reviewed ${input.repository.fullName}#${input.pullRequest.number}, produced ${review.findings.length} finding(s), and did not publish because the review gate was denied.`;
        await ctx.emit("final-response", responseProduced({ message }));
        return BladeReviewAgentOutputSchema.parse({
          status: "publish-denied",
          findings: review.findings,
          reviewSummary: message,
          artifacts,
          publishGateId: gate.gateId,
          publishedReviewUrl: null,
        });
      }

      const published = await ctx.tool("github-publish-review", tools.githubPublishReviewTool, {
        owner: input.repository.owner,
        repository: input.repository.name,
        pullNumber: input.pullRequest.number,
        reviewBody: review.reviewBody,
        event: review.event,
        inlineComments: review.inlineComments,
        idempotencyKey: `${input.workItem.idempotencyKey}:publish:${review.reviewId}`,
        approvalGateId: gate.gateId,
      });

      const message = `Blade reviewed ${input.repository.fullName}#${input.pullRequest.number}, produced ${review.findings.length} finding(s), and published ${review.event} review: ${published.reviewUrl}`;
      await ctx.emit("final-response", responseProduced({ message }));
      return BladeReviewAgentOutputSchema.parse({
        status: "published",
        findings: review.findings,
        reviewSummary: message,
        artifacts,
        publishGateId: gate.gateId,
        publishedReviewUrl: published.reviewUrl,
      });
    },
  });
}

export const bladeReviewAgent = createBladeReviewAgent();
