import { createHash } from "node:crypto";
import { ThreadArtifactSchema, deterministicUuid, tool } from "weave";
import { z } from "zod";

export const GitHubSlugSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_.-]+$/);

export const GitHubReviewEventSchema = z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]);
export const ReviewSeveritySchema = z.enum(["info", "warning", "critical", "blocking"]);
export const ReviewConfidenceSchema = z.enum(["low", "medium", "high"]);

export const ReviewEvidenceSchema = z.object({
  source: z.string().min(1),
  summary: z.string().min(1),
  artifactId: z.string().uuid().optional(),
});

export const ReviewFindingSchema = z.object({
  id: z.string().uuid(),
  severity: ReviewSeveritySchema,
  confidence: ReviewConfidenceSchema,
  summary: z.string().min(1),
  affectedFile: z.string().min(1).optional(),
  affectedLine: z.number().int().positive().optional(),
  evidence: z.array(ReviewEvidenceSchema).min(1),
});
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const ReviewHintSchema = z.object({
  severity: ReviewSeveritySchema,
  confidence: ReviewConfidenceSchema,
  summary: z.string().min(1),
  line: z.number().int().positive().optional(),
  evidence: z.string().min(1),
});

export const BladeReviewArtifactSchema = ThreadArtifactSchema.extend({
  kind: z.enum(["github-pr-metadata", "github-pr-raw-diff", "github-pr-diff-summary", "github-pr-findings", "github-pr-review-summary"]),
});

export const GitHubInspectPullRequestInputSchema = z.object({
  owner: GitHubSlugSchema,
  repository: GitHubSlugSchema,
  pullNumber: z.number().int().positive(),
  pathFilters: z.array(z.string().min(1)).optional(),
});
export type GitHubInspectPullRequestInput = z.infer<typeof GitHubInspectPullRequestInputSchema>;

export const GitHubFileSummarySchema = z.object({
  path: z.string().min(1),
  status: z.enum(["added", "modified", "removed", "renamed"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  riskHints: z.array(ReviewHintSchema).default([]),
});

export const GitHubInspectPullRequestOutputSchema = z.object({
  pullRequest: z.object({
    owner: GitHubSlugSchema,
    repository: GitHubSlugSchema,
    number: z.number().int().positive(),
    title: z.string().min(1),
    bodySummary: z.string().nullable(),
    htmlUrl: z.string().url(),
    baseRef: z.string().min(1),
    baseSha: z.string().min(1),
    headRef: z.string().min(1),
    headSha: z.string().min(1),
    authorLogin: z.string().min(1),
    isDraft: z.boolean(),
  }),
  diffSummary: z.object({
    fileCount: z.number().int().nonnegative(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    files: z.array(GitHubFileSummarySchema),
  }),
  checkStatuses: z.array(
    z.object({
      name: z.string().min(1),
      status: z.enum(["queued", "in_progress", "success", "failure", "neutral", "cancelled", "skipped"]),
      targetUrl: z.string().url().optional(),
    }),
  ),
  commentContext: z.array(
    z.object({
      authorLogin: z.string().min(1),
      bodySummary: z.string().min(1),
      url: z.string().url(),
    }),
  ),
  resourceUrls: z.object({
    pullRequest: z.string().url(),
    commits: z.string().url(),
    checks: z.string().url(),
  }),
  artifacts: z.object({
    pullRequestMetadata: BladeReviewArtifactSchema,
    rawDiff: BladeReviewArtifactSchema,
    diffSummary: BladeReviewArtifactSchema,
  }),
});
export type GitHubInspectPullRequestOutput = z.infer<typeof GitHubInspectPullRequestOutputSchema>;

export const BladeReviewInlineCommentSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  body: z.string().min(1),
});

export const BladeReviewSynthesisInputSchema = GitHubInspectPullRequestOutputSchema;
export const BladeReviewSynthesisOutputSchema = z.object({
  reviewId: z.string().uuid(),
  outcome: z.enum(["passed", "comment", "changes-requested"]),
  event: GitHubReviewEventSchema.exclude(["APPROVE"]),
  reviewBody: z.string().min(1),
  inlineComments: z.array(BladeReviewInlineCommentSchema),
  findings: z.array(ReviewFindingSchema),
  artifacts: z.object({
    structuredFindings: BladeReviewArtifactSchema,
    reviewSummary: BladeReviewArtifactSchema,
  }),
  publishPolicy: z.object({
    gateRequired: z.literal(true),
    reason: z.literal("pr-review-approval"),
    proposedAction: z.string().min(1),
  }),
});
export type BladeReviewSynthesisOutput = z.infer<typeof BladeReviewSynthesisOutputSchema>;

export const GitHubPublishReviewInputSchema = z.object({
  owner: GitHubSlugSchema,
  repository: GitHubSlugSchema,
  pullNumber: z.number().int().positive(),
  reviewBody: z.string().min(1),
  event: GitHubReviewEventSchema,
  inlineComments: z.array(BladeReviewInlineCommentSchema).default([]),
  idempotencyKey: z.string().min(1),
  approvalGateId: z.string().uuid().optional(),
});
export type GitHubPublishReviewInput = z.infer<typeof GitHubPublishReviewInputSchema>;

export const GitHubPublishReviewOutputSchema = z.object({
  reviewUrl: z.string().url(),
  publishedCommentIds: z.array(z.string().min(1)),
  idempotencyKey: z.string().min(1),
  deduplicated: z.boolean(),
});
export type GitHubPublishReviewOutput = z.infer<typeof GitHubPublishReviewOutputSchema>;

export type BladeGitHubPullRequestInspection = {
  pullRequest: {
    owner: string;
    repository: string;
    number: number;
    title: string;
    body: string | null;
    htmlUrl: string;
    baseRef: string;
    baseSha: string;
    headRef: string;
    headSha: string;
    authorLogin: string;
    isDraft: boolean;
  };
  changedFiles: Array<z.infer<typeof GitHubFileSummarySchema> & { patch: string }>;
  checkStatuses: z.infer<typeof GitHubInspectPullRequestOutputSchema>["checkStatuses"];
  commentContext: z.infer<typeof GitHubInspectPullRequestOutputSchema>["commentContext"];
  resourceUrls: z.infer<typeof GitHubInspectPullRequestOutputSchema>["resourceUrls"];
  rawDiff: string;
};

export type BladeGitHubClient = {
  inspectPullRequest(input: GitHubInspectPullRequestInput): Promise<BladeGitHubPullRequestInspection>;
  publishReview(input: GitHubPublishReviewInput): Promise<GitHubPublishReviewOutput>;
};

export type BladeReviewTools = ReturnType<typeof createBladeReviewTools>;

export function createBladeReviewTools(githubClient: BladeGitHubClient = createFakeBladeGitHubClient()) {
  const githubInspectPullRequestTool = tool({
    name: "github.inspectPullRequest",
    description: "Inspect GitHub PR metadata and diff through a bounded client, storing raw bodies as artifacts.",
    input: GitHubInspectPullRequestInputSchema,
    output: GitHubInspectPullRequestOutputSchema,
    summarize(output) {
      return `Inspected ${output.pullRequest.owner}/${output.pullRequest.repository}#${output.pullRequest.number}: ${output.diffSummary.fileCount} files changed.`;
    },
    async run({ artifactStore, threadId, input, toolCallId, progress }) {
      await progress({ percent: 15, message: "Loading pull request metadata from GitHub boundary." });
      const inspection = await githubClient.inspectPullRequest(input);
      const filtered = filterInspection(inspection, input.pathFilters);
      const diffSummary = summarizeDiff(filtered.changedFiles);

      await progress({ percent: 55, message: "Storing raw PR metadata and diff as artifacts." });
      const pullRequestMetadata = await artifactStore.putArtifact({
        threadId,
        toolCallId,
        kind: "github-pr-metadata",
        mediaType: "application/json",
        sourceUrl: filtered.pullRequest.htmlUrl,
        body: JSON.stringify({
          pullRequest: filtered.pullRequest,
          checkStatuses: filtered.checkStatuses,
          commentContext: filtered.commentContext,
          resourceUrls: filtered.resourceUrls,
        }, null, 2),
      });
      const rawDiff = await artifactStore.putArtifact({
        threadId,
        toolCallId,
        kind: "github-pr-raw-diff",
        mediaType: "text/x-diff",
        sourceUrl: `${filtered.pullRequest.htmlUrl}.diff`,
        body: filtered.rawDiff,
      });
      const diffSummaryArtifact = await artifactStore.putArtifact({
        threadId,
        toolCallId,
        kind: "github-pr-diff-summary",
        mediaType: "application/json",
        sourceUrl: `${filtered.pullRequest.htmlUrl}#diff-summary`,
        body: JSON.stringify(diffSummary, null, 2),
      });

      await progress({ percent: 100, message: "Prepared compact PR inspection output." });
      return GitHubInspectPullRequestOutputSchema.parse({
        pullRequest: {
          ...filtered.pullRequest,
          bodySummary: summarizeText(filtered.pullRequest.body, 500),
        },
        diffSummary,
        checkStatuses: filtered.checkStatuses,
        commentContext: filtered.commentContext,
        resourceUrls: filtered.resourceUrls,
        artifacts: {
          pullRequestMetadata,
          rawDiff,
          diffSummary: diffSummaryArtifact,
        },
      });
    },
  });

  const bladeSynthesizeReviewTool = tool({
    name: "blade.synthesizePullRequestReview",
    description: "Produce schema-validated Blade PR review findings and review summary artifacts.",
    input: BladeReviewSynthesisInputSchema,
    output: BladeReviewSynthesisOutputSchema,
    summarize(output) {
      return `Prepared ${output.findings.length} PR review findings for gated ${output.event} publishing.`;
    },
    async run({ artifactStore, threadId, input, toolCallId, progress }) {
      await progress({ percent: 35, message: "Building structured findings from compact diff evidence." });
      const reviewId = deterministicUuid(
        "blade-pr-review",
        input.pullRequest.owner,
        input.pullRequest.repository,
        String(input.pullRequest.number),
        input.pullRequest.headSha,
      );
      const findings = buildReviewFindings(input, reviewId);
      const event = findings.some((finding) => finding.severity === "critical" || finding.severity === "blocking")
        ? "REQUEST_CHANGES"
        : "COMMENT";
      const outcome = event === "REQUEST_CHANGES" ? "changes-requested" : findings.length > 0 ? "comment" : "passed";
      const inlineComments = findings
        .filter((finding) => finding.affectedFile && finding.affectedLine)
        .map((finding) => ({
          path: finding.affectedFile as string,
          line: finding.affectedLine as number,
          body: `${finding.summary}\n\nEvidence: ${finding.evidence.map((evidence) => evidence.summary).join(" ")}`,
        }));
      const reviewBody = formatReviewBody(input, findings, event);

      await progress({ percent: 70, message: "Persisting review findings and summary artifacts." });
      const structuredFindings = await artifactStore.putArtifact({
        threadId,
        toolCallId,
        kind: "github-pr-findings",
        mediaType: "application/json",
        sourceUrl: `${input.pullRequest.htmlUrl}#blade-review-findings`,
        body: JSON.stringify({ reviewId, findings }, null, 2),
      });
      const reviewSummary = await artifactStore.putArtifact({
        threadId,
        toolCallId,
        kind: "github-pr-review-summary",
        mediaType: "text/markdown",
        sourceUrl: `${input.pullRequest.htmlUrl}#blade-review-summary`,
        body: reviewBody,
      });

      await progress({ percent: 100, message: "Review artifacts are ready for publish policy." });
      return BladeReviewSynthesisOutputSchema.parse({
        reviewId,
        outcome,
        event,
        reviewBody,
        inlineComments,
        findings,
        artifacts: {
          structuredFindings,
          reviewSummary,
        },
        publishPolicy: {
          gateRequired: true,
          reason: "pr-review-approval",
          proposedAction: `Publish a ${event} review to ${input.pullRequest.owner}/${input.pullRequest.repository}#${input.pullRequest.number} with ${findings.length} finding(s).`,
        },
      });
    },
  });

  const githubPublishReviewTool = tool({
    name: "github.publishReview",
    description: "Publish a gated Blade PR review to GitHub through an idempotent client boundary.",
    input: GitHubPublishReviewInputSchema,
    output: GitHubPublishReviewOutputSchema,
    summarize(output) {
      return `${output.deduplicated ? "Reused" : "Published"} GitHub review ${output.reviewUrl}.`;
    },
    async run({ input, progress }) {
      if (input.event === "APPROVE") {
        throw new Error("Blade slice 1 does not publish PR approvals.");
      }

      await progress({ percent: 50, message: "Publishing review through GitHub boundary." });
      const result = await githubClient.publishReview(input);
      await progress({ percent: 100, message: result.deduplicated ? "Reused existing idempotent review." : "Published review." });
      return GitHubPublishReviewOutputSchema.parse(result);
    },
  });

  return {
    githubInspectPullRequestTool,
    bladeSynthesizeReviewTool,
    githubPublishReviewTool,
    all: [githubInspectPullRequestTool, bladeSynthesizeReviewTool, githubPublishReviewTool] as const,
  };
}

export type FakeBladeGitHubClientOptions = {
  pullRequests?: Record<string, BladeGitHubPullRequestInspection>;
};

export type FakeBladeGitHubClient = BladeGitHubClient & {
  readonly publishedReviewCount: number;
  readonly publishedReviews: readonly GitHubPublishReviewInput[];
};

export function createFakeBladeGitHubClient(options: FakeBladeGitHubClientOptions = {}): FakeBladeGitHubClient {
  return new InMemoryFakeBladeGitHubClient(options);
}

function filterInspection(
  inspection: BladeGitHubPullRequestInspection,
  pathFilters: readonly string[] | undefined,
): BladeGitHubPullRequestInspection {
  if (!pathFilters || pathFilters.length === 0) {
    return inspection;
  }

  const changedFiles = inspection.changedFiles.filter((file) => pathFilters.some((path) => file.path.startsWith(path)));
  return {
    ...inspection,
    changedFiles,
    rawDiff: inspection.rawDiff,
  };
}

function summarizeDiff(changedFiles: BladeGitHubPullRequestInspection["changedFiles"]): z.infer<typeof GitHubInspectPullRequestOutputSchema>["diffSummary"] {
  return {
    fileCount: changedFiles.length,
    additions: changedFiles.reduce((sum, file) => sum + file.additions, 0),
    deletions: changedFiles.reduce((sum, file) => sum + file.deletions, 0),
    files: changedFiles.map(({ path, status, additions, deletions, riskHints }) => ({
      path,
      status,
      additions,
      deletions,
      riskHints,
    })),
  };
}

function summarizeText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function buildReviewFindings(input: GitHubInspectPullRequestOutput, reviewId: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  for (const file of input.diffSummary.files) {
    for (const [index, hint] of file.riskHints.entries()) {
      findings.push(ReviewFindingSchema.parse({
        id: deterministicUuid("blade-pr-review-finding", reviewId, file.path, String(index)),
        severity: hint.severity,
        confidence: hint.confidence,
        summary: hint.summary,
        affectedFile: file.path,
        affectedLine: hint.line,
        evidence: [
          {
            source: `diff-summary:${file.path}`,
            summary: hint.evidence,
            artifactId: input.artifacts.diffSummary.artifactId,
          },
        ],
      }));
    }
  }

  return findings;
}

function formatReviewBody(
  input: GitHubInspectPullRequestOutput,
  findings: readonly ReviewFinding[],
  event: "COMMENT" | "REQUEST_CHANGES",
): string {
  const lines = [
    `Blade reviewed ${input.pullRequest.owner}/${input.pullRequest.repository}#${input.pullRequest.number}.`,
    `Publish event: ${event}.`,
    `Diff summary artifact: ${input.artifacts.diffSummary.artifactId}.`,
    "",
  ];

  if (findings.length === 0) {
    lines.push("No findings were produced from the inspected PR data.");
    return lines.join("\n");
  }

  lines.push("Findings:");
  for (const finding of findings) {
    const location = finding.affectedFile ? ` (${finding.affectedFile}${finding.affectedLine ? `:${finding.affectedLine}` : ""})` : "";
    lines.push(`- [${finding.severity}/${finding.confidence}] ${finding.summary}${location}`);
    for (const evidence of finding.evidence) {
      lines.push(`  Evidence: ${evidence.summary}`);
    }
  }

  return lines.join("\n");
}

class InMemoryFakeBladeGitHubClient implements FakeBladeGitHubClient {
  private readonly pullRequests: Map<string, BladeGitHubPullRequestInspection>;
  private readonly publishedByIdempotencyKey = new Map<string, GitHubPublishReviewOutput>();
  private readonly publishedInputs: GitHubPublishReviewInput[] = [];

  constructor(options: FakeBladeGitHubClientOptions) {
    this.pullRequests = new Map(Object.entries(options.pullRequests ?? {}));
  }

  get publishedReviewCount(): number {
    return this.publishedInputs.length;
  }

  get publishedReviews(): readonly GitHubPublishReviewInput[] {
    return this.publishedInputs;
  }

  async inspectPullRequest(input: GitHubInspectPullRequestInput): Promise<BladeGitHubPullRequestInspection> {
    const key = pullRequestKey(input.owner, input.repository, input.pullNumber);
    return deepClone(this.pullRequests.get(key) ?? defaultPullRequestInspection(input));
  }

  async publishReview(input: GitHubPublishReviewInput): Promise<GitHubPublishReviewOutput> {
    const existing = this.publishedByIdempotencyKey.get(input.idempotencyKey);
    if (existing) {
      return { ...existing, deduplicated: true };
    }

    const reviewId = deterministicUuid(
      "fake-github-published-review",
      input.owner,
      input.repository,
      String(input.pullNumber),
      input.idempotencyKey,
    );
    const result = GitHubPublishReviewOutputSchema.parse({
      reviewUrl: `https://github.com/${input.owner}/${input.repository}/pull/${input.pullNumber}#pullrequestreview-${reviewId}`,
      publishedCommentIds: input.inlineComments.map((comment, index) => `${reviewId}:comment:${index}:${sha256(`${comment.path}:${comment.line}`)}`),
      idempotencyKey: input.idempotencyKey,
      deduplicated: false,
    });
    this.publishedByIdempotencyKey.set(input.idempotencyKey, result);
    this.publishedInputs.push(deepClone(input));
    return result;
  }
}

function defaultPullRequestInspection(input: GitHubInspectPullRequestInput): BladeGitHubPullRequestInspection {
  const htmlUrl = `https://github.com/${input.owner}/${input.repository}/pull/${input.pullNumber}`;
  const rawDiff = defaultLargeDiff();
  return {
    pullRequest: {
      owner: input.owner,
      repository: input.repository,
      number: input.pullNumber,
      title: "Harden review publishing path",
      body: `${"This body is intentionally longer than the thread event summary. ".repeat(40)}RAW_BODY_SENTINEL_DO_NOT_EMBED`,
      htmlUrl,
      baseRef: "main",
      baseSha: "8d2c4ef",
      headRef: "blade-review-fixture",
      headSha: "9f7a6bc",
      authorLogin: "octocat",
      isDraft: false,
    },
    changedFiles: [
      {
        path: "src/review-policy.ts",
        status: "modified",
        additions: 18,
        deletions: 3,
        patch: rawDiff,
        riskHints: [
          {
            severity: "warning",
            confidence: "high",
            summary: "Review publishing now trusts a caller-supplied allow flag without durable gate evidence.",
            line: 42,
            evidence: "Compact diff summary shows publishReview can run when allowPublish is true, but the gate result is not checked near the call site.",
          },
        ],
      },
    ],
    checkStatuses: [{ name: "typecheck", status: "success", targetUrl: `${htmlUrl}/checks` }],
    commentContext: [],
    resourceUrls: {
      pullRequest: htmlUrl,
      commits: `${htmlUrl}/commits`,
      checks: `${htmlUrl}/checks`,
    },
    rawDiff,
  };
}

function defaultLargeDiff(): string {
  const repeated = Array.from({ length: 320 }, (_, index) => {
    return `+// LARGE_DIFF_SENTINEL_DO_NOT_EMBED ${index.toString().padStart(3, "0")} gate result must be verified before publishReview`;
  });
  return [
    "diff --git a/src/review-policy.ts b/src/review-policy.ts",
    "index 1111111..2222222 100644",
    "--- a/src/review-policy.ts",
    "+++ b/src/review-policy.ts",
    "@@ -38,6 +38,24 @@ export function publishReview() {",
    ...repeated,
  ].join("\n");
}

function pullRequestKey(owner: string, repository: string, pullNumber: number): string {
  return `${owner}/${repository}#${pullNumber}`;
}

function deepClone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export const defaultBladeGitHubClient = createFakeBladeGitHubClient();
export const bladeReviewTools = createBladeReviewTools(defaultBladeGitHubClient);
export const githubInspectPullRequestTool = bladeReviewTools.githubInspectPullRequestTool;
export const bladeSynthesizeReviewTool = bladeReviewTools.bladeSynthesizeReviewTool;
export const githubPublishReviewTool = bladeReviewTools.githubPublishReviewTool;
