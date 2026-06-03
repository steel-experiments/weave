import { agent, capability, tool, type AgentContext, type AnyToolContract } from "weave";
import { z } from "zod";

export const repoReadCapability = capability({
  name: "repo.read",
  description: "Read repository files and documentation for claim verification.",
  scopes: z.object({ repository: z.string().min(1) }),
});

export const repoWriteCapability = capability({
  name: "repo.write",
  description: "Write repository files. Not available to the read-only workflow harness.",
  scopes: z.object({ repository: z.string().min(1) }),
});

export const networkAccessCapability = capability({
  name: "network.access",
  description: "Access external network resources. Policy-gated and disabled by default.",
  scopes: z.object({ host: z.string().min(1) }),
});

export const shellAccessCapability = capability({
  name: "shell.exec",
  description: "Execute shell commands. Policy-gated and disabled by default.",
  scopes: z.object({ commandClass: z.string().min(1) }),
});

const repoFiles = new Map<string, string>([
  [
    "docs/declarative-api.md",
    [
      "ctx.spawn creates child threads with lineage fields.",
      "ctx.join waits for child outputs and validates structured child output schemas.",
      "Request policies can require approval before a supported tool request is recorded.",
    ].join("\n"),
  ],
  [
    "src/thread-service.ts",
    [
      "ThreadService preserves parentThreadId, rootThreadId, parentScopeKey, and parentStepKey when starting child sessions.",
      "Child terminal events are mirrored back to the parent thread for joins.",
    ].join("\n"),
  ],
  [
    "src/agent-runner.ts",
    [
      "Policy approval gates are planned before tool.requested events are recorded.",
      "PolicyDeniedError records durable agent failure evidence for denied tool requests.",
    ].join("\n"),
  ],
  [
    "docs/slices/47-prompt-driven-workflow-example.md",
    [
      "The first prompt workflow example does not execute arbitrary model-generated JavaScript.",
      "The deterministic repo evidence catalog keeps CI reliable until a reusable OpenCode adapter ships.",
    ].join("\n"),
  ],
]);

export const RepoReadFileInputSchema = z.object({
  path: z.string().min(1),
});

export const RepoReadFileOutputSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

export const RepoSearchTextInputSchema = z.object({
  query: z.string().min(1),
});

export const RepoSearchTextOutputSchema = z.object({
  matches: z.array(
    z.object({
      path: z.string().min(1),
      line: z.number().int().positive(),
      text: z.string().min(1),
    }),
  ),
});

export type RepoSearchTextOutput = z.infer<typeof RepoSearchTextOutputSchema>;

export const repoReadFileTool = tool({
  name: "repo.readFile",
  description: "Read one repository file from the bounded demo catalog.",
  input: RepoReadFileInputSchema,
  output: RepoReadFileOutputSchema,
  capabilities: [repoReadCapability],
  summarize(output) {
    return `read ${output.path}`;
  },
  run(ctx) {
    return {
      path: ctx.input.path,
      content: repoFiles.get(ctx.input.path) ?? "",
    };
  },
});

export const repoSearchTextTool = tool({
  name: "repo.searchText",
  description: "Search repository text in the bounded demo catalog.",
  input: RepoSearchTextInputSchema,
  output: RepoSearchTextOutputSchema,
  capabilities: [repoReadCapability],
  summarize(output) {
    return `${output.matches.length} matches`;
  },
  run(ctx) {
    return searchRepoText(ctx.input.query);
  },
});

export type OpenCodeRepoTaskLimits = {
  maxToolCalls: number;
  timeoutMs: number;
};

export type OpenCodeRepoTaskTools = {
  searchText(key: string, query: string): Promise<RepoSearchTextOutput>;
  readFile(key: string, path: string): Promise<z.infer<typeof RepoReadFileOutputSchema>>;
};

export type OpenCodeRepoTaskOptions<Input, Output> = {
  name: string;
  description?: string;
  input: z.ZodType<Input>;
  output: z.ZodType<Output>;
  limits: OpenCodeRepoTaskLimits;
  runTask(input: Input, tools: OpenCodeRepoTaskTools): Promise<Output> | Output;
};

export function opencodeRepoTaskAgent<Input, Output>(options: OpenCodeRepoTaskOptions<Input, Output>) {
  return agent({
    name: options.name,
    description: options.description,
    input: options.input,
    output: options.output,
    tools: [repoSearchTextTool, repoReadFileTool] as const satisfies readonly AnyToolContract[],
    async run(ctx, input) {
      await ctx.checkpoint("opencode-harness-limits", () => options.limits);
      const startedAt = Date.now();
      let toolCalls = 0;
      const beforeTool = () => {
        toolCalls += 1;
        if (toolCalls > options.limits.maxToolCalls) {
          throw new Error(`OpenCode harness exceeded maxToolCalls=${options.limits.maxToolCalls}`);
        }
        if (Date.now() - startedAt > options.limits.timeoutMs) {
          throw new Error(`OpenCode harness exceeded timeoutMs=${options.limits.timeoutMs}`);
        }
      };
      const tools: OpenCodeRepoTaskTools = {
        searchText: async (key, query) => {
          beforeTool();
          return ctx.tool(key, repoSearchTextTool, { query });
        },
        readFile: async (key, path) => {
          beforeTool();
          return ctx.tool(key, repoReadFileTool, { path });
        },
      };
      return options.runTask(input, tools);
    },
  });
}

export function searchRepoText(query: string): RepoSearchTextOutput {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 5);
  const matches: RepoSearchTextOutput["matches"] = [];
  for (const [path, content] of repoFiles) {
    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const normalized = line.toLowerCase();
      if (terms.some((term) => normalized.includes(term))) {
        matches.push({ path, line: index + 1, text: line });
      }
    });
  }
  return { matches };
}

export function workflowCapabilityDecision(capabilityNames: readonly string[]): "allow" | "deny" | undefined {
  if (capabilityNames.some((name) => name !== "repo.read")) {
    return "deny";
  }
  return capabilityNames.includes("repo.read") ? "allow" : undefined;
}

export function hasMutableHarnessCapability(capabilityName: string): boolean {
  return capabilityName === repoWriteCapability.name || capabilityName === networkAccessCapability.name || capabilityName === shellAccessCapability.name;
}
