import { policy, type AnyPolicyRule, type CapabilityDeclaration } from "weave/runtime";
import {
  OpenCodeAdapterError,
  buildOpenCodeChildEnv,
  createOpenCodeCliAdapter,
  openCodeCapabilityRequestsForProfile,
  opencodePermissionProfile,
  parseOpenCodeJsonOutput,
  runOpenCodeCliCommand as runWeaveOpenCodeCliCommand,
  validateOpenCodePermissionProfile,
  type OpenCodeCliConfig,
  type OpenCodeCommandResult,
  type OpenCodePermissionProfile,
  type OpenCodePermissionProfileInput,
  type OpenCodeRunInput,
} from "weave/opencode";
import { z } from "zod";
import {
  DevelopmentBlockedRunnerError,
  ImplementationSummarySchema,
  OpenCodeImplementerInputSchema,
  RepairAgentInputSchema,
  RepairResultSchema,
  type DevelopmentRunnerContext,
  type ImplementationSummary,
  type OpenCodeImplementationRunner,
  type OpenCodeImplementerInput,
  type RepairAgentInput,
  type RepairResult,
  type RepairRunner,
} from "./development-orchestrator.js";

const NonEmptyStringSchema = z.string().min(1);
const EnvironmentVariableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const MaintainerShellCommands = ["npm test", "npm run typecheck", "git diff --check"] as const;
const AdapterBlockedCodes = new Set<OpenCodeAdapterError["code"]>([
  "WORKSPACE_INVALID",
  "PERMISSION_REQUEST_BLOCKED",
  "PERMISSION_DENIED",
  "TIMEOUT",
  "ABORTED",
  "MAX_OUTPUT_EXCEEDED",
  "NON_ZERO_EXIT",
  "INVALID_JSON",
  "INVALID_SCHEMA",
  "OUT_OF_SCOPE_DIFF",
]);

export { buildOpenCodeChildEnv, parseOpenCodeJsonOutput };
export type { OpenCodeCommandResult, OpenCodePermissionProfile };

export const OpenCodePermissionProfileSchema = z.custom<OpenCodePermissionProfile>((value) => {
  try {
    validateOpenCodePermissionProfile(value as OpenCodePermissionProfile);
    return true;
  } catch {
    return false;
  }
}, "Expected a safe weave/opencode permission profile.");

export const OpenCodeCliRunnerConfigSchema = z
  .object({
    command: NonEmptyStringSchema.default("opencode"),
    args: z.array(NonEmptyStringSchema).default(["run", "--format", "json"]),
    permissionProfile: OpenCodePermissionProfileSchema,
    promptDelivery: z.enum(["argument", "stdin", "both"]).default("argument"),
    cwdArg: z.union([NonEmptyStringSchema, z.literal(false)]).default("--dir"),
    timeoutMs: z.number().int().positive().default(600_000),
    maxStdoutBytes: z.number().int().positive().optional(),
    maxStderrBytes: z.number().int().positive().optional(),
    maxOutputBytes: z.number().int().positive().default(256_000),
    env: z.record(EnvironmentVariableNameSchema, z.string()).optional(),
    progressIntervalMs: z.number().int().positive().default(15_000),
  })
  .strict();
export type OpenCodeCliRunnerConfig = z.input<typeof OpenCodeCliRunnerConfigSchema>;
type ParsedOpenCodeCliRunnerConfig = z.output<typeof OpenCodeCliRunnerConfigSchema>;

export type MaintainerOpenCodeRunner = OpenCodeImplementationRunner & {
  openCodeProfile: OpenCodePermissionProfile;
  capabilities: readonly CapabilityDeclaration[];
};

export type MaintainerRepairRunner = RepairRunner & {
  openCodeProfile: OpenCodePermissionProfile;
  capabilities: readonly CapabilityDeclaration[];
};

export function createMaintainerOpenCodeImplementationPermissionProfile(
  overrides: Partial<Omit<OpenCodePermissionProfileInput, "tools">> = {},
): OpenCodePermissionProfile {
  return opencodePermissionProfile({
    name: "weave-maintainer-implementation",
    tools: maintainerOpenCodeTools(),
    ...overrides,
  });
}

export function createMaintainerOpenCodeRepairPermissionProfile(
  overrides: Partial<Omit<OpenCodePermissionProfileInput, "tools">> = {},
): OpenCodePermissionProfile {
  return opencodePermissionProfile({
    name: "weave-maintainer-repair",
    tools: maintainerOpenCodeTools(),
    ...overrides,
  });
}

export function createMaintainerOpenCodePermissionProfile(
  overrides: Partial<Omit<OpenCodePermissionProfileInput, "tools">> = {},
): OpenCodePermissionProfile {
  return createMaintainerOpenCodeImplementationPermissionProfile(overrides);
}

export function createMaintainerOpenCodePolicy(options: {
  implementationProfile: OpenCodePermissionProfile;
  repairProfile: OpenCodePermissionProfile;
}): AnyPolicyRule {
  const implementationProfile = validateOpenCodePermissionProfile(options.implementationProfile);
  const repairProfile = validateOpenCodePermissionProfile(options.repairProfile);
  const allowedOpenCodeCapabilities = new Set(
    [implementationProfile, repairProfile].flatMap((profile) => openCodeCapabilityRequestsForProfile(profile).map((capability) => capability.name)),
  );

  return policy({
    name: "weave-maintainer.opencode-capabilities",
    version: "1",
    description: "Allow only OpenCode capabilities declared by the maintainer implementation and repair profiles.",
    evaluate(request) {
      const requestedOpenCodeCapabilities = request.capabilities.map((capability) => capability.name).filter((name) => name.startsWith("opencode."));
      if (requestedOpenCodeCapabilities.length === 0) {
        return undefined;
      }

      const unexpected = requestedOpenCodeCapabilities.filter((name) => !allowedOpenCodeCapabilities.has(name));
      if (unexpected.length > 0) {
        return {
          outcome: "deny",
          reason: `Unexpected OpenCode capability requested by maintainer app: ${uniqueStrings(unexpected).join(", ")}.`,
        };
      }

      return { outcome: "allow", reason: "OpenCode capabilities match the maintainer adapter profiles." };
    },
  });
}

export function createOpenCodeCliImplementationRunner(config: OpenCodeCliRunnerConfig): MaintainerOpenCodeRunner {
  const parsedConfig = parseOpenCodeCliRunnerConfig(config);
  const adapter = createOpenCodeCliAdapter({
    profile: parsedConfig.permissionProfile,
    output: ImplementationSummarySchema,
    outputLabel: "implementation summary",
    cli: toOpenCodeCliConfig(parsedConfig),
  });

  return {
    openCodeProfile: adapter.profile,
    capabilities: adapter.capabilities,
    async run(rawInput, context) {
      try {
        const input = OpenCodeImplementerInputSchema.parse(rawInput);
        assertWorkspaceMatchesBranch(input.branch, input.workspaceRef.workingBranch);
        const result = await adapter.run(buildOpenCodeImplementationRunInput(input), toOpenCodeRunnerContext(context));
        const summary = ImplementationSummarySchema.parse({
          ...result.output,
          filesChanged: uniqueStrings([...result.output.filesChanged, ...result.changedFiles]),
        });
        assertImplementationScope(input, summary);
        return summary;
      } catch (error) {
        throw mapOpenCodeError(error);
      }
    },
  };
}

export function createOpenCodeCliRepairRunner(config: OpenCodeCliRunnerConfig): MaintainerRepairRunner {
  const parsedConfig = parseOpenCodeCliRunnerConfig(config);
  const adapter = createOpenCodeCliAdapter({
    profile: parsedConfig.permissionProfile,
    output: RepairResultSchema,
    outputLabel: "repair result",
    cli: toOpenCodeCliConfig(parsedConfig),
  });

  return {
    openCodeProfile: adapter.profile,
    capabilities: adapter.capabilities,
    async run(rawInput, context) {
      try {
        const input = RepairAgentInputSchema.parse(rawInput);
        assertWorkspaceMatchesBranch(input.branch, input.workspaceRef.workingBranch);
        const result = await adapter.run(buildOpenCodeRepairRunInput(input), toOpenCodeRunnerContext(context));
        return RepairResultSchema.parse({
          ...result.output,
          branch: result.output.branch ?? input.branch,
          workspaceRef: result.output.workspaceRef ?? input.workspaceRef,
          filesChanged: uniqueStrings([...result.output.filesChanged, ...result.changedFiles]),
        });
      } catch (error) {
        throw mapOpenCodeError(error);
      }
    },
  };
}

export function buildOpenCodeImplementationRunInput(rawInput: OpenCodeImplementerInput): OpenCodeRunInput {
  const input = OpenCodeImplementerInputSchema.parse(rawInput);
  return {
    workspace: input.workspaceRef,
    prompt: buildOpenCodeImplementationPrompt(input),
    ...(input.allowedFiles?.length ? { allowedPaths: input.allowedFiles } : {}),
  };
}

export function buildOpenCodeRepairRunInput(rawInput: RepairAgentInput): OpenCodeRunInput {
  const input = RepairAgentInputSchema.parse(rawInput);
  return {
    workspace: input.workspaceRef,
    prompt: buildOpenCodeRepairPrompt(input),
    ...(input.slice.allowedFiles?.length ? { allowedPaths: input.slice.allowedFiles } : {}),
  };
}

export function buildOpenCodeImplementationPrompt(rawInput: OpenCodeImplementerInput): string {
  const input = OpenCodeImplementerInputSchema.parse(rawInput);
  const lines = [
    "You are OpenCode running as a bounded implementation worker for Weave.",
    "Weave owns orchestration. You may implement only this one slice.",
    "Do not merge, open PRs, switch branches, access secrets, or write outside the workspace.",
    "The reusable weave/opencode adapter enforces a deny-by-default profile, sanitized environment, and actual Git diff scope check after you exit.",
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
    ...(input.allowedFiles?.length ? input.allowedFiles.map((file) => `- ${file}`) : ["- Not restricted by the slice input."]),
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
    "The reusable weave/opencode adapter enforces a deny-by-default profile, sanitized environment, and actual Git diff scope check after you exit.",
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
  try {
    return await runWeaveOpenCodeCliCommand(
      { profile: config.permissionProfile, cli: toOpenCodeCliConfig(config) },
      { cwd, prompt },
      toOpenCodeRunnerContext(context),
    );
  } catch (error) {
    throw mapOpenCodeError(error);
  }
}

function maintainerOpenCodeTools(): OpenCodePermissionProfileInput["tools"] {
  return {
    readFiles: true,
    writeFiles: { allowedPaths: ["**"] },
    shell: { commands: [...MaintainerShellCommands] },
    network: false,
    secrets: false,
    git: { allowCommit: false, allowBranchSwitch: false, allowPush: false },
  };
}

function parseOpenCodeCliRunnerConfig(rawConfig: OpenCodeCliRunnerConfig): ParsedOpenCodeCliRunnerConfig {
  const parsed = OpenCodeCliRunnerConfigSchema.safeParse(rawConfig);
  if (!parsed.success) {
    throw new DevelopmentBlockedRunnerError("OpenCode runner config is missing a safe explicit weave/opencode permission profile.", {
      error: parsed.error.flatten(),
    });
  }
  return parsed.data;
}

function toOpenCodeCliConfig(config: ParsedOpenCodeCliRunnerConfig): OpenCodeCliConfig {
  return {
    command: config.command,
    args: config.args,
    cwdArg: config.cwdArg,
    promptDelivery: config.promptDelivery,
    timeoutMs: config.timeoutMs,
    maxStdoutBytes: config.maxStdoutBytes ?? config.maxOutputBytes,
    maxStderrBytes: config.maxStderrBytes ?? config.maxOutputBytes,
    maxOutputBytes: config.maxOutputBytes,
    env: config.env ?? {},
    progressIntervalMs: config.progressIntervalMs,
  };
}

function toOpenCodeRunnerContext(context: DevelopmentRunnerContext | undefined): { progress?: DevelopmentRunnerContext["progress"] } {
  return context?.progress ? { progress: context.progress } : {};
}

function assertWorkspaceMatchesBranch(branch: string, workspaceBranch: string): void {
  if (branch !== workspaceBranch) {
    throw new DevelopmentBlockedRunnerError("Workspace branch does not match requested branch.", { branch, workspaceBranch });
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function mapOpenCodeError(error: unknown): unknown {
  if (error instanceof DevelopmentBlockedRunnerError) {
    return error;
  }
  if (error instanceof OpenCodeAdapterError && AdapterBlockedCodes.has(error.code)) {
    return new DevelopmentBlockedRunnerError(error.message, { code: error.code, ...error.details });
  }
  return error;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
