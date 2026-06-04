import { spawn } from "node:child_process";
import { z } from "zod";
import {
  ImplementationSummarySchema,
  OpenCodeImplementerInputSchema,
  RepairAgentInputSchema,
  RepairResultSchema,
  type ImplementationSummary,
  type OpenCodeImplementationRunner,
  type OpenCodeImplementerInput,
  type RepairAgentInput,
  type RepairResult,
  type RepairRunner,
} from "./development-orchestrator.js";

const NonEmptyStringSchema = z.string().min(1);

export const OpenCodeCliRunnerConfigSchema = z.object({
  command: NonEmptyStringSchema.default("opencode"),
  args: z.array(NonEmptyStringSchema).default(["run", "--json"]),
  timeoutMs: z.number().int().positive().default(600_000),
  maxOutputBytes: z.number().int().positive().default(256_000),
  env: z.record(z.string(), z.string()).optional(),
});
export type OpenCodeCliRunnerConfig = z.input<typeof OpenCodeCliRunnerConfigSchema>;

export const OpenCodeCommandResultSchema = z.object({
  command: NonEmptyStringSchema,
  args: z.array(NonEmptyStringSchema),
  cwd: NonEmptyStringSchema,
  exitCode: z.number().int().nullable(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative(),
});
export type OpenCodeCommandResult = z.infer<typeof OpenCodeCommandResultSchema>;

export class OpenCodeRunnerError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "OpenCodeRunnerError";
  }
}

export function createOpenCodeCliImplementationRunner(config: OpenCodeCliRunnerConfig = {}): OpenCodeImplementationRunner {
  return {
    async run(rawInput) {
      const input = OpenCodeImplementerInputSchema.parse(rawInput);
      assertWorkspaceMatchesBranch(input.branch, input.workspaceRef.workingBranch);
      const prompt = buildOpenCodeImplementationPrompt(input);
      const commandResult = await runOpenCodeCliCommand(config, input.workspaceRef.path, prompt);
      const summary = parseOpenCodeJsonOutput(commandResult.stdout, ImplementationSummarySchema, "implementation summary");
      assertImplementationScope(input, summary);
      return summary;
    },
  };
}

export function createOpenCodeCliRepairRunner(config: OpenCodeCliRunnerConfig = {}): RepairRunner {
  return {
    async run(rawInput) {
      const input = RepairAgentInputSchema.parse(rawInput);
      assertWorkspaceMatchesBranch(input.branch, input.workspaceRef.workingBranch);
      const prompt = buildOpenCodeRepairPrompt(input);
      const commandResult = await runOpenCodeCliCommand(config, input.workspaceRef.path, prompt);
      const result = parseOpenCodeJsonOutput(commandResult.stdout, RepairResultSchema, "repair result");
      return RepairResultSchema.parse({
        ...result,
        branch: result.branch ?? input.branch,
        workspaceRef: result.workspaceRef ?? input.workspaceRef,
      });
    },
  };
}

export function buildOpenCodeImplementationPrompt(rawInput: OpenCodeImplementerInput): string {
  const input = OpenCodeImplementerInputSchema.parse(rawInput);
  const lines = [
    "You are OpenCode running as a bounded implementation worker for Weave.",
    "Weave owns orchestration. You may implement only this one slice.",
    "Do not merge, open PRs, switch branches, access secrets, or write outside the workspace.",
    `Workspace path: ${input.workspaceRef.path}`,
    `Required branch: ${input.branch}`,
    `Slice: ${input.sliceId ?? input.sliceTitle}`,
    `Title: ${input.sliceTitle}`,
    "",
    "Objective:",
    input.objective,
    "",
    "Acceptance criteria:",
    ...input.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Constraints:",
    ...(input.constraints.length > 0 ? input.constraints.map((constraint) => `- ${constraint}`) : ["- No additional constraints supplied."]),
    "",
    "Allowed files:",
    ...(input.allowedFiles?.length ? input.allowedFiles.map((file) => `- ${file}`) : ["- Not restricted by the slice input." ]),
    "",
    "Return only JSON matching this shape:",
    JSON.stringify(
      {
        filesChanged: ["path/to/file.ts"],
        testsAdded: ["path/to/test.ts"],
        behaviorChanged: ["short behavior change"],
        docsChanged: ["path/to/doc.md"],
        knownLimitations: [],
        followUpSuggestions: [],
        summary: "short summary",
      },
      null,
      2,
    ),
  ];

  return lines.join("\n");
}

export function buildOpenCodeRepairPrompt(rawInput: RepairAgentInput): string {
  const input = RepairAgentInputSchema.parse(rawInput);
  const lines = [
    "You are OpenCode running as a bounded repair worker for Weave.",
    "Fix only the supplied verification failures and reviewer findings.",
    "Do not expand slice scope, merge, open PRs, switch branches, or access secrets.",
    `Workspace path: ${input.workspaceRef.path}`,
    `Required branch: ${input.branch}`,
    `Slice: ${input.slice.id}`,
    `Attempt: ${input.attempt} of ${input.maxAttempts}`,
    "",
    "Slice objective:",
    input.slice.objective,
    "",
    "Acceptance criteria:",
    ...input.slice.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Failing commands:",
    ...(input.failingCommands.length > 0
      ? input.failingCommands.map((command) => `- ${command.command}: ${command.summary}${command.output ? `\n  Output: ${command.output}` : ""}`)
      : ["- No failing commands supplied."]),
    "",
    "Reviewer findings:",
    ...(input.findings.length > 0
      ? input.findings.map((finding) => `- ${finding.severity}: ${finding.issue}${finding.file ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})` : ""}`)
      : ["- No reviewer findings supplied."]),
    "",
    "Return only JSON matching this shape:",
    JSON.stringify(
      {
        status: "completed",
        attempt: input.attempt,
        filesChanged: ["path/to/file.ts"],
        fixesAttempted: ["short fix"],
        findingsAddressed: [],
        limitations: [],
        summary: "short summary",
      },
      null,
      2,
    ),
  ];

  return lines.join("\n");
}

export async function runOpenCodeCliCommand(
  rawConfig: OpenCodeCliRunnerConfig,
  cwd: string,
  prompt: string,
): Promise<OpenCodeCommandResult> {
  const config = OpenCodeCliRunnerConfigSchema.parse(rawConfig);
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(config.command, config.args, {
      cwd,
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new OpenCodeRunnerError("OpenCode command timed out.", { timeoutMs: config.timeoutMs, cwd }));
    }, config.timeoutMs);

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const next = (target === "stdout" ? stdout : stderr) + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") > config.maxOutputBytes) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill("SIGTERM");
          reject(new OpenCodeRunnerError("OpenCode output exceeded maxOutputBytes.", { maxOutputBytes: config.maxOutputBytes, cwd }));
        }
        return;
      }
      if (target === "stdout") {
        stdout = next;
      } else {
        stderr = next;
      }
    };

    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new OpenCodeRunnerError("OpenCode command failed to start.", { cause: error.message, cwd }));
      }
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const result = OpenCodeCommandResultSchema.parse({
        command: config.command,
        args: config.args,
        cwd,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
      if (exitCode !== 0) {
        reject(new OpenCodeRunnerError("OpenCode command exited non-zero.", result));
        return;
      }
      resolve(result);
    });

    child.stdin.end(prompt);
  });
}

export function parseOpenCodeJsonOutput<Output>(stdout: string, schema: z.ZodType<Output>, label: string): Output {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch (error) {
    throw new OpenCodeRunnerError(`OpenCode ${label} output was not valid JSON.`, { cause: error instanceof Error ? error.message : String(error) });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new OpenCodeRunnerError(`OpenCode ${label} output failed schema validation.`, { error: result.error.flatten() });
  }
  return result.data;
}

function assertWorkspaceMatchesBranch(branch: string, workspaceBranch: string): void {
  if (branch !== workspaceBranch) {
    throw new OpenCodeRunnerError("Workspace branch does not match requested branch.", { branch, workspaceBranch });
  }
}

function assertImplementationScope(input: OpenCodeImplementerInput, summary: ImplementationSummary): void {
  if (!input.allowedFiles?.length) {
    return;
  }
  const outOfScopeFiles = summary.filesChanged.filter((changedFile) => !input.allowedFiles?.some((allowedFile) => pathMatchesAllowedFile(changedFile, allowedFile)));
  if (outOfScopeFiles.length > 0) {
    throw new OpenCodeRunnerError("OpenCode reported changes outside allowed files.", { outOfScopeFiles });
  }
}

function pathMatchesAllowedFile(changedFile: string, allowedFile: string): boolean {
  const normalizedChanged = changedFile.replace(/^\.\//, "");
  const normalizedAllowed = allowedFile.replace(/^\.\//, "");
  return normalizedChanged === normalizedAllowed || (normalizedAllowed.endsWith("/") && normalizedChanged.startsWith(normalizedAllowed));
}
