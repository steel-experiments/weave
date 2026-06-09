import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { GitWorktreeWorkspaceProvider, workspaceIdFor, workspacePathFor } from "weave";
import { createGitLocalMergeFinalizationRunner, createGitSourceCheckpoint } from "../development-orchestrator.js";
import { restoreSourceCheckpointWorktree } from "../development-operator.js";

const execFileAsync = promisify(execFile);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "weave-maintainer-source-checkpoint-"));

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
  assert.equal(ref.workspaceId, workspaceId);
  assert.equal(ref.path, workspacePathFor({ repo: "weave", workspaceRoot, workspaceId }));

  await writeFile(path.join(ref.path, "README.md"), "hello\nchanged\n", "utf8");
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

  const localMergeRunner = createGitLocalMergeFinalizationRunner();
  const mergeResult = await localMergeRunner.run({
    repo: "weave",
    repoRoot: sourceRepoPath,
    baseBranch: "main",
    branch: "slice-57",
    strategy: "merge-commit",
  });
  assert.equal(mergeResult.status, "merged");
  assert.equal(mergeResult.status === "merged" ? mergeResult.beforeSha : "", baseCommit);

  await git(sourceRepoPath, ["checkout", "-b", "conflict-branch", baseCommit]);
  await writeFile(path.join(sourceRepoPath, "README.md"), "branch conflict\n", "utf8");
  await git(sourceRepoPath, ["add", "README.md"]);
  await git(sourceRepoPath, ["commit", "-m", "branch conflict"]);
  await git(sourceRepoPath, ["checkout", "main"]);
  await writeFile(path.join(sourceRepoPath, "README.md"), "main conflict\n", "utf8");
  await git(sourceRepoPath, ["add", "README.md"]);
  await git(sourceRepoPath, ["commit", "-m", "main conflict"]);
  const conflictResult = await localMergeRunner.run({
    repo: "weave",
    repoRoot: sourceRepoPath,
    baseBranch: "main",
    branch: "conflict-branch",
    strategy: "merge-commit",
  });
  assert.equal(conflictResult.status, "blocked");
  assert.equal(conflictResult.status === "blocked" ? conflictResult.conflictFiles.includes("README.md") : false, true);
  await git(sourceRepoPath, ["merge", "--abort"]);

  const missingBaseResult = await localMergeRunner.run({
    repo: "weave",
    repoRoot: sourceRepoPath,
    baseBranch: "missing-base",
    branch: "conflict-branch",
    strategy: "merge-commit",
  });
  assert.equal(missingBaseResult.status, "blocked");
  assert.match(missingBaseResult.status === "blocked" ? missingBaseResult.reason : "", /Could not resolve base branch missing-base/);

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

  console.log("Source checkpoint workspace tests passed");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd });
  return String(stdout);
}
