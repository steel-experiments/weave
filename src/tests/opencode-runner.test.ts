import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OpenCodeRunnerError,
  buildOpenCodeImplementationPrompt,
  buildOpenCodeRepairPrompt,
  createOpenCodeCliImplementationRunner,
  createOpenCodeCliRepairRunner,
  parseOpenCodeJsonOutput,
  runOpenCodeCliCommand,
} from "../opencode-runner.js";
import { RepairAgentInputSchema } from "../development-orchestrator.js";

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "weave-opencode-runner-"));

try {
  const workspaceRef = {
    provider: "git-worktree",
    workspaceId: "runner-workspace",
    path: tempRoot,
    repo: "weave",
    baseBranch: "main",
    workingBranch: "feature/opencode-runner",
    baseCommit: "abc123",
  };
  const implementationInput = {
    sliceId: "01-test",
    sliceTitle: "Test Slice",
    objective: "Implement a fake change.",
    acceptanceCriteria: ["Runner returns JSON"],
    allowedFiles: ["src/example.ts"],
    branch: workspaceRef.workingBranch,
    workspaceRef,
    constraints: ["Do not change docs."],
  };
  const repairInput = RepairAgentInputSchema.parse({
    branch: workspaceRef.workingBranch,
    workspaceRef,
    slice: {
      id: "01-test",
      title: "Test Slice",
      objective: "Implement a fake change.",
      acceptanceCriteria: ["Runner returns JSON"],
      requiredReviewers: [],
    },
    attempt: 0,
    maxAttempts: 1,
    failingCommands: [{ command: "npm test", exitCode: 1, status: "failed" as const, summary: "Tests failed." }],
    findings: [{ severity: "medium" as const, issue: "Fix test failure." }],
  });

  const implementationPrompt = buildOpenCodeImplementationPrompt(implementationInput);
  assert.equal(implementationPrompt.includes("Return only JSON"), true);
  assert.equal(implementationPrompt.includes("Do not merge"), true);
  assert.equal(implementationPrompt.includes("src/example.ts"), true);

  const repairPrompt = buildOpenCodeRepairPrompt(repairInput);
  assert.equal(repairPrompt.includes("bounded repair worker"), true);
  assert.equal(repairPrompt.includes("Tests failed."), true);

  const implementationRunner = createOpenCodeCliImplementationRunner({
    command: process.execPath,
    args: ["-e", fakeJsonScript({ filesChanged: ["src/example.ts"], summary: "Implemented." })],
    timeoutMs: 5_000,
    maxOutputBytes: 64_000,
  });
  const implementation = await implementationRunner.run(implementationInput);
  assert.deepEqual(implementation.filesChanged, ["src/example.ts"]);
  assert.equal(implementation.summary, "Implemented.");

  const repairRunner = createOpenCodeCliRepairRunner({
    command: process.execPath,
    args: ["-e", fakeJsonScript({ status: "completed", attempt: 0, filesChanged: ["src/example.ts"], fixesAttempted: ["Fixed test."], summary: "Repair complete." })],
    timeoutMs: 5_000,
    maxOutputBytes: 64_000,
  });
  const repair = await repairRunner.run(repairInput);
  assert.equal(repair.status, "completed");
  assert.equal(repair.branch, workspaceRef.workingBranch);
  assert.equal(repair.workspaceRef?.workspaceId, workspaceRef.workspaceId);

  await assert.rejects(
    async () => await implementationRunner.run({ ...implementationInput, workspaceRef: { ...workspaceRef, workingBranch: "other" } }),
    OpenCodeRunnerError,
  );

  const outOfScopeRunner = createOpenCodeCliImplementationRunner({
    command: process.execPath,
    args: ["-e", fakeJsonScript({ filesChanged: ["src/other.ts"], summary: "Changed wrong file." })],
    timeoutMs: 5_000,
  });
  await assert.rejects(async () => await outOfScopeRunner.run(implementationInput), OpenCodeRunnerError);

  const invalidJsonRunner = createOpenCodeCliImplementationRunner({
    command: process.execPath,
    args: ["-e", "process.stdout.write('not json')"],
    timeoutMs: 5_000,
  });
  await assert.rejects(
    async () => await invalidJsonRunner.run(implementationInput),
    OpenCodeRunnerError,
  );

  await assert.rejects(
    () => runOpenCodeCliCommand({ command: process.execPath, args: ["-e", "setTimeout(() => {}, 1000)"], timeoutMs: 10 }, tempRoot, "prompt"),
    OpenCodeRunnerError,
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("OpenCode runner tests passed");

function fakeJsonScript(output: Record<string, unknown>): string {
  return `let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (!input.includes("Return only JSON")) {
    process.stderr.write("missing prompt instructions");
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(${JSON.stringify(output)}));
});`;
}
