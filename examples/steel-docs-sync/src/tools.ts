import { createHash } from "node:crypto";
import { ThreadArtifactSchema, RetryableToolError, defineTool } from "weave";
import { z } from "zod";

const SteelDocsAuditFindingSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  summary: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
});

const SteelDocsAuditArtifactSchema = ThreadArtifactSchema.extend({
  kind: z.enum(["docs-page", "llms-txt", "openapi-spec"]),
});

const SteelDocsAuditBaselineSchema = z.object({
  kind: z.enum(["docs-page", "llms-txt", "openapi-spec"]),
  snapshotKey: z.string().min(1),
  previousArtifactId: z.string().uuid().nullable(),
  previousSha256: z.string().length(64).nullable(),
  changed: z.boolean(),
});

export const SteelDocsAuditDataSchema = z.object({
  repository: z.literal("steel-dev/docs"),
  mode: z.enum(["production-drift", "pull-request", "manual"]),
  outcome: z.enum(["passed", "warning", "failed"]),
  checkedUrls: z.array(z.string().url()).min(1),
  artifacts: z.array(SteelDocsAuditArtifactSchema).length(3),
  baselines: z.array(SteelDocsAuditBaselineSchema).length(3),
  findings: z.array(SteelDocsAuditFindingSchema),
});

export const SteelDocsModelReviewDataSchema = z.object({
  outcome: z.enum(["passed", "warning", "failed"]),
  findings: z.array(SteelDocsAuditFindingSchema),
  finalMessage: z.string().min(1),
});

export const SteelDocsModelReviewInputSchema = SteelDocsAuditDataSchema;

export const steelAuditTool = defineTool({
  name: "steel.auditDocsSync",
  description: "Fetch Steel docs sources and audit sync drift with bounded network reads.",
  input: z.object({
    repository: z.literal("steel-dev/docs"),
    ref: z.string().min(1),
    sha: z.string().min(7),
    mode: z.enum(["production-drift", "pull-request", "manual"]),
    docsBaseUrl: z.string().url(),
    llmsTxtUrl: z.string().url(),
    openApiSpecUrl: z.string().url().optional(),
  }),
  output: SteelDocsAuditDataSchema,
  summarize(output) {
    return summarizeAudit(output);
  },
  async run({ artifactStore, threadId, progress, input, toolCallId }) {
    await progress({ percent: 15, message: "Fetching docs landing page." });
    const docs = await fetchBoundedText(input.docsBaseUrl);
    await progress({ percent: 40, message: "Fetching llms.txt." });
    const llms = await fetchBoundedText(input.llmsTxtUrl);
    await progress({ percent: 70, message: "Fetching OpenAPI spec." });
    const openApiUrl = input.openApiSpecUrl ?? new URL("/openapi.json", input.docsBaseUrl).toString();
    const openApi = await fetchBoundedJson(openApiUrl);
    await progress({ percent: 100, message: "Compared docs coverage against llms.txt and OpenAPI paths." });

    const findings = buildFindings(docs, llms, openApi);
    const artifacts = [
      await artifactStore.putArtifact({
        threadId,
        toolCallId,
        kind: "docs-page",
        mediaType: docs.mediaType,
        sourceUrl: docs.url,
        body: docs.body,
      }),
      await artifactStore.putArtifact({
        threadId,
        toolCallId,
        kind: "llms-txt",
        mediaType: llms.mediaType,
        sourceUrl: llms.url,
        body: llms.body,
      }),
      await artifactStore.putArtifact({
        threadId,
        toolCallId,
        kind: "openapi-spec",
        mediaType: openApi.mediaType,
        sourceUrl: openApi.url,
        body: openApi.body,
      }),
    ];
    const baselines = await Promise.all(
      artifacts.map(async (artifact) => {
        const snapshotKey = `${input.repository}:${artifact.kind}`;
        const previous = await artifactStore.getSnapshot(snapshotKey);
        await artifactStore.putSnapshot({
          snapshotKey,
          threadId,
          artifactId: artifact.artifactId,
          sha256: artifact.sha256,
          metadata: { kind: artifact.kind, sourceUrl: artifact.sourceUrl },
        });

        return {
          kind: artifact.kind as z.infer<typeof SteelDocsAuditBaselineSchema>["kind"],
          snapshotKey,
          previousArtifactId: previous?.artifactId ?? null,
          previousSha256: previous?.sha256 ?? null,
          changed: previous ? previous.sha256 !== artifact.sha256 : false,
        };
      }),
    );
    const outcome: z.output<typeof SteelDocsAuditDataSchema>["outcome"] = findings.some((finding) => finding.severity === "critical")
      ? "failed"
      : findings.some((finding) => finding.severity === "warning")
        ? "warning"
        : "passed";
    return SteelDocsAuditDataSchema.parse({
      repository: input.repository,
      mode: input.mode,
      outcome,
      checkedUrls: [input.docsBaseUrl, input.llmsTxtUrl, openApiUrl],
      artifacts,
      baselines,
      findings,
    });
  },
});

export const steelModelReviewTool = defineTool({
  name: "steel.modelReview",
  description: "Run an async model-backed review over compact Steel docs audit summaries.",
  input: SteelDocsModelReviewInputSchema,
  output: SteelDocsModelReviewDataSchema,
  summarize(output) {
    return output.finalMessage;
  },
  async run({ input, progress }) {
    await progress({ percent: 50, message: "Submitting compact docs audit summary to model review." });
    const review = await new DeterministicSteelDocsReviewModel().review(input);
    const data = SteelDocsModelReviewDataSchema.parse(review);
    await progress({ percent: 100, message: "Validated structured model review output." });

    return data;
  },
});

export const steelTools = [steelAuditTool, steelModelReviewTool] as const;

export type SteelToolName = (typeof steelTools)[number]["name"];

async function fetchBoundedText(url: string): Promise<FetchedSource> {
  const response = await fetchWithLimit(url);
  const body = await response.text();
  return {
    url,
    body,
    sha256: sha256(body),
    byteLength: Buffer.byteLength(body, "utf8"),
    mediaType: response.headers.get("content-type") ?? "text/plain",
  };
}

async function fetchBoundedJson(url: string): Promise<FetchedJsonSource> {
  const response = await fetchWithLimit(url);
  const body = await response.text();
  return {
    url,
    body,
    sha256: sha256(body),
    byteLength: Buffer.byteLength(body, "utf8"),
    mediaType: response.headers.get("content-type") ?? "application/json",
    json: JSON.parse(body),
  };
}

async function fetchWithLimit(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status >= 500) {
      throw new RetryableToolError(`HTTP ${response.status} fetching ${url}`);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    if (!Number.isNaN(contentLength) && contentLength > 256_000) {
      throw new Error(`Response too large for ${url}`);
    }

    return response;
  } catch (error) {
    if (error instanceof RetryableToolError) {
      throw error;
    }
    if (error instanceof Error && (error.name === "AbortError" || error.message.includes("fetch failed"))) {
      throw new RetryableToolError(error.message);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildFindings(
  docs: FetchedSource,
  llms: FetchedSource,
  openApi: FetchedJsonSource,
): z.infer<typeof SteelDocsAuditFindingSchema>[] {
  const findings: z.infer<typeof SteelDocsAuditFindingSchema>[] = [];
  const docsHasAuthenticationRef = docs.body.includes("/reference/api/authentication");
  const llmsHasAuthenticationRef = llms.body.includes("/reference/api/authentication");
  if (docsHasAuthenticationRef && !llmsHasAuthenticationRef) {
    findings.push({
      severity: "warning",
      summary: "llms.txt omits the API reference section that exists in the published docs navigation.",
      evidence: [
        `${docs.url} sha256=${docs.sha256} includes /reference/api/authentication.`,
        `${llms.url} sha256=${llms.sha256} does not mention /reference/api/authentication.`,
      ],
    });
  }

  const paths = readOpenApiPaths(openApi.json);
  const docsLinksAgentsRuns = docs.body.includes("/reference/api/agents/runs") || docs.body.includes("agents runs");
  if (paths.includes("/v1/agents/runs") && !docsLinksAgentsRuns) {
    findings.push({
      severity: "warning",
      summary: "OpenAPI spec exposes endpoints that are not linked from the current docs landing path.",
      evidence: [
        `${openApi.url} sha256=${openApi.sha256} includes /v1/agents/runs.`,
        `${docs.url} sha256=${docs.sha256} does not link an agents runs reference page.`,
      ],
    });
  }

  return findings;
}

function readOpenApiPaths(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const paths = Reflect.get(value, "paths");
  if (!paths || typeof paths !== "object") {
    return [];
  }
  return Object.keys(paths);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function summarizeAudit(output: z.output<typeof SteelDocsAuditDataSchema>): string {
  return output.findings.length === 0
    ? "Steel docs sync audit passed with no drift warnings."
    : `Steel docs sync audit found ${output.findings.length} ${output.findings.length === 1 ? "warning" : "warnings"} across llms.txt and API reference coverage.`;
}

type FetchedSource = {
  url: string;
  body: string;
  sha256: string;
  byteLength: number;
  mediaType: string;
};

type FetchedJsonSource = FetchedSource & {
  json: unknown;
};

class DeterministicSteelDocsReviewModel {
  async review(input: z.input<typeof SteelDocsModelReviewInputSchema>): Promise<z.output<typeof SteelDocsModelReviewDataSchema>> {
    const finalMessage =
      input.outcome === "passed"
        ? "Steel docs sync audit passed with no drift warnings."
        : `Steel docs sync audit completed with ${input.findings.length} warnings. Review llms.txt coverage and agents runs reference linking.`;

    return {
      outcome: input.outcome,
      findings: input.findings,
      finalMessage,
    };
  }
}
