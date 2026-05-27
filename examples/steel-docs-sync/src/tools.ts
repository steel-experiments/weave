import { defineTool } from "@agent-mailbox/core";
import { z } from "zod";

const SteelDocsAuditFindingSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  summary: z.string().min(1),
  evidence: z.array(z.string().min(1)).min(1),
});

const SteelDocsAuditDataSchema = z.object({
  repository: z.literal("steel-dev/docs"),
  mode: z.enum(["production-drift", "pull-request", "manual"]),
  outcome: z.enum(["passed", "warning", "failed"]),
  checkedUrls: z.array(z.string().url()).min(1),
  findings: z.array(SteelDocsAuditFindingSchema),
});

export const steelAuditTool = defineTool({
  name: "steel.auditDocsSync",
  description: "Run a deterministic Steel docs sync audit against fixture inputs.",
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
    await progress({ percent: 25, message: "Loaded fixture docs page fingerprint." });
    await progress({ percent: 60, message: "Compared llms.txt and API reference coverage." });
    await progress({ percent: 100, message: "Built deterministic audit summary." });

    return {
      summary: "Steel docs sync audit found 2 warnings across llms.txt and API reference coverage.",
      requiresManualApproval: false,
      data: {
        repository: input.repository,
        mode: input.mode,
        outcome: "warning",
        checkedUrls: [input.docsBaseUrl, input.llmsTxtUrl, input.openApiSpecUrl ?? "https://steel.dev/openapi.json"],
        findings: [
          {
            severity: "warning",
            summary: "llms.txt omits the API reference section that exists in the published docs navigation.",
            evidence: [
              "Fixture nav contains /reference/api/authentication.",
              "Fixture llms.txt does not mention /reference/api/authentication.",
            ],
          },
          {
            severity: "warning",
            summary: "OpenAPI spec exposes endpoints that are not linked from the current docs landing path.",
            evidence: [
              "Fixture OpenAPI includes /v1/agents/runs.",
              "Fixture docs landing path does not link to an agents runs reference page.",
            ],
          },
        ],
      },
    };
  },
});

export const steelTools = [steelAuditTool] as const;

export type SteelToolName = (typeof steelTools)[number]["name"];
