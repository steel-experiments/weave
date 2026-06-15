import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
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
const execFileAsync = promisify(execFile);

const SafeOpenCodeEnvAllowlist = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "COLORTERM", "NO_COLOR", "CI"] as const;
const MaintainerAllowedTools = ["repo.read", "repo.write.branch", "opencode.run", "bounded-shell"] as const;
const MaintainerDeniedTools = [
  "network",
  "secrets",
  "github.pr.create",
  "github.pr.merge",
  "git.branch.switch",
  "git.push",
  "external-workspace-write",
  "uncontrolled-shell",
] as const;

const ForbiddenOpenCodeCommandNames = new Set(["bash", "cmd", "fish", "powershell", "pwsh", "sh", "zsh"]);
const ForbiddenOpenCodeArgFlags = new Set([
  "--attach",
  "--command",
  "--continue",
  "--dangerously-skip-permissions",
  "--demo",
  "--file",
  "--fork",
  "--interactive",
  "--password",
  "--session",
  "--share",
  "--username",
]);
const SupportedOpenCodePermissionFlagArity = new Map<string, number>([
  ["--pure", 0],
  ["--no-replay", 0],
]);
const SupportedOpenCodeToolFlagArity = new Map<string, number>([["--agent", 1]]);

const EnvironmentVariableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const OpenCodeCliTokenSchema = NonEmptyStringSchema.refine((value) => !value.includes("\0"), "CLI arguments must not contain NUL bytes.");

const OpenCodeMaintainerPermissionProfileSchema = z
  .object({
    type: z.literal("maintainer-bounded"),
    name: NonEmptyStringSchema,
    allowNetwork: z.literal(false),
    allowSecrets: z.literal(false),
    allowPrPublishing: z.literal(false),
    allowBranchSwitching: z.literal(false),
    allowExternalWorkspaceWrites: z.literal(false),
    allowUncontrolledShell: z.literal(false),
    allowDangerouslySkipPermissions: z.literal(false),
    allowedTools: z.array(NonEmptyStringSchema).min(1),
    deniedTools: z.array(NonEmptyStringSchema).min(1),
    allowedPermissionRequests: z.array(NonEmptyStringSchema).default([]),
    cliPermissionFlags: z.array(OpenCodeCliTokenSchema).min(1),
    cliToolFlags: z.array(OpenCodeCliTokenSchema).default([]),
    envAllowlist: z.array(EnvironmentVariableNameSchema).min(1),
  })
  .strict()
  .superRefine((profile, ctx) => {
    if (!profile.cliPermissionFlags.includes("--pure")) {
      ctx.addIssue({ code: "custom", path: ["cliPermissionFlags"], message: "Maintainer OpenCode runs must include --pure." });
    }
    const secretEnvKeys = profile.envAllowlist.filter((key) => looksLikeSecretEnvKey(key));
    if (secretEnvKeys.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["envAllowlist"],
        message: `Maintainer profile must not allow secret-shaped environment keys: ${secretEnvKeys.join(", ")}.`,
      });
    }
  });

const OpenCodeTestOnlyUnsafePermissionProfileSchema = z
  .object({
    type: z.literal("test-only-unsafe"),
    name: z.literal("test-only-unsafe"),
    unsafeReason: NonEmptyStringSchema,
    allowNetwork: z.boolean().default(false),
    allowSecrets: z.boolean().default(false),
    allowPrPublishing: z.boolean().default(false),
    allowBranchSwitching: z.boolean().default(false),
    allowExternalWorkspaceWrites: z.boolean().default(false),
    allowUncontrolledShell: z.boolean().default(false),
    allowDangerouslySkipPermissions: z.boolean().default(false),
    allowedTools: z.array(NonEmptyStringSchema).default(["*"]),
    deniedTools: z.array(NonEmptyStringSchema).default([]),
    allowedPermissionRequests: z.array(NonEmptyStringSchema).default(["*"]),
    cliPermissionFlags: z.array(OpenCodeCliTokenSchema).default([]),
    cliToolFlags: z.array(OpenCodeCliTokenSchema).default([]),
    envAllowlist: z.array(EnvironmentVariableNameSchema).default([...SafeOpenCodeEnvAllowlist]),
  })
  .strict();

export const OpenCodePermissionProfileSchema = z.discriminatedUnion("type", [
  OpenCodeMaintainerPermissionProfileSchema,
  OpenCodeTestOnlyUnsafePermissionProfileSchema,
]);
export type OpenCodePermissionProfile = z.infer<typeof OpenCodePermissionProfileSchema>;
export type OpenCodeMaintainerPermissionProfile = z.infer<typeof OpenCodeMaintainerPermissionProfileSchema>;
export type OpenCodeTestOnlyUnsafePermissionProfile = z.infer<typeof OpenCodeTestOnlyUnsafePermissionProfileSchema>;

export function createMaintainerOpenCodePermissionProfile(
  overrides: Partial<z.input<typeof OpenCodeMaintainerPermissionProfileSchema>> = {},
): OpenCodeMaintainerPermissionProfile {
  return OpenCodeMaintainerPermissionProfileSchema.parse({
    type: "maintainer-bounded",
    name: "weave-maintainer-bounded",
    allowNetwork: false,
    allowSecrets: false,
    allowPrPublishing: false,
    allowBranchSwitching: false,
    allowExternalWorkspaceWrites: false,
    allowUncontrolledShell: false,
    allowDangerouslySkipPermissions: false,
    allowedTools: [...MaintainerAllowedTools],
    deniedTools: [...MaintainerDeniedTools],
    allowedPermissionRequests: [],
    cliPermissionFlags: ["--pure"],
    cliToolFlags: [],
    envAllowlist: [...SafeOpenCodeEnvAllowlist],
    ...overrides,
  });
}

export function createTestOnlyUnsafeOpenCodePermissionProfile(
  overrides: Partial<z.input<typeof OpenCodeTestOnlyUnsafePermissionProfileSchema>> = {},
): OpenCodeTestOnlyUnsafePermissionProfile {
  return OpenCodeTestOnlyUnsafePermissionProfileSchema.parse({
    type: "test-only-unsafe",
    name: "test-only-unsafe",
    unsafeReason: "Explicit test-only unsafe OpenCode profile override.",
    ...overrides,
  });
}

export const OpenCodeCliRunnerConfigSchema = z.object({
  command: NonEmptyStringSchema.default("opencode"),
  args: z.array(NonEmptyStringSchema).default(["run", "--format", "json"]),
  permissionProfile: OpenCodePermissionProfileSchema,
  promptDelivery: z.enum(["argument", "stdin", "both"]).default("argument"),
  cwdArg: z.union([NonEmptyStringSchema, z.literal(false)]).default("--dir"),
  timeoutMs: z.number().int().positive().default(600_000),
  maxOutputBytes: z.number().int().positive().default(256_000),
  env: z.record(EnvironmentVariableNameSchema, z.string()).optional(),
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
  gitChangedFilesBefore: z.array(NonEmptyStringSchema),
  gitChangedFilesAfter: z.array(NonEmptyStringSchema),
  gitChangedFilesOutsideWorkspaceBefore: z.array(NonEmptyStringSchema),
  gitChangedFilesOutsideWorkspaceAfter: z.array(NonEmptyStringSchema),
  gitWorkspaceRoot: NonEmptyStringSchema,
});
export type OpenCodeCommandResult = z.infer<typeof OpenCodeCommandResultSchema>;
type OpenCodeProcessResult = Omit<
  OpenCodeCommandResult,
  | "gitChangedFilesBefore"
  | "gitChangedFilesAfter"
  | "gitChangedFilesOutsideWorkspaceBefore"
  | "gitChangedFilesOutsideWorkspaceAfter"
  | "gitWorkspaceRoot"
>;
type GitChangedFilesSnapshot = {
  files: string[];
  outsideWorkspace: string[];
  gitRoot: string;
};

export class OpenCodeRunnerError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "OpenCodeRunnerError";
  }
}

export function buildOpenCodeChildEnv(
  rawProfile: OpenCodePermissionProfile,
  explicitEnv: Record<string, string> = {},
  parentEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const profile = OpenCodePermissionProfileSchema.parse(rawProfile);
  const allowedKeys = new Set(profile.envAllowlist);
  const childEnv: Record<string, string> = {};

  for (const key of allowedKeys) {
    const explicitValue = explicitEnv[key];
    const parentValue = parentEnv[key];
    const value = explicitValue ?? parentValue;
    if (value !== undefined) {
      childEnv[key] = value;
    }
  }

  return childEnv;
}

function parseOpenCodeCliRunnerConfig(rawConfig: OpenCodeCliRunnerConfig): z.infer<typeof OpenCodeCliRunnerConfigSchema> {
  const parsed = OpenCodeCliRunnerConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new DevelopmentBlockedRunnerError("OpenCode runner config is missing a safe explicit permission profile.", {
      error: parsed.error.flatten(),
    });
  }
  validateOpenCodeLaunchConfig(parsed.data);
  return parsed.data;
}

function validateOpenCodeLaunchConfig(config: z.infer<typeof OpenCodeCliRunnerConfigSchema>): void {
  const commandName = path.basename(config.command);
  if (ForbiddenOpenCodeCommandNames.has(commandName) && !isTestOnlyUnsafeProfile(config.permissionProfile)) {
    throw new DevelopmentBlockedRunnerError("OpenCode command must not be a broad shell executable.", { command: config.command });
  }

  validateNoForbiddenFlags(config.args, config.permissionProfile, "args");
  if (config.cwdArg !== false) {
    validateNoForbiddenFlags([config.cwdArg], config.permissionProfile, "cwdArg");
  }
  validateProfileFlagList(config.permissionProfile.cliPermissionFlags, SupportedOpenCodePermissionFlagArity, config.permissionProfile, "cliPermissionFlags");
  validateProfileFlagList(config.permissionProfile.cliToolFlags, SupportedOpenCodeToolFlagArity, config.permissionProfile, "cliToolFlags");

  if (commandName === "opencode") {
    if (config.args[0] !== "run") {
      throw new DevelopmentBlockedRunnerError("OpenCode command args must launch the bounded run subcommand.", { args: config.args });
    }
    if (!hasJsonFormatFlag(config.args)) {
      throw new DevelopmentBlockedRunnerError("OpenCode command args must request JSON output with --format json.", { args: config.args });
    }
  }
}

function validateNoForbiddenFlags(args: readonly string[], profile: OpenCodePermissionProfile, source: string): void {
  for (const arg of args) {
    const flag = flagName(arg);
    if (!flag.startsWith("--")) {
      continue;
    }
    if (ForbiddenOpenCodeArgFlags.has(flag) && !(flag === "--dangerously-skip-permissions" && allowsDangerouslySkipPermissions(profile))) {
      throw new DevelopmentBlockedRunnerError("OpenCode command args contain a forbidden flag.", { source, flag });
    }
  }
}

function validateProfileFlagList(
  args: readonly string[],
  supportedArity: ReadonlyMap<string, number>,
  profile: OpenCodePermissionProfile,
  source: string,
): void {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    const flag = flagName(arg);
    if (!flag.startsWith("--")) {
      throw new DevelopmentBlockedRunnerError("OpenCode profile flags must start with --.", { source, arg });
    }
    if (ForbiddenOpenCodeArgFlags.has(flag) && !(flag === "--dangerously-skip-permissions" && allowsDangerouslySkipPermissions(profile))) {
      throw new DevelopmentBlockedRunnerError("OpenCode profile contains a forbidden permission/tool flag.", { source, flag });
    }
    const arity = supportedArity.get(flag);
    if (arity === undefined) {
      throw new DevelopmentBlockedRunnerError("OpenCode profile contains an unsupported permission/tool flag.", { source, flag });
    }
    if (arity === 1 && !arg.includes("=")) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new DevelopmentBlockedRunnerError("OpenCode profile flag is missing its required value.", { source, flag });
      }
      index += 1;
    }
  }
}

function hasJsonFormatFlag(args: readonly string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--format") {
      return args[index + 1] === "json";
    }
    if (arg === "--format=json") {
      return true;
    }
  }
  return false;
}

function flagName(arg: string): string {
  return arg.split("=", 1)[0] ?? arg;
}

function allowsDangerouslySkipPermissions(profile: OpenCodePermissionProfile): boolean {
  return isTestOnlyUnsafeProfile(profile) && profile.allowDangerouslySkipPermissions === true;
}

function isTestOnlyUnsafeProfile(profile: OpenCodePermissionProfile): profile is OpenCodeTestOnlyUnsafePermissionProfile {
  return profile.type === "test-only-unsafe" && profile.name === "test-only-unsafe";
}

export function createOpenCodeCliImplementationRunner(config: OpenCodeCliRunnerConfig): OpenCodeImplementationRunner {
  return {
    async run(rawInput, context) {
      const input = OpenCodeImplementerInputSchema.parse(rawInput);
      assertWorkspaceMatchesBranch(input.branch, input.workspaceRef.workingBranch);
      const prompt = buildOpenCodeImplementationPrompt(input);
      const commandResult = await runOpenCodeCliCommand(config, input.workspaceRef.path, prompt, context);
      assertActualChangedFilesInScope(input.allowedFiles, commandResult, "implementation");
      const summary = parseOpenCodeJsonOutput(commandResult.stdout, ImplementationSummarySchema, "implementation summary");
      assertImplementationScope(input, summary);
      return ImplementationSummarySchema.parse({
        ...summary,
        filesChanged: uniqueStrings([...summary.filesChanged, ...commandResult.gitChangedFilesAfter]),
      });
    },
  };
}

export function createOpenCodeCliRepairRunner(config: OpenCodeCliRunnerConfig): RepairRunner {
  return {
    async run(rawInput, context) {
      const input = RepairAgentInputSchema.parse(rawInput);
      assertWorkspaceMatchesBranch(input.branch, input.workspaceRef.workingBranch);
      const prompt = buildOpenCodeRepairPrompt(input);
      const commandResult = await runOpenCodeCliCommand(config, input.workspaceRef.path, prompt, context);
      assertActualChangedFilesInScope(input.slice.allowedFiles, commandResult, "repair");
      const result = parseOpenCodeJsonOutput(commandResult.stdout, RepairResultSchema, "repair result");
      return RepairResultSchema.parse({
        ...result,
        branch: result.branch ?? input.branch,
        workspaceRef: result.workspaceRef ?? input.workspaceRef,
        filesChanged: uniqueStrings([...result.filesChanged, ...commandResult.gitChangedFilesAfter]),
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
    "The runner enforces a deny-by-default profile, sanitized environment, and actual Git diff scope check after you exit.",
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
    "The runner enforces a deny-by-default profile, sanitized environment, and actual Git diff scope check after you exit.",
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
    "Allowed files:",
    ...(input.slice.allowedFiles?.length ? input.slice.allowedFiles.map((file) => `- ${file}`) : ["- Not restricted by the slice input."]),
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
  const config = parseOpenCodeCliRunnerConfig(rawConfig);
  const startedAt = Date.now();
  const reportProgress = async (percent: number, message: string): Promise<void> => {
    await context.progress?.({ percent, message });
  };

  const profileArgs = [...config.permissionProfile.cliPermissionFlags, ...config.permissionProfile.cliToolFlags];
  const baseArgs = config.cwdArg === false ? [...config.args, ...profileArgs] : [...config.args, ...profileArgs, config.cwdArg, cwd];
  const commandArgs = config.promptDelivery === "stdin" ? baseArgs : [...baseArgs, prompt];
  const gitBefore = await captureGitChangedFiles(cwd);
  if (gitBefore.outsideWorkspace.length > 0) {
    throw new DevelopmentBlockedRunnerError("OpenCode workspace has Git changes outside the configured workspace root before launch.", {
      cwd,
      gitRoot: gitBefore.gitRoot,
      outsideWorkspace: gitBefore.outsideWorkspace,
    });
  }
  await reportProgress(1, `Starting OpenCode command: ${config.command} ${config.args.join(" ")}`);

  const processResult = await spawnOpenCodeCliProcess(config, commandArgs, cwd, prompt, startedAt, reportProgress);
  const gitAfter = await captureGitChangedFiles(cwd);
  const result = OpenCodeCommandResultSchema.parse({
    ...processResult,
    gitChangedFilesBefore: gitBefore.files,
    gitChangedFilesAfter: gitAfter.files,
    gitChangedFilesOutsideWorkspaceBefore: gitBefore.outsideWorkspace,
    gitChangedFilesOutsideWorkspaceAfter: gitAfter.outsideWorkspace,
    gitWorkspaceRoot: gitAfter.gitRoot,
  });

  if (result.gitChangedFilesOutsideWorkspaceAfter.length > 0) {
    throw new DevelopmentBlockedRunnerError("OpenCode changed files outside the configured workspace root.", result);
  }
  throwIfPermissionRequestBlocked(result, config.permissionProfile);
  if (result.exitCode !== 0) {
    if (openCodePermissionDenied(result)) {
      throw new DevelopmentBlockedRunnerError("OpenCode requires a permission that was auto-rejected.", result);
    }
    throw new OpenCodeRunnerError(`OpenCode command exited non-zero (${result.exitCode}). ${commandFailureSummary(result)}`, result);
  }
  await reportProgress(95, "OpenCode command completed; parsing structured JSON output.");
  return result;
}

function spawnOpenCodeCliProcess(
  config: z.infer<typeof OpenCodeCliRunnerConfigSchema>,
  commandArgs: string[],
  cwd: string,
  prompt: string,
  startedAt: number,
  reportProgress: (percent: number, message: string) => Promise<void>,
): Promise<OpenCodeProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.command, commandArgs, {
      cwd,
      env: buildOpenCodeChildEnv(config.permissionProfile, config.env),
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
      reject(new DevelopmentBlockedRunnerError("OpenCode command timed out; refusing to trust partial output.", { timeoutMs: config.timeoutMs, cwd }));
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
      resolve({
        command: config.command,
        args: commandArgs,
        cwd,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });

    child.stdin.end(config.promptDelivery === "argument" ? undefined : prompt);
  });
}

async function captureGitChangedFiles(cwd: string): Promise<GitChangedFilesSnapshot> {
  const workspaceRoot = path.resolve(cwd);
  let gitRoot: string;
  try {
    const rootResult = await execFileAsync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", maxBuffer: 64_000 });
    gitRoot = path.resolve(String(rootResult.stdout).trim());
  } catch (error) {
    throw new DevelopmentBlockedRunnerError("OpenCode workspace is not a Git worktree; refusing to run without diff enforcement.", {
      cwd,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const statusResult = await execFileAsync(
    "git",
    ["-C", cwd, "-c", "status.relativePaths=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
    { encoding: "utf8", maxBuffer: 2_000_000 },
  );
  const statusFiles = parseGitStatusFiles(String(statusResult.stdout));
  const files: string[] = [];
  const outsideWorkspace: string[] = [];

  for (const statusFile of statusFiles) {
    if (path.isAbsolute(statusFile)) {
      outsideWorkspace.push(statusFile);
      continue;
    }
    const absoluteFile = path.resolve(gitRoot, statusFile);
    const relativeToWorkspace = path.relative(workspaceRoot, absoluteFile);
    if (isPathOutsideRoot(relativeToWorkspace)) {
      outsideWorkspace.push(toPosixPath(statusFile));
      continue;
    }
    files.push(toPosixPath(relativeToWorkspace));
  }

  return {
    files: uniqueStrings(files),
    outsideWorkspace: uniqueStrings(outsideWorkspace),
    gitRoot,
  };
}

function parseGitStatusFiles(statusOutput: string): string[] {
  const records = statusOutput.split("\0").filter(Boolean);
  const files: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) {
      continue;
    }
    if (record.length < 4) {
      continue;
    }
    const status = record.slice(0, 2);
    const file = record.slice(3);
    if (file) {
      files.push(file);
    }
    if ((status.includes("R") || status.includes("C")) && records[index + 1]) {
      index += 1;
      const copiedFromOrRenamedFrom = records[index];
      if (copiedFromOrRenamedFrom) {
        files.push(copiedFromOrRenamedFrom);
      }
    }
  }
  return uniqueStrings(files);
}

function isPathOutsideRoot(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function throwIfPermissionRequestBlocked(result: OpenCodeCommandResult, profile: OpenCodePermissionProfile): void {
  const requests = extractOpenCodePermissionRequests(result);
  const blockedRequests = requests.filter((request) => !permissionRequestAllowed(request, profile));
  if (blockedRequests.length > 0) {
    throw new DevelopmentBlockedRunnerError("OpenCode requested permissions outside the configured profile.", {
      requests,
      blockedRequests,
      profile: profile.name,
    });
  }
  if (openCodePermissionDenied(result)) {
    throw new DevelopmentBlockedRunnerError("OpenCode requires a permission that was auto-rejected.", result);
  }
}

function extractOpenCodePermissionRequests(result: OpenCodeCommandResult): string[] {
  const output = `${result.stdout}\n${result.stderr}`;
  const requests: string[] = [];
  for (const match of output.matchAll(/permission request(?:ed)?\s*:\s*([^\r\n;]+)/gi)) {
    const request = singleLine(match[1] ?? "", 500);
    if (request) {
      requests.push(request);
    }
  }
  return uniqueStrings(requests);
}

function permissionRequestAllowed(request: string, profile: OpenCodePermissionProfile): boolean {
  return profile.allowedPermissionRequests.some((allowed) => allowed === "*" || request === allowed || request.startsWith(`${allowed} `));
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
    throw new DevelopmentBlockedRunnerError("Workspace branch does not match requested branch.", { branch, workspaceBranch });
  }
}

function assertActualChangedFilesInScope(allowedFiles: readonly string[] | undefined, result: OpenCodeCommandResult, label: "implementation" | "repair"): void {
  if (!allowedFiles?.length) {
    return;
  }
  const outOfScopeFiles = result.gitChangedFilesAfter.filter((changedFile) => !allowedFiles.some((allowedFile) => pathMatchesAllowedFile(changedFile, allowedFile)));
  if (outOfScopeFiles.length > 0) {
    throw new DevelopmentBlockedRunnerError(`OpenCode ${label} changed files outside allowed files.`, {
      outOfScopeFiles,
      allowedFiles,
      actualChangedFiles: result.gitChangedFilesAfter,
      reportedStdout: singleLine(result.stdout, 1_000),
    });
  }
}

function assertImplementationScope(input: OpenCodeImplementerInput, summary: ImplementationSummary): void {
  if (!input.allowedFiles?.length) {
    return;
  }
  const outOfScopeFiles = summary.filesChanged.filter((changedFile) => !input.allowedFiles?.some((allowedFile) => pathMatchesAllowedFile(changedFile, allowedFile)));
  if (outOfScopeFiles.length > 0) {
    throw new DevelopmentBlockedRunnerError("OpenCode reported changes outside allowed files.", { outOfScopeFiles });
  }
}

function pathMatchesAllowedFile(changedFile: string, allowedFile: string): boolean {
  const normalizedChanged = normalizeScopedRelativePath(changedFile);
  const normalizedAllowed = normalizeScopedRelativePath(allowedFile);
  if (!normalizedChanged || !normalizedAllowed) {
    return false;
  }
  return normalizedChanged === normalizedAllowed || (normalizedAllowed.endsWith("/") && normalizedChanged.startsWith(normalizedAllowed));
}

function normalizeScopedRelativePath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const withoutTrailingDirectoryMarker = normalized.endsWith("/") ? normalized : normalized.replace(/\/+$/, "");
  if (withoutTrailingDirectoryMarker.startsWith("/") || withoutTrailingDirectoryMarker === ".." || withoutTrailingDirectoryMarker.split("/").includes("..")) {
    return undefined;
  }
  return normalized;
}

function looksLikeSecretEnvKey(key: string): boolean {
  return /(^|_)(AUTH|CREDENTIAL|PASSWORD|PRIVATE|SECRET|TOKEN|API_KEY|ACCESS_KEY|SSH_AUTH_SOCK)(_|$)/i.test(key);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
