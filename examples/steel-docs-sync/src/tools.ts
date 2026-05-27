import { createHash } from "node:crypto";
import { defineTool } from "@agent-mailbox/core";
import { z } from "zod";

const SteelDocsAuditFindingSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  summary: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
});

const SteelDocsAuditArtifactSchema = z.object({
  kind: z.enum(["docs-page", "llms-txt", "openapi-spec"]),
  url: z.string().url(),
  mediaType: z.string().min(1),
  sha256: z.string().length(64),
  byteLength: z.number().int().nonnegative(),
});

const SteelDocsAuditDataSchema = z.object({
  repository: z.literal("steel-dev/docs"),
  mode: z.enum(["production-drift", "pull-request", "manual"]),
  outcome: z.enum(["passed", "warning", "failed"]),
  checkedUrls: z.array(z.string().url()).min(1),
  artifacts: z.array(SteelDocsAuditArtifactSchema).length(3),
  findings: z.array(SteelDocsAuditFindingSchema),
});

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
  output: z.object({
    summary: z.string().min(1),
    requiresManualApproval: z.literal(false),
    data: SteelDocsAuditDataSchema,
  }),
  async run({ progress, input }) {
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
      toArtifact("docs-page", docs),
      toArtifact("llms-txt", llms),
      toArtifact("openapi-spec", openApi),
    ];
    const outcome = findings.some((finding) => finding.severity === "critical")
      ? "failed"
      : findings.some((finding) => finding.severity === "warning")
        ? "warning"
        : "passed";
    const summary =
      findings.length === 0
        ? "Steel docs sync audit passed with no drift warnings."
        : `Steel docs sync audit found ${findings.length} ${findings.length === 1 ? "warning" : "warnings"} across llms.txt and API reference coverage.`;

    return {
      summary,
      requiresManualApproval: false,
      data: {
        repository: input.repository,
        mode: input.mode,
        outcome,
        checkedUrls: [input.docsBaseUrl, input.llmsTxtUrl, openApiUrl],
        artifacts,
        findings,
      },
    };
  },
});

export const steelTools = [steelAuditTool] as const;

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
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${url}`);
    }

    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    if (!Number.isNaN(contentLength) && contentLength > 256_000) {
      throw new Error(`Response too large for ${url}`);
    }

    return response;
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

function toArtifact(
  kind: z.infer<typeof SteelDocsAuditArtifactSchema>["kind"],
  source: FetchedSource,
): z.infer<typeof SteelDocsAuditArtifactSchema> {
  return {
    kind,
    url: source.url,
    mediaType: source.mediaType,
    sha256: source.sha256,
    byteLength: source.byteLength,
  };
}
