import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import {
  capability,
  isCapabilityRequest,
  normalizeCapabilityDeclarations,
  type AnyCapabilityRequest,
  type CapabilityDeclaration,
} from "./capability-contract.js";
import { WorkspaceRefSchema, type WorkspaceRef } from "./workspace-provider.js";

const execFileAsync = promisify(execFile);
const NonEmptyStringSchema = z.string().min(1).refine((value) => !value.includes("\0"), "Value must not contain NUL bytes.");
const EnvironmentVariableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const CliTokenSchema = NonEmptyStringSchema;

const SafeOpenCodeEnvAllowlist = [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "CI",
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
const SupportedOpenCodeToolFlagArity = new Map<string, number>([
  ["--agent", 1],
  ["--model", 1],
]);

export type OpenCodeAdapterErrorCode =
  | "UNSAFE_PROFILE"
  | "UNSAFE_CONFIG"
  | "UNSAFE_ARGS"
  | "UNSAFE_ENV"
  | "WORKSPACE_INVALID"
  | "PERMISSION_REQUEST_BLOCKED"
  | "PERMISSION_DENIED"
  | "TIMEOUT"
  | "ABORTED"
  | "MAX_OUTPUT_EXCEEDED"
  | "START_FAILED"
  | "NON_ZERO_EXIT"
  | "INVALID_JSON"
  | "INVALID_SCHEMA"
  | "OUT_OF_SCOPE_DIFF";

export class OpenCodeAdapterError extends Error {
  constructor(
    readonly code: OpenCodeAdapterErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "OpenCodeAdapterError";
  }
}

export type OpenCodePathPermission = {
  enabled: boolean;
  allowedPaths: string[];
};

export type OpenCodeShellPermission = {
  enabled: boolean;
  commands: string[];
};

export type OpenCodeNetworkPermission = {
  enabled: boolean;
  allowedHosts: string[];
};

export type OpenCodeSecretsPermission = {
  enabled: boolean;
  names: string[];
};

export type OpenCodeGitPermission = {
  allowCommit: boolean;
  allowBranchSwitch: boolean;
  allowPush: boolean;
};

export type OpenCodePermissionProfileTools = {
  readFiles: OpenCodePathPermission;
  writeFiles: OpenCodePathPermission;
  shell: OpenCodeShellPermission;
  network: OpenCodeNetworkPermission;
  secrets: OpenCodeSecretsPermission;
  git: OpenCodeGitPermission;
};

export type OpenCodeReadFilesPermissionInput = boolean | { allowedPaths?: readonly string[] };
export type OpenCodeWriteFilesPermissionInput = false | { allowedPaths: readonly string[] };
export type OpenCodeShellPermissionInput = false | { commands: readonly string[] };
export type OpenCodeNetworkPermissionInput = boolean | { allowedHosts?: readonly string[] };
export type OpenCodeSecretsPermissionInput = boolean | { names?: readonly string[] };
export type OpenCodeGitPermissionInput = false | Partial<OpenCodeGitPermission>;

export type OpenCodeToolPermissionInput = {
  readFiles?: OpenCodeReadFilesPermissionInput;
  writeFiles?: OpenCodeWriteFilesPermissionInput;
  shell?: OpenCodeShellPermissionInput;
  network?: OpenCodeNetworkPermissionInput;
  secrets?: OpenCodeSecretsPermissionInput;
  git?: OpenCodeGitPermissionInput;
};

export type OpenCodeExposedToolInput = {
  name: string;
  description?: string;
  capabilities: CapabilityDeclaration | readonly CapabilityDeclaration[];
  allowedPermissionRequests?: readonly string[];
  cliToolFlags?: readonly string[];
};

export type OpenCodeExposedTool = {
  name: string;
  description?: string;
  capabilities: CapabilityDeclaration[];
  allowedPermissionRequests: string[];
  cliToolFlags: string[];
};

export type OpenCodePermissionProfileInput = {
  name?: string;
  workspace?: WorkspaceRef;
  tools?: OpenCodeToolPermissionInput;
  envAllowlist?: readonly string[];
  allowedPermissionRequests?: readonly string[];
  cliPermissionFlags?: readonly string[];
  cliToolFlags?: readonly string[];
  exposedTools?: readonly OpenCodeExposedToolInput[];
};

export type OpenCodePermissionProfile = {
  type: "weave-opencode";
  name: string;
  workspace?: WorkspaceRef;
  tools: OpenCodePermissionProfileTools;
  envAllowlist: string[];
  allowedPermissionRequests: string[];
  cliPermissionFlags: string[];
  cliToolFlags: string[];
  exposedTools: OpenCodeExposedTool[];
  capabilityDeclarations: CapabilityDeclaration[];
};

export const OpenCodeCliConfigSchema = z
  .object({
    command: CliTokenSchema.default("opencode"),
    args: z.array(CliTokenSchema).default(["run", "--format", "json"]),
    cwdArg: z.union([CliTokenSchema, z.literal(false)]).default("--dir"),
    promptDelivery: z.enum(["argument", "stdin", "both"]).default("argument"),
    timeoutMs: z.number().int().positive().default(600_000),
    maxStdoutBytes: z.number().int().positive().default(256_000),
    maxStderrBytes: z.number().int().positive().default(128_000),
    maxOutputBytes: z.number().int().positive().default(256_000),
    env: z.record(EnvironmentVariableNameSchema, z.string()).default({}),
    progressIntervalMs: z.number().int().positive().default(15_000),
  })
  .strict();
export type OpenCodeCliConfig = z.input<typeof OpenCodeCliConfigSchema>;
export type ParsedOpenCodeCliConfig = z.output<typeof OpenCodeCliConfigSchema>;

export type OpenCodeRunnerContext = {
  progress?: (event: { percent: number; message: string }) => Promise<void> | void;
  signal?: AbortSignal;
  parentEnv?: NodeJS.ProcessEnv;
};

export const OpenCodeRunInputSchema = z
  .object({
    prompt: NonEmptyStringSchema,
    workspace: z.union([WorkspaceRefSchema, NonEmptyStringSchema]).optional(),
    allowedPaths: z.array(NonEmptyStringSchema).optional(),
  })
  .strict();
export type OpenCodeRunInput = z.input<typeof OpenCodeRunInputSchema>;
export type ParsedOpenCodeRunInput = z.output<typeof OpenCodeRunInputSchema>;

export const OpenCodeCommandResultSchema = z.object({
  command: NonEmptyStringSchema,
  args: z.array(NonEmptyStringSchema),
  cwd: NonEmptyStringSchema,
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
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

export type OpenCodeCliCommandConfig = {
  profile: OpenCodePermissionProfile;
  cli?: OpenCodeCliConfig;
};

export type OpenCodeCliCommandInput = {
  cwd: string;
  prompt: string;
  allowedPaths?: readonly string[];
};

export type OpenCodeRunResult<Output> = {
  output: Output;
  command: OpenCodeCommandResult;
  changedFiles: string[];
  capabilityDeclarations: CapabilityDeclaration[];
};

export type OpenCodeCliAdapterOptions<Output> = {
  profile: OpenCodePermissionProfile;
  output: z.ZodType<Output>;
  cli?: OpenCodeCliConfig;
  outputLabel?: string;
};

export type OpenCodeCliAdapter<Output> = {
  profile: OpenCodePermissionProfile;
  capabilities: readonly CapabilityDeclaration[];
  run(input: OpenCodeRunInput, context?: OpenCodeRunnerContext): Promise<OpenCodeRunResult<Output>>;
};

export const opencodeRunCapability = capability({
  name: "opencode.run",
  description: "Run OpenCode through a bounded Weave adapter profile.",
  params: z.object({ profileName: NonEmptyStringSchema, workspaceId: NonEmptyStringSchema.optional() }),
  scope(params) {
    return { resource: params.workspaceId, permissions: ["opencode:run"] };
  },
});

export const opencodeWorkspaceReadCapability = capability({
  name: "opencode.workspace.read",
  description: "Allow OpenCode to read files under a configured workspace profile.",
  params: z.object({ workspaceId: NonEmptyStringSchema.optional(), allowedPaths: z.array(NonEmptyStringSchema) }),
  scope(params) {
    return { resource: params.workspaceId, permissions: params.allowedPaths.map((allowedPath) => `workspace:read:${allowedPath}`) };
  },
});

export const opencodeWorkspaceWriteCapability = capability({
  name: "opencode.workspace.write",
  description: "Allow OpenCode to write files under explicit workspace path bounds.",
  params: z.object({ workspaceId: NonEmptyStringSchema.optional(), allowedPaths: z.array(NonEmptyStringSchema).min(1) }),
  scope(params) {
    return { resource: params.workspaceId, permissions: params.allowedPaths.map((allowedPath) => `workspace:write:${allowedPath}`) };
  },
});

export const opencodeShellCapability = capability({
  name: "opencode.shell",
  description: "Allow OpenCode to request explicitly named bounded shell commands.",
  params: z.object({ commands: z.array(NonEmptyStringSchema).min(1) }),
  scope(params) {
    return { permissions: params.commands.map((command) => `shell:${command}`) };
  },
});

export const opencodeNetworkCapability = capability({
  name: "opencode.network",
  description: "Allow OpenCode to request external network access through an explicit profile.",
  params: z.object({ allowedHosts: z.array(NonEmptyStringSchema) }),
  scope(params) {
    return { permissions: params.allowedHosts.map((host) => `network:${host}`) };
  },
});

export const opencodeSecretsCapability = capability({
  name: "opencode.secrets",
  description: "Allow OpenCode to receive explicitly named secret material.",
  params: z.object({ names: z.array(NonEmptyStringSchema) }),
  scope(params) {
    return { permissions: params.names.map((name) => `secret:${name}`) };
  },
});

export const opencodeGitCapability = capability({
  name: "opencode.git",
  description: "Allow OpenCode to request explicit Git write operations.",
  params: z.object({ allowCommit: z.boolean(), allowBranchSwitch: z.boolean(), allowPush: z.boolean() }),
  scope(params) {
    return {
      permissions: [
        ...(params.allowCommit ? ["git:commit"] : []),
        ...(params.allowBranchSwitch ? ["git:branch-switch"] : []),
        ...(params.allowPush ? ["git:push"] : []),
      ],
    };
  },
});

export function defaultOpenCodeEnvAllowlist(): readonly string[] {
  return [...SafeOpenCodeEnvAllowlist];
}

export function opencodeDenyAllPermissionProfile(overrides: Omit<OpenCodePermissionProfileInput, "tools"> = {}): OpenCodePermissionProfile {
  return opencodePermissionProfile({ ...overrides, tools: {} });
}

export function opencodePermissionProfile(input: OpenCodePermissionProfileInput = {}): OpenCodePermissionProfile {
  const workspace = input.workspace ? WorkspaceRefSchema.parse(input.workspace) : undefined;
  const exposedTools = normalizeExposedTools(input.exposedTools ?? []);
  const tools = normalizeToolPermissions(input.tools ?? {});
  const envAllowlist = uniqueStrings(input.envAllowlist ? input.envAllowlist.map(validateEnvironmentVariableName) : [...SafeOpenCodeEnvAllowlist]);
  const cliPermissionFlags = uniqueStrings(input.cliPermissionFlags ? input.cliPermissionFlags.map(validateCliToken) : ["--pure"]);
  const cliToolFlags = uniqueStrings([
    ...(input.cliToolFlags ? input.cliToolFlags.map(validateCliToken) : []),
    ...exposedTools.flatMap((tool) => tool.cliToolFlags),
  ]);
  const allowedPermissionRequests = uniqueStrings([
    ...allowedPermissionRequestsForTools(tools),
    ...(input.allowedPermissionRequests ? input.allowedPermissionRequests.map(validateCliToken) : []),
    ...exposedTools.flatMap((tool) => tool.allowedPermissionRequests),
  ]);
  const builtInCapabilityRequests = createBuiltInCapabilityRequests(input.name ?? "weave-opencode-deny-default", workspace, tools);
  const capabilityDeclarations = [
    ...builtInCapabilityRequests,
    ...exposedTools.flatMap((tool) => tool.capabilities),
  ];
  const profile: OpenCodePermissionProfile = {
    type: "weave-opencode",
    name: input.name ?? "weave-opencode-deny-default",
    ...(workspace ? { workspace } : {}),
    tools,
    envAllowlist,
    allowedPermissionRequests,
    cliPermissionFlags,
    cliToolFlags,
    exposedTools,
    capabilityDeclarations,
  };

  return validateOpenCodePermissionProfile(profile);
}

export function openCodeCapabilityRequestsForProfile(profile: OpenCodePermissionProfile): AnyCapabilityRequest[] {
  const normalized = validateOpenCodePermissionProfile(profile);
  return normalized.capabilityDeclarations.filter(isCapabilityRequest);
}

export function validateOpenCodePermissionProfile(profile: OpenCodePermissionProfile): OpenCodePermissionProfile {
  if (!profile || typeof profile !== "object" || profile.type !== "weave-opencode") {
    fail("UNSAFE_PROFILE", "OpenCode adapter requires an explicit weave-opencode permission profile.", { profileType: typeof profile });
  }
  validateCliToken(profile.name);
  if (profile.workspace) {
    WorkspaceRefSchema.parse(profile.workspace);
  }
  validatePathPatterns(profile.tools.readFiles.allowedPaths, "readFiles.allowedPaths");
  validatePathPatterns(profile.tools.writeFiles.allowedPaths, "writeFiles.allowedPaths");
  if (profile.tools.writeFiles.enabled && profile.tools.writeFiles.allowedPaths.length === 0) {
    fail("UNSAFE_PROFILE", "OpenCode writeFiles permission requires explicit allowedPaths.", { profile: profile.name });
  }
  for (const command of profile.tools.shell.commands) {
    validateBoundedShellCommand(command);
  }
  if (profile.tools.shell.enabled && profile.tools.shell.commands.length === 0) {
    fail("UNSAFE_PROFILE", "OpenCode shell permission requires explicit commands.", { profile: profile.name });
  }
  for (const key of profile.envAllowlist) {
    validateEnvironmentVariableName(key);
  }
  if (!profile.tools.secrets.enabled) {
    const secretKeys = profile.envAllowlist.filter(looksLikeSecretEnvKey);
    if (secretKeys.length > 0) {
      fail("UNSAFE_PROFILE", "OpenCode profile cannot allow secret-shaped environment keys unless secrets are enabled.", {
        profile: profile.name,
        secretKeys,
      });
    }
  }
  validateProfileFlagList(profile.cliPermissionFlags, SupportedOpenCodePermissionFlagArity, "cliPermissionFlags");
  validateProfileFlagList(profile.cliToolFlags, SupportedOpenCodeToolFlagArity, "cliToolFlags");
  if (!profile.cliPermissionFlags.includes("--pure")) {
    fail("UNSAFE_PROFILE", "OpenCode profiles must include --pure permission mode.", { profile: profile.name });
  }
  for (const exposedTool of profile.exposedTools) {
    if (normalizeCapabilityDeclarations(exposedTool.capabilities).length === 0) {
      fail("UNSAFE_PROFILE", "OpenCode-exposed tools must declare corresponding Weave capabilities.", { tool: exposedTool.name });
    }
  }
  return profile;
}

export function buildOpenCodeChildEnv(
  profile: OpenCodePermissionProfile,
  explicitEnv: Record<string, string> = {},
  parentEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const safeProfile = validateOpenCodePermissionProfile(profile);
  validateExplicitEnvAllowed(safeProfile, explicitEnv);
  const allowedKeys = new Set(safeProfile.envAllowlist);
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

export function createOpenCodeCliAdapter<Output>(options: OpenCodeCliAdapterOptions<Output>): OpenCodeCliAdapter<Output> {
  const profile = validateOpenCodePermissionProfile(options.profile);
  const cli = parseOpenCodeCliConfig(options.cli ?? {}, profile);
  const output = options.output;
  const outputLabel = options.outputLabel ?? "run output";

  return {
    profile,
    capabilities: profile.capabilityDeclarations,
    async run(rawInput, context = {}) {
      const input = parseOpenCodeRunInput(rawInput);
      const workspaceRoot = await resolveWorkspaceRoot(profile, input.workspace);
      const command = await runOpenCodeCliCommand(
        { profile, cli },
        { cwd: workspaceRoot, prompt: input.prompt, allowedPaths: input.allowedPaths },
        context,
      );
      const parsedOutput = parseOpenCodeJsonOutput(command.stdout, output, outputLabel, cli.maxOutputBytes);
      return {
        output: parsedOutput,
        command,
        changedFiles: command.gitChangedFilesAfter,
        capabilityDeclarations: profile.capabilityDeclarations,
      };
    },
  };
}

export async function runOpenCodeCliCommand(
  rawConfig: OpenCodeCliCommandConfig,
  rawInput: OpenCodeCliCommandInput,
  context: OpenCodeRunnerContext = {},
): Promise<OpenCodeCommandResult> {
  const profile = validateOpenCodePermissionProfile(rawConfig.profile);
  const cli = parseOpenCodeCliConfig(rawConfig.cli ?? {}, profile);
  const cwd = await resolveWorkspaceRoot(profile, rawInput.cwd);
  const prompt = NonEmptyStringSchema.parse(rawInput.prompt);
  const startedAt = Date.now();
  const reportProgress = async (percent: number, message: string): Promise<void> => {
    await context.progress?.({ percent, message });
  };

  const gitBefore = await captureGitChangedFiles(cwd);
  if (gitBefore.outsideWorkspace.length > 0) {
    fail("WORKSPACE_INVALID", "OpenCode workspace has Git changes outside the configured workspace root before launch.", {
      cwd,
      gitRoot: gitBefore.gitRoot,
      outsideWorkspace: gitBefore.outsideWorkspace,
    });
  }

  const profileArgs = [...profile.cliPermissionFlags, ...profile.cliToolFlags];
  const baseArgs = cli.cwdArg === false ? [...cli.args, ...profileArgs] : [...cli.args, ...profileArgs, cli.cwdArg, cwd];
  const commandArgs = cli.promptDelivery === "stdin" ? baseArgs : [...baseArgs, prompt];
  await reportProgress(1, `Starting OpenCode command: ${cli.command} ${cli.args.join(" ")}`);

  const processResult = await spawnOpenCodeCliProcess(profile, cli, commandArgs, cwd, prompt, startedAt, context, reportProgress);
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
    fail("WORKSPACE_INVALID", "OpenCode changed files outside the configured workspace root.", result);
  }
  throwIfPermissionRequestBlocked(result, profile);
  if (result.exitCode !== 0) {
    fail("NON_ZERO_EXIT", `OpenCode command exited non-zero (${result.exitCode}). ${commandFailureSummary(result)}`, result);
  }
  assertActualChangedFilesInScope(profile, rawInput.allowedPaths, result);
  await reportProgress(95, "OpenCode command completed; structured output is ready for parsing.");
  return result;
}

export function parseOpenCodeJsonOutput<Output>(stdout: string, schema: z.ZodType<Output>, label = "output", maxOutputBytes?: number): Output {
  if (maxOutputBytes !== undefined && Buffer.byteLength(stdout, "utf8") > maxOutputBytes) {
    fail("MAX_OUTPUT_EXCEEDED", `OpenCode ${label} exceeded maxOutputBytes before JSON parsing.`, { maxOutputBytes });
  }
  const parsed = parseStrictJson(stdout) ?? parseOpenCodeJsonEventStream(stdout, schema);
  if (parsed === undefined) {
    fail("INVALID_JSON", `OpenCode ${label} was not valid JSON.`, { sample: singleLine(stdout, 1_000) });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    fail("INVALID_SCHEMA", `OpenCode ${label} failed schema validation.`, { error: result.error.flatten() });
  }
  return result.data;
}

export async function captureOpenCodeGitChangedFiles(cwd: string): Promise<GitChangedFilesSnapshot> {
  return captureGitChangedFiles(cwd);
}

function parseOpenCodeRunInput(rawInput: OpenCodeRunInput): ParsedOpenCodeRunInput {
  const parsed = OpenCodeRunInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    fail("UNSAFE_CONFIG", "OpenCode run input is invalid.", { error: parsed.error.flatten() });
  }
  if (parsed.data.allowedPaths) {
    validatePathPatterns(parsed.data.allowedPaths, "allowedPaths");
  }
  return parsed.data;
}

function parseOpenCodeCliConfig(rawConfig: OpenCodeCliConfig, profile: OpenCodePermissionProfile): ParsedOpenCodeCliConfig {
  const parsed = OpenCodeCliConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    fail("UNSAFE_CONFIG", "OpenCode CLI config is invalid.", { error: parsed.error.flatten() });
  }
  validateOpenCodeLaunchConfig(parsed.data, profile);
  return parsed.data;
}

function validateOpenCodeLaunchConfig(config: ParsedOpenCodeCliConfig, profile: OpenCodePermissionProfile): void {
  const commandName = path.basename(config.command);
  if (ForbiddenOpenCodeCommandNames.has(commandName)) {
    fail("UNSAFE_CONFIG", "OpenCode command must not be a broad shell executable.", { command: config.command });
  }
  validateNoForbiddenFlags(config.args, "args");
  if (config.cwdArg !== false) {
    validateNoForbiddenFlags([config.cwdArg], "cwdArg");
  }
  validateProfileFlagList(profile.cliPermissionFlags, SupportedOpenCodePermissionFlagArity, "cliPermissionFlags");
  validateProfileFlagList(profile.cliToolFlags, SupportedOpenCodeToolFlagArity, "cliToolFlags");
  validateExplicitEnvAllowed(profile, config.env);

  if (commandName === "opencode") {
    if (config.args[0] !== "run") {
      fail("UNSAFE_CONFIG", "OpenCode command args must launch the bounded run subcommand.", { args: config.args });
    }
    if (!hasJsonFormatFlag(config.args)) {
      fail("UNSAFE_CONFIG", "OpenCode command args must request JSON output with --format json.", { args: config.args });
    }
  }
}

function spawnOpenCodeCliProcess(
  profile: OpenCodePermissionProfile,
  config: ParsedOpenCodeCliConfig,
  commandArgs: string[],
  cwd: string,
  prompt: string,
  startedAt: number,
  context: OpenCodeRunnerContext,
  reportProgress: (percent: number, message: string) => Promise<void>,
): Promise<OpenCodeProcessResult> {
  return new Promise((resolve, reject) => {
    if (context.signal?.aborted) {
      reject(new OpenCodeAdapterError("ABORTED", "OpenCode command aborted before launch.", { cwd }));
      return;
    }

    const child = spawn(config.command, commandArgs, {
      cwd,
      env: buildOpenCodeChildEnv(profile, config.env, context.parentEnv),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const heartbeat = setInterval(() => {
      void reportProgress(5, `OpenCode still running after ${Math.round((Date.now() - startedAt) / 1000)}s.`);
    }, config.progressIntervalMs);
    const cleanup = () => {
      clearInterval(heartbeat);
      clearTimeout(timer);
      context.signal?.removeEventListener("abort", abort);
    };
    const failProcess = (error: OpenCodeAdapterError) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      child.kill("SIGTERM");
      reject(error);
    };
    const timer = setTimeout(() => {
      failProcess(new OpenCodeAdapterError("TIMEOUT", "OpenCode command timed out; refusing to trust partial output.", { timeoutMs: config.timeoutMs, cwd }));
    }, config.timeoutMs);
    const abort = () => {
      failProcess(new OpenCodeAdapterError("ABORTED", "OpenCode command aborted; refusing to trust partial output.", { cwd }));
    };
    context.signal?.addEventListener("abort", abort, { once: true });

    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const text = chunk.toString("utf8");
      const nextStdout = target === "stdout" ? stdout + text : stdout;
      const nextStderr = target === "stderr" ? stderr + text : stderr;
      if (Buffer.byteLength(nextStdout, "utf8") > config.maxStdoutBytes) {
        failProcess(new OpenCodeAdapterError("MAX_OUTPUT_EXCEEDED", "OpenCode stdout exceeded maxStdoutBytes.", { maxStdoutBytes: config.maxStdoutBytes, cwd }));
        return;
      }
      if (Buffer.byteLength(nextStderr, "utf8") > config.maxStderrBytes) {
        failProcess(new OpenCodeAdapterError("MAX_OUTPUT_EXCEEDED", "OpenCode stderr exceeded maxStderrBytes.", { maxStderrBytes: config.maxStderrBytes, cwd }));
        return;
      }
      if (Buffer.byteLength(nextStdout, "utf8") + Buffer.byteLength(nextStderr, "utf8") > config.maxOutputBytes) {
        failProcess(new OpenCodeAdapterError("MAX_OUTPUT_EXCEEDED", "OpenCode output exceeded maxOutputBytes.", { maxOutputBytes: config.maxOutputBytes, cwd }));
        return;
      }
      stdout = nextStdout;
      stderr = nextStderr;
      if (target === "stderr") {
        void reportProgress(5, `OpenCode stderr: ${singleLine(text, 500)}`);
      }
    };

    void reportProgress(2, `OpenCode process started in ${cwd}.`);
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new OpenCodeAdapterError("START_FAILED", "OpenCode command failed to start.", { cause: error.message, cwd }));
      }
    });
    child.on("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve({
        command: config.command,
        args: commandArgs,
        cwd,
        exitCode,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });

    child.stdin.end(config.promptDelivery === "argument" ? undefined : prompt);
  });
}

async function resolveWorkspaceRoot(profile: OpenCodePermissionProfile, workspace: string | WorkspaceRef | undefined): Promise<string> {
  const selectedWorkspace = workspace ?? profile.workspace;
  if (!selectedWorkspace) {
    fail("WORKSPACE_INVALID", "OpenCode run requires an explicit workspace root or a profile-bound WorkspaceRef.", { profile: profile.name });
  }
  const workspacePath = typeof selectedWorkspace === "string" ? selectedWorkspace : WorkspaceRefSchema.parse(selectedWorkspace).path;
  if (workspacePath.includes("\0")) {
    fail("WORKSPACE_INVALID", "OpenCode workspace path must not contain NUL bytes.", { workspacePath });
  }
  const resolved = path.resolve(workspacePath);
  if (resolved === path.parse(resolved).root) {
    fail("WORKSPACE_INVALID", "OpenCode workspace root must not be the filesystem root.", { workspacePath });
  }
  if (profile.workspace && path.resolve(profile.workspace.path) !== resolved) {
    fail("WORKSPACE_INVALID", "OpenCode run workspace does not match the profile-bound WorkspaceRef.", {
      profileWorkspace: profile.workspace.path,
      runWorkspace: workspacePath,
    });
  }
  let workspaceStat;
  try {
    workspaceStat = await stat(resolved);
  } catch (error) {
    fail("WORKSPACE_INVALID", "OpenCode workspace path does not exist.", { workspacePath, cause: error instanceof Error ? error.message : String(error) });
  }
  if (!workspaceStat.isDirectory()) {
    fail("WORKSPACE_INVALID", "OpenCode workspace path must be a directory.", { workspacePath });
  }
  return resolved;
}

async function captureGitChangedFiles(cwd: string): Promise<GitChangedFilesSnapshot> {
  const workspaceRoot = path.resolve(cwd);
  let gitRoot: string;
  try {
    const rootResult = await execFileAsync("git", ["-C", workspaceRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8", maxBuffer: 64_000 });
    gitRoot = path.resolve(String(rootResult.stdout).trim());
  } catch (error) {
    fail("WORKSPACE_INVALID", "OpenCode workspace is not a Git worktree; refusing to run without diff enforcement.", {
      cwd,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (gitRoot !== workspaceRoot) {
    fail("WORKSPACE_INVALID", "OpenCode workspace path must be the Git worktree root for diff enforcement.", { cwd, gitRoot });
  }

  const statusResult = await execFileAsync(
    "git",
    ["-C", workspaceRoot, "-c", "status.relativePaths=false", "status", "--porcelain=v1", "-z", "--untracked-files=all"],
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

  return { files: uniqueStrings(files), outsideWorkspace: uniqueStrings(outsideWorkspace), gitRoot };
}

function parseGitStatusFiles(statusOutput: string): string[] {
  const records = statusOutput.split("\0").filter(Boolean);
  const files: string[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record.length < 4) {
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

function throwIfPermissionRequestBlocked(result: OpenCodeCommandResult, profile: OpenCodePermissionProfile): void {
  const requests = extractOpenCodePermissionRequests(result);
  const blockedRequests = requests.filter((request) => !permissionRequestAllowed(request, profile));
  if (blockedRequests.length > 0) {
    fail("PERMISSION_REQUEST_BLOCKED", "OpenCode requested permissions outside the configured profile.", {
      requests,
      blockedRequests,
      profile: profile.name,
    });
  }
  if (openCodePermissionDenied(result)) {
    fail("PERMISSION_DENIED", "OpenCode requires a permission that was denied or auto-rejected.", result);
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

function assertActualChangedFilesInScope(
  profile: OpenCodePermissionProfile,
  runAllowedPaths: readonly string[] | undefined,
  result: OpenCodeCommandResult,
): void {
  const profileAllowedPaths = profile.tools.writeFiles.enabled ? profile.tools.writeFiles.allowedPaths : [];
  const effectiveAllowedPaths = runAllowedPaths?.length ? [...runAllowedPaths] : profileAllowedPaths;
  const outOfScopeFiles = result.gitChangedFilesAfter.filter((changedFile) => {
    if (profileAllowedPaths.length === 0 || effectiveAllowedPaths.length === 0) {
      return true;
    }
    return !profileAllowedPaths.some((allowedPath) => pathMatchesAllowedPath(changedFile, allowedPath)) || !effectiveAllowedPaths.some((allowedPath) => pathMatchesAllowedPath(changedFile, allowedPath));
  });
  if (outOfScopeFiles.length > 0) {
    fail("OUT_OF_SCOPE_DIFF", "OpenCode changed files outside the configured allowed paths.", {
      outOfScopeFiles,
      allowedPaths: effectiveAllowedPaths,
      profileAllowedPaths,
      actualChangedFiles: result.gitChangedFilesAfter,
      reportedStdout: singleLine(result.stdout, 1_000),
    });
  }
}

function normalizeToolPermissions(input: OpenCodeToolPermissionInput): OpenCodePermissionProfileTools {
  return {
    readFiles: normalizeReadFilesPermission(input.readFiles),
    writeFiles: normalizeWriteFilesPermission(input.writeFiles),
    shell: normalizeShellPermission(input.shell),
    network: normalizeNetworkPermission(input.network),
    secrets: normalizeSecretsPermission(input.secrets),
    git: normalizeGitPermission(input.git),
  };
}

function normalizeReadFilesPermission(input: OpenCodeReadFilesPermissionInput | undefined): OpenCodePathPermission {
  if (input === undefined || input === false) {
    return { enabled: false, allowedPaths: [] };
  }
  const allowedPaths = input === true ? ["**"] : [...(input.allowedPaths ?? ["**"])];
  validatePathPatterns(allowedPaths, "readFiles.allowedPaths");
  return { enabled: true, allowedPaths };
}

function normalizeWriteFilesPermission(input: OpenCodeWriteFilesPermissionInput | undefined): OpenCodePathPermission {
  if (input === undefined || input === false) {
    return { enabled: false, allowedPaths: [] };
  }
  const allowedPaths = [...input.allowedPaths];
  validatePathPatterns(allowedPaths, "writeFiles.allowedPaths");
  if (allowedPaths.length === 0) {
    fail("UNSAFE_PROFILE", "OpenCode writeFiles permission requires explicit allowedPaths.", {});
  }
  return { enabled: true, allowedPaths };
}

function normalizeShellPermission(input: OpenCodeShellPermissionInput | undefined): OpenCodeShellPermission {
  if (input === undefined || input === false) {
    return { enabled: false, commands: [] };
  }
  const commands = input.commands.map(validateBoundedShellCommand);
  if (commands.length === 0) {
    fail("UNSAFE_PROFILE", "OpenCode shell permission requires explicit commands.", {});
  }
  return { enabled: true, commands };
}

function normalizeNetworkPermission(input: OpenCodeNetworkPermissionInput | undefined): OpenCodeNetworkPermission {
  if (input === undefined || input === false) {
    return { enabled: false, allowedHosts: [] };
  }
  if (input === true) {
    return { enabled: true, allowedHosts: ["*"] };
  }
  return { enabled: true, allowedHosts: uniqueStrings(input.allowedHosts ?? ["*"]).map(validateCliToken) };
}

function normalizeSecretsPermission(input: OpenCodeSecretsPermissionInput | undefined): OpenCodeSecretsPermission {
  if (input === undefined || input === false) {
    return { enabled: false, names: [] };
  }
  if (input === true) {
    return { enabled: true, names: ["*"] };
  }
  return { enabled: true, names: uniqueStrings(input.names ?? ["*"]).map(validateCliToken) };
}

function normalizeGitPermission(input: OpenCodeGitPermissionInput | undefined): OpenCodeGitPermission {
  if (input === undefined || input === false) {
    return { allowCommit: false, allowBranchSwitch: false, allowPush: false };
  }
  return {
    allowCommit: input.allowCommit === true,
    allowBranchSwitch: input.allowBranchSwitch === true,
    allowPush: input.allowPush === true,
  };
}

function normalizeExposedTools(inputs: readonly OpenCodeExposedToolInput[]): OpenCodeExposedTool[] {
  return inputs.map((input) => {
    const name = validateCliToken(input.name);
    const capabilities = normalizeCapabilityDeclarations(input.capabilities);
    if (capabilities.length === 0) {
      fail("UNSAFE_PROFILE", "OpenCode-exposed tools must declare corresponding Weave capabilities.", { tool: name });
    }
    return {
      name,
      description: input.description,
      capabilities,
      allowedPermissionRequests: input.allowedPermissionRequests ? input.allowedPermissionRequests.map(validateCliToken) : [],
      cliToolFlags: input.cliToolFlags ? input.cliToolFlags.map(validateCliToken) : [],
    };
  });
}

function allowedPermissionRequestsForTools(tools: OpenCodePermissionProfileTools): string[] {
  return uniqueStrings([
    ...(tools.readFiles.enabled ? ["file.read", "workspace.read"] : []),
    ...(tools.writeFiles.enabled ? ["file.write", "workspace.write"] : []),
    ...tools.shell.commands.map((command) => `shell ${command}`),
    ...(tools.network.enabled ? tools.network.allowedHosts.map((host) => (host === "*" ? "network" : `network ${host}`)) : []),
    ...(tools.secrets.enabled ? tools.secrets.names.map((name) => (name === "*" ? "secret" : `secret ${name}`)) : []),
    ...(tools.git.allowCommit ? ["git.commit"] : []),
    ...(tools.git.allowBranchSwitch ? ["git.branch.switch"] : []),
    ...(tools.git.allowPush ? ["git.push"] : []),
  ]);
}

function createBuiltInCapabilityRequests(
  profileName: string,
  workspace: WorkspaceRef | undefined,
  tools: OpenCodePermissionProfileTools,
): AnyCapabilityRequest[] {
  const workspaceId = workspace?.workspaceId;
  return [
    opencodeRunCapability.request({ profileName, workspaceId }),
    ...(tools.readFiles.enabled ? [opencodeWorkspaceReadCapability.request({ workspaceId, allowedPaths: tools.readFiles.allowedPaths })] : []),
    ...(tools.writeFiles.enabled ? [opencodeWorkspaceWriteCapability.request({ workspaceId, allowedPaths: tools.writeFiles.allowedPaths })] : []),
    ...(tools.shell.enabled ? [opencodeShellCapability.request({ commands: tools.shell.commands })] : []),
    ...(tools.network.enabled ? [opencodeNetworkCapability.request({ allowedHosts: tools.network.allowedHosts })] : []),
    ...(tools.secrets.enabled ? [opencodeSecretsCapability.request({ names: tools.secrets.names })] : []),
    ...(tools.git.allowCommit || tools.git.allowBranchSwitch || tools.git.allowPush ? [opencodeGitCapability.request(tools.git)] : []),
  ];
}

function validateEnvironmentVariableName(key: string): string {
  const parsed = EnvironmentVariableNameSchema.safeParse(key);
  if (!parsed.success) {
    fail("UNSAFE_ENV", "OpenCode environment variable names must be shell-safe identifiers.", { key });
  }
  return parsed.data;
}

function validateExplicitEnvAllowed(profile: OpenCodePermissionProfile, explicitEnv: Record<string, string>): void {
  const allowed = new Set(profile.envAllowlist);
  const deniedKeys = Object.keys(explicitEnv).filter((key) => !allowed.has(key));
  if (deniedKeys.length > 0) {
    fail("UNSAFE_ENV", "OpenCode explicit env contains keys outside the profile allowlist.", { deniedKeys });
  }
  if (!profile.tools.secrets.enabled) {
    const secretKeys = Object.keys(explicitEnv).filter(looksLikeSecretEnvKey);
    if (secretKeys.length > 0) {
      fail("UNSAFE_ENV", "OpenCode explicit env contains secret-shaped keys but secrets are disabled.", { secretKeys });
    }
  }
}

function validateCliToken(value: string): string {
  const parsed = CliTokenSchema.safeParse(value);
  if (!parsed.success) {
    fail("UNSAFE_ARGS", "OpenCode CLI tokens must be non-empty strings without NUL bytes.", { value });
  }
  return parsed.data;
}

function validateNoForbiddenFlags(args: readonly string[], source: string): void {
  for (const arg of args) {
    const flag = flagName(arg);
    if (!flag.startsWith("--")) {
      continue;
    }
    if (ForbiddenOpenCodeArgFlags.has(flag)) {
      fail("UNSAFE_ARGS", "OpenCode command args contain a forbidden flag.", { source, flag });
    }
  }
}

function validateProfileFlagList(args: readonly string[], supportedArity: ReadonlyMap<string, number>, source: string): void {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    const flag = flagName(arg);
    if (!flag.startsWith("--")) {
      fail("UNSAFE_ARGS", "OpenCode profile flags must start with --.", { source, arg });
    }
    if (ForbiddenOpenCodeArgFlags.has(flag)) {
      fail("UNSAFE_ARGS", "OpenCode profile contains a forbidden permission/tool flag.", { source, flag });
    }
    const arity = supportedArity.get(flag);
    if (arity === undefined) {
      fail("UNSAFE_ARGS", "OpenCode profile contains an unsupported permission/tool flag.", { source, flag });
    }
    if (arity === 1 && !arg.includes("=")) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        fail("UNSAFE_ARGS", "OpenCode profile flag is missing its required value.", { source, flag });
      }
      index += 1;
    }
  }
}

function validatePathPatterns(patterns: readonly string[], source: string): void {
  for (const pattern of patterns) {
    const normalized = normalizeScopedRelativePath(pattern);
    if (!normalized) {
      fail("UNSAFE_PROFILE", "OpenCode allowed path patterns must be relative workspace paths.", { source, pattern });
    }
  }
}

function validateBoundedShellCommand(command: string): string {
  const parsed = CliTokenSchema.safeParse(command);
  if (!parsed.success) {
    fail("UNSAFE_PROFILE", "OpenCode shell commands must be non-empty strings without NUL bytes.", { command });
  }
  if (/[\r\n;&|`$<>]/.test(command)) {
    fail("UNSAFE_PROFILE", "OpenCode shell commands must be explicit commands without shell control operators.", { command });
  }
  const commandName = path.basename(command.trim().split(/\s+/, 1)[0] ?? "");
  if (!commandName || ForbiddenOpenCodeCommandNames.has(commandName)) {
    fail("UNSAFE_PROFILE", "OpenCode shell permission must not allow broad shell executables.", { command });
  }
  return parsed.data;
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

function commandFailureSummary(result: OpenCodeCommandResult): string {
  const output = singleLine(result.stderr || result.stdout, 1_000);
  return output ? `Output: ${output}` : "No output captured.";
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

function pathMatchesAllowedPath(changedFile: string, allowedPath: string): boolean {
  const normalizedChanged = normalizeScopedRelativePath(changedFile);
  const normalizedAllowed = normalizeScopedRelativePath(allowedPath);
  if (!normalizedChanged || !normalizedAllowed) {
    return false;
  }
  if (normalizedAllowed === "**") {
    return true;
  }
  if (normalizedAllowed.endsWith("/**")) {
    const prefix = normalizedAllowed.slice(0, -3);
    return normalizedChanged === prefix || normalizedChanged.startsWith(`${prefix}/`);
  }
  if (normalizedAllowed.endsWith("/")) {
    return normalizedChanged.startsWith(normalizedAllowed);
  }
  if (normalizedAllowed.includes("*")) {
    return globPatternToRegExp(normalizedAllowed).test(normalizedChanged);
  }
  return normalizedChanged === normalizedAllowed;
}

function globPatternToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    source += escapeRegExp(char ?? "");
  }
  source += "$";
  return new RegExp(source);
}

function normalizeScopedRelativePath(value: string): string | undefined {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const withoutTrailingDirectoryMarker = normalized.endsWith("/") ? normalized : normalized.replace(/\/+$/, "");
  if (
    !withoutTrailingDirectoryMarker ||
    withoutTrailingDirectoryMarker.startsWith("/") ||
    withoutTrailingDirectoryMarker === ".." ||
    withoutTrailingDirectoryMarker.split("/").includes("..")
  ) {
    return undefined;
  }
  return normalized;
}

function isPathOutsideRoot(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function looksLikeSecretEnvKey(key: string): boolean {
  return /(^|_)(AUTH|CREDENTIAL|PASSWORD|PRIVATE|SECRET|TOKEN|API_KEY|ACCESS_KEY|SSH_AUTH_SOCK)(_|$)/i.test(key);
}

function singleLine(value: string, maxLength: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length > maxLength ? `${line.slice(0, maxLength)}...` : line;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function fail(code: OpenCodeAdapterErrorCode, message: string, details: Record<string, unknown>): never {
  throw new OpenCodeAdapterError(code, message, details);
}
