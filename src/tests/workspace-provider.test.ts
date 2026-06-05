import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { createGitSourceCheckpoint } from "../development-orchestrator.js";
import { restoreSourceCheckpointWorktree } from "../development-operator.js";
import {
  GitWorktreeWorkspaceProvider,
  WorkspaceAllocateInputSchema,
  WorkspaceRefSchema,
  assertPathInsideRoot,
  createWorkspaceAllocateTool,
  createWorkspaceDiffTool,
  createWorkspaceRemoveTool,
  createWorkspaceStateTool,
  workspaceIdFor,
  workspacePathFor,
} from "../workspace-provider.js";

const execFileAsync = promisify(execFile);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "weave-workspace-provider-"));

try {
  const sourceRepoPath = path.join(tempRoot, "source");
  const workspaceRoot = path.join(tempRoot, "workspaces");
  await git(tempRoot, ["init", sourceRepoPath]);
  await git(sourceRepoPath, ["config", "user.email", "weave@example.test"]);
  await git(sourceRepoPath, ["config", "user.name", "Weave Test"]);
  await writeFile(path.join(sourceRepoPath, "README.md"), "hello\n", "utf8");
  await git(sourceRepoPath, ["add", "README.md"]);
  await git(sourceRepoPath, ["commit", "-m", "initial"]);
  await git(sourceRepoPath, ["branch", "-M", "main"]);
  const baseCommit = (await git(sourceRepoPath, ["rev-parse", "HEAD"])).trim();

  const provider = new GitWorktreeWorkspaceProvider();
  const workspaceId = workspaceIdFor({ repo: "weave", initiative: "orchestrator", sliceId: "57", workingBranch: "slice-57" });
  const expectedPath = workspacePathFor({ repo: "weave", workspaceRoot, workspaceId });

  assert.equal(WorkspaceAllocateInputSchema.safeParse({ repo: "weave", sourceRepoPath, workspaceRoot, baseBranch: "main", workingBranch: "slice-57" }).success, true);
  assert.equal(assertPathInsideRoot(workspaceRoot, expectedPath), expectedPath);
  assert.throws(() => assertPathInsideRoot(workspaceRoot, path.join(tempRoot, "outside")));
  assert.equal(createWorkspaceAllocateTool(provider).name, "workspace.allocate");
  assert.equal(createWorkspaceStateTool(provider).name, "workspace.state");
  assert.equal(createWorkspaceDiffTool(provider).name, "workspace.diff");
  assert.equal(createWorkspaceRemoveTool(provider).name, "workspace.remove");

  await assert.rejects(
    async () => provider.allocate({ provider: "git-worktree", repo: "weave", sourceRepoPath, workspaceRoot, baseBranch: "main", workingBranch: "main" }),
    /main/,
  );

  const ref = await provider.allocate({
    provider: "git-worktree",
    repo: "weave",
    sourceRepoPath,
    workspaceRoot,
    initiative: "orchestrator",
    sliceId: "57",
    baseBranch: "main",
    workingBranch: "slice-57",
  });

  assert.equal(ref.provider, "git-worktree");
  assert.equal(ref.workspaceId, workspaceId);
  assert.equal(ref.path, expectedPath);
  assert.equal(ref.baseCommit, baseCommit);
  assert.equal(WorkspaceRefSchema.parse(ref).workingBranch, "slice-57");

  const cleanState = await provider.state({ ref });
  assert.equal(cleanState.exists, true);
  assert.equal(cleanState.currentBranch, "slice-57");
  assert.equal(cleanState.currentCommit, baseCommit);
  assert.equal(cleanState.dirty, false);

  await writeFile(path.join(ref.path, "README.md"), "hello\nchanged\n", "utf8");
  const dirtyState = await provider.state({ ref });
  assert.equal(dirtyState.dirty, true);
  assert.deepEqual(dirtyState.changedFiles, ["README.md"]);

  const diff = await provider.diff({ ref, maxBytes: 64_000 });
  assert.equal(diff.changedFiles.includes("README.md"), true);
  assert.match(diff.diff, /changed/);
  assert.equal(diff.truncated, false);

  const sourceCheckpoint = await createGitSourceCheckpoint({
    initiativeThreadId: "initiative-thread",
    sliceThreadId: "slice-thread",
    sliceId: "57",
    title: "Workspace Provider Boundary",
    workspaceRef: ref,
    commitMessage: "feat: complete Workspace Provider Boundary",
    verificationSummary: {
      status: "passed",
      commands: [{ command: "npm test", exitCode: 0, status: "passed", summary: "Tests passed." }],
    },
    reviewSummary: [{ reviewer: "architecture-reviewer", verdict: "pass", findingCount: 0 }],
  });
  assert.equal(sourceCheckpoint.status, "created");
  assert.equal(sourceCheckpoint.changedFiles.includes("README.md"), true);
  assert.notEqual(sourceCheckpoint.checkpointSha, baseCommit);

  if (sourceCheckpoint.status !== "created") {
    throw new Error("Expected source checkpoint creation to succeed.");
  }
  const checkpointSummary = {
    checkpointId: sourceCheckpoint.checkpointId,
    initiativeThreadId: sourceCheckpoint.initiativeThreadId,
    sliceThreadId: sourceCheckpoint.sliceThreadId,
    sliceId: sourceCheckpoint.sliceId,
    title: sourceCheckpoint.title,
    workspaceRef: sourceCheckpoint.workspaceRef,
    workspacePath: sourceCheckpoint.workspaceRef.path,
    workingBranch: sourceCheckpoint.workspaceRef.workingBranch,
    baseSha: sourceCheckpoint.baseSha,
    checkpointSha: sourceCheckpoint.checkpointSha,
    changedFiles: sourceCheckpoint.changedFiles,
    commitMessage: sourceCheckpoint.commitMessage,
    createdAt: sourceCheckpoint.createdAt,
    eventThreadId: sourceCheckpoint.sliceThreadId,
    eventSeq: 1,
    diffCommand: `git -C '${sourceCheckpoint.workspaceRef.path}' diff ${sourceCheckpoint.baseSha}..${sourceCheckpoint.checkpointSha} --`,
  };
  await writeFile(path.join(ref.path, "LATER.md"), "later\n", "utf8");
  assert.equal((await restoreSourceCheckpointWorktree(checkpointSummary, { confirmed: false })).status, "blocked");
  const dirtyRestore = await restoreSourceCheckpointWorktree(checkpointSummary, { confirmed: true });
  assert.equal(dirtyRestore.status, "blocked");
  assert.match(dirtyRestore.status === "blocked" ? dirtyRestore.reason : "", /uncommitted/);
  const forcedRestore = await restoreSourceCheckpointWorktree(checkpointSummary, { confirmed: true, force: true });
  assert.equal(forcedRestore.status, "restored");
  assert.equal(forcedRestore.status === "restored" ? forcedRestore.restoredSha : "", sourceCheckpoint.checkpointSha);

  await writeFile(path.join(ref.path, "UNCOMMITTED.md"), "pending\n", "utf8");

  const blockedDirtyRemoval = await provider.remove({ ref, workspaceRoot, requireClean: true });
  assert.equal(blockedDirtyRemoval.status, "blocked");

  const outsideRef = { ...ref, path: path.join(tempRoot, "outside") };
  const blockedOutsideRemoval = await provider.remove({ ref: outsideRef, workspaceRoot, force: true, requireClean: false });
  assert.equal(blockedOutsideRemoval.status, "blocked");

  const removed = await provider.remove({ ref, workspaceRoot, requireClean: false, force: true });
  assert.equal(removed.status, "removed");

  const missing = await provider.remove({ ref, workspaceRoot, requireClean: false, force: true });
  assert.equal(missing.status, "missing");

  console.log("Workspace provider tests passed");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd });
  return String(stdout);
}
