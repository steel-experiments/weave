import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  OpenCodeCliRunnerConfigSchema,
  OpenCodePermissionProfileSchema,
  OpenCodeRunnerError,
  buildOpenCodeChildEnv,
  buildOpenCodeImplementationPrompt,
  buildOpenCodeRepairPrompt,
  createMaintainerOpenCodePermissionProfile,
  createOpenCodeCliImplementationRunner,
  createOpenCodeCliRepairRunner,
  createTestOnlyUnsafeOpenCodePermissionProfile,
  parseOpenCodeJsonOutput,
  runOpenCodeCliCommand,
} from "../opencode-runner.js";
import {
  DevelopmentBlockedRunnerError,
  ImplementationSummarySchema,
  RepairAgentInputSchema,
  createOpenCodeImplementationTool,
  type OpenCodeImplementerInput,
} from "../development-orchestrator.js";

const execFileAsync = promisify(execFile);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "weave-opencode-runner-"));
const permissionProfile = createMaintainerOpenCodePermissionProfile();

try {
  assert.equal(OpenCodeCliRunnerConfigSchema.safeParse({}).success, false);
  assert.equal(OpenCodePermissionProfileSchema.safeParse({ type: "maintainer-bounded", name: "empty" }).success, false);
  assert.equal(OpenCodePermissionProfileSchema.safeParse({ ...permissionProfile, allowNetwork: true }).success, false);
  assert.equal(
    OpenCodePermissionProfileSchema.safeParse({ type: "test-only-unsafe", name: "unsafe", unsafeReason: "wrong name must fail" }).success,
    false,
  );
  assert.equal(OpenCodePermissionProfileSchema.safeParse(createTestOnlyUnsafeOpenCodePermissionProfile()).success, true);

  const sanitizedEnv = buildOpenCodeChildEnv(
    permissionProfile,
    { GITHUB_TOKEN: "explicit-secret", PATH: "/bin" },
    { GITHUB_TOKEN: "parent-secret", PATH: "/usr/bin", HOME: "/home/test" },
  );
  assert.equal(sanitizedEnv.GITHUB_TOKEN, undefined);
  assert.equal(sanitizedEnv.PATH, "/bin");
  assert.equal(sanitizedEnv.HOME, "/home/test");

  const testUnsafeSecretEnv = buildOpenCodeChildEnv(
    createTestOnlyUnsafeOpenCodePermissionProfile({ allowSecrets: true, envAllowlist: ["GITHUB_TOKEN"] }),
    { GITHUB_TOKEN: "explicit-secret" },
    {},
  );
  assert.equal(testUnsafeSecretEnv.GITHUB_TOKEN, "explicit-secret");

  const scenario = await createScenario("happy");
  const implementationPrompt = buildOpenCodeImplementationPrompt(scenario.implementationInput);
  assert.equal(implementationPrompt.includes("Return only JSON"), true);
  assert.equal(implementationPrompt.includes("Do not merge"), true);
  assert.equal(implementationPrompt.includes("actual Git diff scope check"), true);
  assert.equal(implementationPrompt.includes("src/example.ts"), true);

  const repairPrompt = buildOpenCodeRepairPrompt(scenario.repairInput);
  assert.equal(repairPrompt.includes("bounded repair worker"), true);
  assert.equal(repairPrompt.includes("actual Git diff scope check"), true);
  assert.equal(repairPrompt.includes("Tests failed."), true);

  const commandProfile = createMaintainerOpenCodePermissionProfile({ cliToolFlags: ["--agent", "weave-maintainer"] });
  const commandResult = await runOpenCodeCliCommand(
    {
      command: process.execPath,
      args: nodeEvalArgs("process.stdout.write('{}')"),
      permissionProfile: commandProfile,
      promptDelivery: "stdin",
      cwdArg: false,
      timeoutMs: 5_000,
      maxOutputBytes: 64_000,
    },
    scenario.workspaceRef.path,
    "prompt",
  );
  assert.equal(commandResult.args.includes("--pure"), true);
  assert.equal(commandResult.args.includes("--agent"), true);
  assert.equal(commandResult.args.includes("weave-maintainer"), true);
  assert.deepEqual(commandResult.gitChangedFilesBefore, []);
  assert.deepEqual(commandResult.gitChangedFilesAfter, []);

  const envScenario = await createScenario("env");
  const envResult = await runOpenCodeCliCommand(
    {
      command: process.execPath,
      args: nodeEvalArgs("process.stdout.write(JSON.stringify({ token: process.env.GITHUB_TOKEN ?? null, path: process.env.PATH ?? null }))"),
      permissionProfile,
      promptDelivery: "stdin",
      cwdArg: false,
      timeoutMs: 5_000,
      maxOutputBytes: 64_000,
      env: { GITHUB_TOKEN: "secret", PATH: "/bin" },
    },
    envScenario.workspaceRef.path,
    "prompt",
  );
  assert.deepEqual(JSON.parse(envResult.stdout), { token: null, path: "/bin" });

  const implementationRunner = createOpenCodeCliImplementationRunner({
    command: process.execPath,
    args: nodeEvalArgs(fakeJsonScript({ filesChanged: ["src/example.ts"], summary: "Implemented." })),
    permissionProfile,
    promptDelivery: "stdin",
    cwdArg: false,
    timeoutMs: 5_000,
    maxOutputBytes: 64_000,
  });
  const implementation = await implementationRunner.run(scenario.implementationInput);
  assert.deepEqual(implementation.filesChanged, ["src/example.ts"]);
  assert.equal(implementation.summary, "Implemented.");

  const repairRunner = createOpenCodeCliRepairRunner({
    command: process.execPath,
    args: nodeEvalArgs(fakeJsonScript({ status: "completed", attempt: 0, filesChanged: ["src/example.ts"], fixesAttempted: ["Fixed test."], summary: "Repair complete." })),
    permissionProfile,
    promptDelivery: "stdin",
    cwdArg: false,
    timeoutMs: 5_000,
    maxOutputBytes: 64_000,
  });
  const repair = await repairRunner.run(scenario.repairInput);
  assert.equal(repair.status, "completed");
  assert.equal(repair.branch, scenario.workspaceRef.workingBranch);
  assert.equal(repair.workspaceRef?.workspaceId, scenario.workspaceRef.workspaceId);

  const branchScenario = await createScenario("branch-mismatch");
  const branchMarker = path.join(branchScenario.workspaceRef.path, "launched.txt");
  const branchMismatchRunner = createOpenCodeCliImplementationRunner({
    command: process.execPath,
    args: nodeEvalArgs(fakeJsonScript({ filesChanged: ["src/example.ts"], summary: "Should not launch." }, { writeFile: "launched.txt" })),
    permissionProfile,
    promptDelivery: "stdin",
    cwdArg: false,
    timeoutMs: 5_000,
  });
  await assert.rejects(
    async () => await branchMismatchRunner.run({ ...branchScenario.implementationInput, workspaceRef: { ...branchScenario.workspaceRef, workingBranch: "other" } }),
    DevelopmentBlockedRunnerError,
  );
  assert.equal(await fileExists(branchMarker), false);

  const reportedOutOfScopeScenario = await createScenario("reported-out-of-scope");
  const outOfScopeRunner = createOpenCodeCliImplementationRunner({
    command: process.execPath,
    args: nodeEvalArgs(fakeJsonScript({ filesChanged: ["src/other.ts"], summary: "Changed wrong file." })),
    permissionProfile,
    promptDelivery: "stdin",
    cwdArg: false,
    timeoutMs: 5_000,
  });
  await assert.rejects(async () => await outOfScopeRunner.run(reportedOutOfScopeScenario.implementationInput), DevelopmentBlockedRunnerError);

  const actualOutOfScopeScenario = await createScenario("actual-out-of-scope");
  const actualOutOfScopeRunner = createOpenCodeCliImplementationRunner({
    command: process.execPath,
    args: nodeEvalArgs(fakeJsonScript({ filesChanged: ["src/example.ts"], summary: "Reported only allowed file." }, { writeFile: "docs/outside.md" })),
    permissionProfile,
    promptDelivery: "stdin",
    cwdArg: false,
    timeoutMs: 5_000,
  });
  await assert.rejects(async () => await actualOutOfScopeRunner.run(actualOutOfScopeScenario.implementationInput), DevelopmentBlockedRunnerError);

  const invalidJsonScenario = await createScenario("invalid-json");
  const invalidJsonRunner = createOpenCodeCliImplementationRunner({
    command: process.execPath,
    args: nodeEvalArgs("process.stdout.write('not json')"),
    permissionProfile,
    promptDelivery: "stdin",
    cwdArg: false,
    timeoutMs: 5_000,
  });
  await assert.rejects(
    async () => await invalidJsonRunner.run(invalidJsonScenario.implementationInput),
    OpenCodeRunnerError,
  );

  const permissionDeniedScenario = await createScenario("permission-denied");
  const permissionDeniedRunner = createOpenCodeCliImplementationRunner({
    command: process.execPath,
    args: nodeEvalArgs("process.stderr.write('permission requested: external_directory (/tmp/example/*); auto-rejecting'); process.stdout.write('not json')"),
    permissionProfile,
    promptDelivery: "stdin",
    cwdArg: false,
    timeoutMs: 5_000,
  });
  await assert.rejects(
    async () => await permissionDeniedRunner.run(permissionDeniedScenario.implementationInput),
    DevelopmentBlockedRunnerError,
  );

  const permissionRequestScenario = await createScenario("permission-request");
  const permissionRequestRunner = createOpenCodeCliImplementationRunner({
    command: process.execPath,
    args: nodeEvalArgs(fakeJsonScript({ filesChanged: ["src/example.ts"], summary: "Requested unsupported permission." }, { permissionRequest: "network_fetch https://example.test" })),
    permissionProfile,
    promptDelivery: "stdin",
    cwdArg: false,
    timeoutMs: 5_000,
  });
  await assert.rejects(
    async () => await permissionRequestRunner.run(permissionRequestScenario.implementationInput),
    DevelopmentBlockedRunnerError,
  );

  const permissionBlockedTool = createOpenCodeImplementationTool(permissionRequestRunner);
  const permissionBlockedOutput = await permissionBlockedTool.run({
    input: permissionRequestScenario.implementationInput,
    progress: () => undefined,
  } as never);
  assert.equal(permissionBlockedOutput.status, "blocked");
  assert.match(permissionBlockedOutput.reason, /permissions outside the configured profile/);

  const maxOutputScenario = await createScenario("max-output");
  let progressEvents = 0;
  await assert.rejects(
    () =>
      runOpenCodeCliCommand(
        {
          command: process.execPath,
          args: nodeEvalArgs("process.stdout.write('x'.repeat(1024)); setTimeout(() => {}, 1000)"),
          permissionProfile,
          promptDelivery: "stdin",
          cwdArg: false,
          timeoutMs: 5_000,
          maxOutputBytes: 16,
          progressIntervalMs: 10,
        },
        maxOutputScenario.workspaceRef.path,
        "prompt",
        { progress: () => { progressEvents += 1; } },
      ),
    DevelopmentBlockedRunnerError,
  );
  const progressEventsAfterRejection = progressEvents;
  await sleep(50);
  assert.equal(progressEvents, progressEventsAfterRejection);

  const timeoutScenario = await createScenario("timeout");
  await assert.rejects(
    () =>
      runOpenCodeCliCommand(
        { command: process.execPath, args: nodeEvalArgs("setTimeout(() => {}, 1000)"), permissionProfile, promptDelivery: "stdin", cwdArg: false, timeoutMs: 10 },
        timeoutScenario.workspaceRef.path,
        "prompt",
      ),
    DevelopmentBlockedRunnerError,
  );

  const forbiddenFlagScenario = await createScenario("forbidden-flag");
  await assert.rejects(
    () =>
      runOpenCodeCliCommand(
        {
          command: process.execPath,
          args: [...nodeEvalArgs("process.stdout.write('{}')"), "--dangerously-skip-permissions"],
          permissionProfile,
          promptDelivery: "stdin",
          cwdArg: false,
          timeoutMs: 5_000,
        },
        forbiddenFlagScenario.workspaceRef.path,
        "prompt",
      ),
    DevelopmentBlockedRunnerError,
  );

  const streamed = parseOpenCodeJsonOutput(
    [
      JSON.stringify({ type: "message", text: "working" }),
      JSON.stringify({ type: "message", text: "```json\n{\"filesChanged\":[\"src/example.ts\"],\"summary\":\"Implemented from stream.\"}\n```" }),
    ].join("\n"),
    ImplementationSummarySchema,
    "implementation summary",
  );
  assert.equal(streamed.summary, "Implemented from stream.");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("OpenCode runner tests passed");

async function createScenario(label: string): Promise<{
  workspaceRef: OpenCodeImplementerInput["workspaceRef"];
  implementationInput: OpenCodeImplementerInput;
  repairInput: ReturnType<typeof RepairAgentInputSchema.parse>;
}> {
  const workspacePath = await mkdtemp(path.join(tempRoot, `${label}-`));
  await execFileAsync("git", ["init"], { cwd: workspacePath });
  const workspaceRef = {
    provider: "git-worktree",
    workspaceId: `${label}-workspace`,
    path: workspacePath,
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
      allowedFiles: ["src/example.ts"],
      requiredReviewers: [],
    },
    attempt: 0,
    maxAttempts: 1,
    failingCommands: [{ command: "npm test", exitCode: 1, status: "failed" as const, summary: "Tests failed." }],
    findings: [{ severity: "medium" as const, issue: "Fix test failure." }],
  });

  return { workspaceRef, implementationInput, repairInput };
}

function fakeJsonScript(output: Record<string, unknown>, options: { permissionRequest?: string; writeFile?: string } = {}): string {
  return `const fs = require("node:fs");
const path = require("node:path");
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (!input.includes("Return only JSON")) {
    process.stderr.write("missing prompt instructions");
    process.exit(2);
  }
  ${options.writeFile ? `fs.mkdirSync(path.dirname(${JSON.stringify(options.writeFile)}), { recursive: true }); fs.writeFileSync(${JSON.stringify(options.writeFile)}, "changed");` : ""}
  ${options.permissionRequest ? `process.stdout.write("permission requested: ${options.permissionRequest}\\n");` : ""}
  process.stdout.write(JSON.stringify(${JSON.stringify(output)}));
});`;
}

function nodeEvalArgs(script: string): string[] {
  return ["-e", script, "--"];
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
