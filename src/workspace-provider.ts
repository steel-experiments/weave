import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { capability } from "./capability-contract.js";
import { deterministicUuid } from "./events.js";
import { tool } from "./tool-contract.js";

const execFileAsync = promisify(execFile);
const NonEmptyStringSchema = z.string().min(1);

export const WorkspaceProviderNameSchema = NonEmptyStringSchema;
export type WorkspaceProviderName = z.infer<typeof WorkspaceProviderNameSchema>;

export const WorkspaceMetadataSchema = z.record(z.string(), z.unknown());
export type WorkspaceMetadata = z.infer<typeof WorkspaceMetadataSchema>;

export const WorkspaceRefSchema = z.object({
  provider: WorkspaceProviderNameSchema,
  workspaceId: NonEmptyStringSchema,
  path: NonEmptyStringSchema,
  repo: NonEmptyStringSchema,
  baseBranch: NonEmptyStringSchema,
  workingBranch: NonEmptyStringSchema,
  baseCommit: NonEmptyStringSchema,
  parentWorkspaceId: NonEmptyStringSchema.optional(),
  metadata: WorkspaceMetadataSchema.optional(),
});
export type WorkspaceRef = z.infer<typeof WorkspaceRefSchema>;

export const WorkspaceAllocateInputSchema = z.object({
  provider: WorkspaceProviderNameSchema.default("git-worktree"),
  repo: NonEmptyStringSchema,
  sourceRepoPath: NonEmptyStringSchema,
  workspaceRoot: NonEmptyStringSchema,
  initiative: NonEmptyStringSchema.optional(),
  sliceId: NonEmptyStringSchema.optional(),
  workspaceId: NonEmptyStringSchema.optional(),
  baseBranch: NonEmptyStringSchema,
  workingBranch: NonEmptyStringSchema,
  baseCommit: NonEmptyStringSchema.optional(),
  parentWorkspaceId: NonEmptyStringSchema.optional(),
  metadata: WorkspaceMetadataSchema.optional(),
});
export type WorkspaceAllocateInput = z.input<typeof WorkspaceAllocateInputSchema>;

export const WorkspaceStateInputSchema = z.object({
  ref: WorkspaceRefSchema,
});
export type WorkspaceStateInput = z.infer<typeof WorkspaceStateInputSchema>;

export const WorkspaceStateSchema = z.object({
  ref: WorkspaceRefSchema,
  exists: z.boolean(),
  currentBranch: NonEmptyStringSchema.optional(),
  currentCommit: NonEmptyStringSchema.optional(),
  dirty: z.boolean(),
  changedFiles: z.array(NonEmptyStringSchema),
});
export type WorkspaceState = z.infer<typeof WorkspaceStateSchema>;

export const WorkspaceDiffInputSchema = z.object({
  ref: WorkspaceRefSchema,
  maxBytes: z.number().int().positive().default(128_000),
});
export type WorkspaceDiffInput = z.input<typeof WorkspaceDiffInputSchema>;

export const WorkspaceDiffSchema = z.object({
  ref: WorkspaceRefSchema,
  changedFiles: z.array(NonEmptyStringSchema),
  diff: z.string(),
  truncated: z.boolean(),
});
export type WorkspaceDiff = z.infer<typeof WorkspaceDiffSchema>;

export const WorkspaceRemoveInputSchema = z.object({
  ref: WorkspaceRefSchema,
  workspaceRoot: NonEmptyStringSchema,
  requireClean: z.boolean().default(true),
  force: z.boolean().default(false),
});
export type WorkspaceRemoveInput = z.input<typeof WorkspaceRemoveInputSchema>;

export const WorkspaceRemovalResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("removed"),
    ref: WorkspaceRefSchema,
    removedPath: NonEmptyStringSchema,
  }),
  z.object({
    status: z.literal("missing"),
    ref: WorkspaceRefSchema,
  }),
  z.object({
    status: z.literal("blocked"),
    ref: WorkspaceRefSchema,
    reason: NonEmptyStringSchema,
  }),
]);
export type WorkspaceRemovalResult = z.infer<typeof WorkspaceRemovalResultSchema>;

export const WorkspacePromotionTargetSchema = z.object({
  branch: NonEmptyStringSchema,
  remote: NonEmptyStringSchema.optional(),
});
export type WorkspacePromotionTarget = z.infer<typeof WorkspacePromotionTargetSchema>;

export const WorkspacePromotionResultSchema = z.object({
  ref: WorkspaceRefSchema,
  target: WorkspacePromotionTargetSchema,
  summary: NonEmptyStringSchema,
});
export type WorkspacePromotionResult = z.infer<typeof WorkspacePromotionResultSchema>;

export type WorkspaceProvider = {
  name: string;
  allocate(input: WorkspaceAllocateInput): Promise<WorkspaceRef>;
  state(input: WorkspaceStateInput): Promise<WorkspaceState>;
  diff(input: WorkspaceDiffInput): Promise<WorkspaceDiff>;
  remove(input: WorkspaceRemoveInput): Promise<WorkspaceRemovalResult>;
  promote?(ref: WorkspaceRef, target: WorkspacePromotionTarget): Promise<WorkspacePromotionResult>;
};

export const workspaceAllocateCapability = capability({
  name: "workspace.allocate",
  description: "Allocate a bounded development workspace.",
  params: z.object({ provider: WorkspaceProviderNameSchema, repo: NonEmptyStringSchema, branch: NonEmptyStringSchema }),
});

export const workspaceInspectCapability = capability({
  name: "workspace.inspect",
  description: "Inspect workspace state.",
  params: z.object({ provider: WorkspaceProviderNameSchema, repo: NonEmptyStringSchema, workspaceId: NonEmptyStringSchema }),
});

export const workspaceDiffCapability = capability({
  name: "workspace.diff",
  description: "Read workspace diff metadata.",
  params: z.object({ provider: WorkspaceProviderNameSchema, repo: NonEmptyStringSchema, workspaceId: NonEmptyStringSchema }),
});

export const workspaceRemoveCapability = capability({
  name: "workspace.remove",
  description: "Remove a known development workspace.",
  params: z.object({ provider: WorkspaceProviderNameSchema, repo: NonEmptyStringSchema, workspaceId: NonEmptyStringSchema }),
});

export function createWorkspaceAllocateTool(provider: WorkspaceProvider) {
  return tool({
    name: "workspace.allocate",
    description: "Allocate a development workspace through a configured provider.",
    input: WorkspaceAllocateInputSchema,
    output: WorkspaceRefSchema,
    capabilities(context) {
      return workspaceAllocateCapability.request({
        provider: provider.name,
        repo: context.input.repo,
        branch: context.input.workingBranch,
      });
    },
    summarize(output) {
      return `Allocated ${output.provider} workspace ${output.workspaceId}.`;
    },
    run(ctx) {
      return provider.allocate(ctx.input);
    },
  });
}

export function createWorkspaceStateTool(provider: WorkspaceProvider) {
  return tool({
    name: "workspace.state",
    description: "Inspect a development workspace through a configured provider.",
    input: WorkspaceStateInputSchema,
    output: WorkspaceStateSchema,
    capabilities(context) {
      return workspaceInspectCapability.request({
        provider: provider.name,
        repo: context.input.ref.repo,
        workspaceId: context.input.ref.workspaceId,
      });
    },
    summarize(output) {
      return output.exists ? `Workspace ${output.ref.workspaceId} has ${output.changedFiles.length} changed file(s).` : "Workspace missing.";
    },
    run(ctx) {
      return provider.state(ctx.input);
    },
  });
}

export function createWorkspaceDiffTool(provider: WorkspaceProvider) {
  return tool({
    name: "workspace.diff",
    description: "Read bounded diff data from a development workspace.",
    input: WorkspaceDiffInputSchema,
    output: WorkspaceDiffSchema,
    capabilities(context) {
      return workspaceDiffCapability.request({
        provider: provider.name,
        repo: context.input.ref.repo,
        workspaceId: context.input.ref.workspaceId,
      });
    },
    summarize(output) {
      return `Workspace ${output.ref.workspaceId} diff has ${output.changedFiles.length} changed file(s).`;
    },
    run(ctx) {
      return provider.diff(ctx.input);
    },
  });
}

export function createWorkspaceRemoveTool(provider: WorkspaceProvider) {
  return tool({
    name: "workspace.remove",
    description: "Remove a known development workspace through a configured provider.",
    input: WorkspaceRemoveInputSchema,
    output: WorkspaceRemovalResultSchema,
    capabilities(context) {
      return workspaceRemoveCapability.request({
        provider: provider.name,
        repo: context.input.ref.repo,
        workspaceId: context.input.ref.workspaceId,
      });
    },
    summarize(output) {
      return output.status === "removed" ? `Removed workspace ${output.ref.workspaceId}.` : `Workspace removal ${output.status}.`;
    },
    run(ctx) {
      return provider.remove(ctx.input);
    },
  });
}

export function workspaceIdFor(input: Pick<WorkspaceAllocateInput, "repo" | "workingBranch" | "initiative" | "sliceId">): string {
  return deterministicUuid("workspace", input.repo, input.initiative ?? "", input.sliceId ?? "", input.workingBranch);
}

export function workspacePathFor(input: { repo: string; workspaceRoot: string; workspaceId: string }): string {
  return path.join(path.resolve(input.workspaceRoot), safePathSegment(input.repo), input.workspaceId);
}

export function assertPathInsideRoot(root: string, candidate: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace root: ${candidate}`);
  }
  return resolvedCandidate;
}

export class GitWorktreeWorkspaceProvider implements WorkspaceProvider {
  readonly name = "git-worktree";

  async allocate(rawInput: WorkspaceAllocateInput): Promise<WorkspaceRef> {
    const input = WorkspaceAllocateInputSchema.parse(rawInput);
    if (input.workingBranch === "main") {
      throw new Error("Refusing to allocate writable workspace for main.");
    }

    const sourceRepoPath = path.resolve(input.sourceRepoPath);
    const repoRoot = (await git(sourceRepoPath, ["rev-parse", "--show-toplevel"])).trim();
    const workspaceId = input.workspaceId ?? workspaceIdFor(input);
    const workspacePath = workspacePathFor({ repo: input.repo, workspaceRoot: input.workspaceRoot, workspaceId });
    assertPathInsideRoot(input.workspaceRoot, workspacePath);
    await mkdir(path.dirname(workspacePath), { recursive: true });

    const baseCommit = input.baseCommit ?? (await git(repoRoot, ["rev-parse", input.baseBranch])).trim();
    const existing = await gitWorktreePathExists(repoRoot, workspacePath);
    if (!existing) {
      await git(repoRoot, ["worktree", "add", "-B", input.workingBranch, workspacePath, baseCommit]);
    }

    const currentBranch = (await git(workspacePath, ["branch", "--show-current"])).trim();
    if (currentBranch !== input.workingBranch) {
      throw new Error(`Workspace branch ${currentBranch} does not match requested branch ${input.workingBranch}.`);
    }

    return WorkspaceRefSchema.parse({
      provider: this.name,
      workspaceId,
      path: workspacePath,
      repo: input.repo,
      baseBranch: input.baseBranch,
      workingBranch: input.workingBranch,
      baseCommit,
      parentWorkspaceId: input.parentWorkspaceId,
      metadata: {
        ...(input.metadata ?? {}),
        sourceRepoPath: repoRoot,
        workspaceRoot: path.resolve(input.workspaceRoot),
      },
    });
  }

  async state(rawInput: WorkspaceStateInput): Promise<WorkspaceState> {
    const input = WorkspaceStateInputSchema.parse(rawInput);
    try {
      const [currentBranch, currentCommit, status] = await Promise.all([
        git(input.ref.path, ["branch", "--show-current"]),
        git(input.ref.path, ["rev-parse", "HEAD"]),
        git(input.ref.path, ["status", "--porcelain"]),
      ]);
      const changedFiles = parsePorcelainChangedFiles(status);
      return WorkspaceStateSchema.parse({
        ref: input.ref,
        exists: true,
        currentBranch: currentBranch.trim() || "DETACHED_HEAD",
        currentCommit: currentCommit.trim(),
        dirty: changedFiles.length > 0,
        changedFiles,
      });
    } catch {
      return WorkspaceStateSchema.parse({ ref: input.ref, exists: false, dirty: false, changedFiles: [] });
    }
  }

  async diff(rawInput: WorkspaceDiffInput): Promise<WorkspaceDiff> {
    const input = WorkspaceDiffInputSchema.parse(rawInput);
    const state = await this.state({ ref: input.ref });
    if (!state.exists) {
      return WorkspaceDiffSchema.parse({ ref: input.ref, changedFiles: [], diff: "", truncated: false });
    }

    const rawDiff = await git(input.ref.path, ["diff", "--", "."]);
    const diffBuffer = Buffer.from(rawDiff);
    const truncated = diffBuffer.byteLength > input.maxBytes;
    const diff = truncated ? diffBuffer.subarray(0, input.maxBytes).toString("utf8") : rawDiff;
    return WorkspaceDiffSchema.parse({ ref: input.ref, changedFiles: state.changedFiles, diff, truncated });
  }

  async remove(rawInput: WorkspaceRemoveInput): Promise<WorkspaceRemovalResult> {
    const input = WorkspaceRemoveInputSchema.parse(rawInput);
    let workspacePath: string;
    try {
      workspacePath = assertPathInsideRoot(input.workspaceRoot, input.ref.path);
    } catch (error) {
      return WorkspaceRemovalResultSchema.parse({ status: "blocked", ref: input.ref, reason: String(error instanceof Error ? error.message : error) });
    }

    const state = await this.state({ ref: input.ref });
    if (!state.exists) {
      return WorkspaceRemovalResultSchema.parse({ status: "missing", ref: input.ref });
    }

    if (input.requireClean && state.dirty && !input.force) {
      return WorkspaceRemovalResultSchema.parse({ status: "blocked", ref: input.ref, reason: "Workspace has uncommitted changes." });
    }

    const sourceRepoPath = typeof input.ref.metadata?.sourceRepoPath === "string" ? input.ref.metadata.sourceRepoPath : workspacePath;
    await git(sourceRepoPath, ["worktree", "remove", input.force ? "--force" : "", workspacePath].filter(Boolean));
    return WorkspaceRemovalResultSchema.parse({ status: "removed", ref: input.ref, removedPath: workspacePath });
  }
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd });
  return String(stdout);
}

async function gitWorktreePathExists(repoRoot: string, workspacePath: string): Promise<boolean> {
  const output = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  return output.split("\n").some((line) => line === `worktree ${path.resolve(workspacePath)}`);
}

function parsePorcelainChangedFiles(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

function safePathSegment(value: string): string {
  const slug = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "workspace";
}
