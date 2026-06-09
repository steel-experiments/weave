import { spawn } from "node:child_process";
import { z } from "zod";
import {
  ImplementationSummarySchema,
  DevelopmentBlockedRunnerError,
  OpenCodeImplementerInputSchema,
  RepairAgentInputSchema,
  RepairResultSchema,
  type ImplementationSummary,
  type DevelopmentRunnerContext,
  type OpenCodeImplementationRunner,
  type OpenCodeImplementerInput,
  type RepairAgentInput,
  type RepairResult,
  type RepairRunner,
} from "./development-orchestrator.js";

const NonEmptyStringSchema = z.string().min(1);

export const OpenCodeCliRunnerConfigSchema = z.object({
  command: NonEmptyStringSchema.default("opencode"),
  args: z.array(NonEmptyStringSchema).default(["run", "--format", "json"]),
  promptDelivery: z.enum(["argument", "stdin", "both"]).default("argument"),
  cwdArg: z.union([NonEmptyStringSchema, z.literal(false)]).default("--dir"),
  timeoutMs: z.number().int().positive().default(600_000),
  maxOutputBytes: z.number().int().positive().default(256_000),
  env: z.record(z.string(), z.string()).optional(),
  progressIntervalMs: z.number().int().positive().default(15_000),
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
    async run(rawInput, context) {
      const input = OpenCodeImplementerInputSchema.parse(rawInput);
      assertWorkspaceMatchesBranch(input.branch, input.workspaceRef.workingBranch);
      const prompt = buildOpenCodeImplementationPrompt(input);
      const commandResult = await runOpenCodeCliCommand(config, input.workspaceRef.path, prompt, context);
      throwIfPermissionDenied(commandResult, "OpenCode implementation requires permission that was auto-rejected.");
      const summary = parseOpenCodeJsonOutput(commandResult.stdout, ImplementationSummarySchema, "implementation summary");
      assertImplementationScope(input, summary);
      return summary;
    },
  };
}

export function createOpenCodeCliRepairRunner(config: OpenCodeCliRunnerConfig = {}): RepairRunner {
  return {
    async run(rawInput, context) {
      const input = RepairAgentInputSchema.parse(rawInput);
      assertWorkspaceMatchesBranch(input.branch, input.workspaceRef.workingBranch);
      const prompt = buildOpenCodeRepairPrompt(input);
      const commandResult = await runOpenCodeCliCommand(config, input.workspaceRef.path, prompt, context);
      throwIfPermissionDenied(commandResult, "OpenCode repair requires permission that was auto-rejected.");
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
    "Use relative paths from the current working directory. Do not use absolute workspace paths.",
    "Workspace: current working directory.",
    `Workspace id: ${input.workspaceRef.workspaceId}`,
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
    "Use relative paths from the current working directory. Do not use absolute workspace paths.",
    "Workspace: current working directory.",
    `Workspace id: ${input.workspaceRef.workspaceId}`,
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
  context: DevelopmentRunnerContext = {},
): Promise<OpenCodeCommandResult> {
  const config = OpenCodeCliRunnerConfigSchema.parse(rawConfig);
  const startedAt = Date.now();
  const reportProgress = async (percent: number, message: string): Promise<void> => {
    await context.progress?.({ percent, message });
  };

  const baseArgs = config.cwdArg === false ? config.args : [...config.args, config.cwdArg, cwd];
  const commandArgs = config.promptDelivery === "stdin" ? baseArgs : [...baseArgs, prompt];
  await reportProgress(1, `Starting OpenCode command: ${config.command} ${config.args.join(" ")}`);

  return new Promise((resolve, reject) => {
    const child = spawn(config.command, commandArgs, {
      cwd,
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const heartbeat = setInterval(() => {
      void reportProgress(5, `OpenCode still running after ${Math.round((Date.now() - startedAt) / 1000)}s.`);
    }, config.progressIntervalMs);
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(heartbeat);
      child.kill("SIGTERM");
      reject(new OpenCodeRunnerError("OpenCode command timed out.", { timeoutMs: config.timeoutMs, cwd }));
    }, config.timeoutMs);

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const next = (target === "stdout" ? stdout : stderr) + chunk.toString("utf8");
      if (Buffer.byteLength(next, "utf8") > config.maxOutputBytes) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          clearInterval(heartbeat);
          child.kill("SIGTERM");
          reject(new DevelopmentBlockedRunnerError("OpenCode output exceeded maxOutputBytes; inspect output or increase the configured bound.", { maxOutputBytes: config.maxOutputBytes, cwd }));
        }
        return;
      }
      if (target === "stdout") {
        stdout = next;
      } else {
        stderr = next;
        void reportProgress(5, `OpenCode stderr: ${singleLine(chunk.toString("utf8"), 500)}`);
      }
    };

    void reportProgress(2, `OpenCode process started in ${cwd}.`);
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        clearInterval(heartbeat);
        reject(new OpenCodeRunnerError("OpenCode command failed to start.", { cause: error.message, cwd }));
      }
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      const result = OpenCodeCommandResultSchema.parse({
        command: config.command,
        args: commandArgs,
        cwd,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
      if (exitCode !== 0) {
        if (openCodePermissionDenied(result)) {
          reject(new DevelopmentBlockedRunnerError("OpenCode requires a permission that was auto-rejected.", result));
          return;
        }
        reject(new OpenCodeRunnerError(`OpenCode command exited non-zero (${exitCode}). ${commandFailureSummary(result)}`, result));
        return;
      }
      void reportProgress(95, "OpenCode command completed; parsing structured JSON output.");
      resolve(result);
    });

    child.stdin.end(config.promptDelivery === "argument" ? undefined : prompt);
  });
}

function throwIfPermissionDenied(result: OpenCodeCommandResult, reason: string): void {
  if (openCodePermissionDenied(result)) {
    throw new DevelopmentBlockedRunnerError(reason, result);
  }
}

function openCodePermissionDenied(result: OpenCodeCommandResult): boolean {
  const output = `${result.stdout}\n${result.stderr}`;
  return /permission requested:[\s\S]*auto-rejecting/i.test(output) || /permission denied/i.test(output);
}

function commandFailureSummary(result: OpenCodeCommandResult): string {
  const output = singleLine(result.stderr || result.stdout, 1_000);
  return output ? `Output: ${output}` : "No output captured.";
}

function singleLine(value: string, maxLength: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > maxLength ? `${line.slice(0, maxLength)}...` : line;
}

export function parseOpenCodeJsonOutput<Output>(stdout: string, schema: z.ZodType<Output>, label: string): Output {
  const parsed = parseStrictJson(stdout) ?? parseOpenCodeJsonEventStream(stdout, schema);
  if (parsed === undefined) {
    throw new OpenCodeRunnerError(`OpenCode ${label} output was not valid JSON.`, { sample: singleLine(stdout, 1_000) });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new OpenCodeRunnerError(`OpenCode ${label} output failed schema validation.`, { error: result.error.flatten() });
  }
  return result.data;
}

function parseStrictJson(stdout: string): unknown | undefined {
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return undefined;
  }
}

function parseOpenCodeJsonEventStream<Output>(stdout: string, schema: z.ZodType<Output>): Output | undefined {
  for (const line of stdout.split(/\r?\n/).reverse()) {
    const event = parseStrictJson(line);
    if (event === undefined) {
      continue;
    }
    const candidate = findSchemaCandidate(event, schema);
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

function findSchemaCandidate<Output>(value: unknown, schema: z.ZodType<Output>, seen = new Set<unknown>()): Output | undefined {
  const direct = schema.safeParse(value);
  if (direct.success) {
    return direct.data;
  }

  if (typeof value === "string") {
    const fromText = parseJsonObjectFromText(value);
    if (fromText !== undefined) {
      const parsed = schema.safeParse(fromText);
      if (parsed.success) {
        return parsed.data;
      }
    }
    return undefined;
  }

  if (!value || typeof value !== "object" || seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  const entries = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const child of entries) {
    const candidate = findSchemaCandidate(child, schema, seen);
    if (candidate !== undefined) {
      return candidate;
    }
  }
  return undefined;
}

function parseJsonObjectFromText(text: string): unknown | undefined {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidates = [trimmed, ...(fenced ? [fenced] : []), substringBetween(trimmed, "{", "}")].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  for (const candidate of candidates) {
    const parsed = parseStrictJson(candidate);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function substringBetween(text: string, start: string, end: string): string | undefined {
  const first = text.indexOf(start);
  const last = text.lastIndexOf(end);
  return first >= 0 && last > first ? text.slice(first, last + 1) : undefined;
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
