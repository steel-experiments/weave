import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { openCodeCapabilityRequestsForProfile, opencodePermissionProfile, type OpenCodePermissionProfile } from "weave/opencode";
import { z } from "zod";
import {
  OpenCodeCliRunnerConfigSchema,
  OpenCodePermissionProfileSchema,
  buildOpenCodeImplementationPrompt,
  buildOpenCodeImplementationRunInput,
  buildOpenCodeRepairPrompt,
  buildOpenCodeRepairRunInput,
  createMaintainerOpenCodeImplementationPermissionProfile,
  createMaintainerOpenCodePolicy,
  createMaintainerOpenCodeRepairPermissionProfile,
  createOpenCodeCliImplementationRunner,
  createOpenCodeCliRepairRunner,
} from "../opencode-runner.js";
import { RepairAgentInputSchema, createOpenCodeImplementationTool, createRepairTool, type OpenCodeImplementerInput } from "../development-orchestrator.js";
import type { CapabilityDeclaration, PolicyRequest } from "weave";

const execFileAsync = promisify(execFile);
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "weave-opencode-runner-"));
const implementationProfile = createMaintainerOpenCodeImplementationPermissionProfile();
const repairProfile = createMaintainerOpenCodeRepairPermissionProfile();

try {
  assert.equal(OpenCodeCliRunnerConfigSchema.safeParse({}).success, false);
  assert.equal(OpenCodePermissionProfileSchema.safeParse({ type: "maintainer-bounded", name: "old-local-profile" }).success, false);
  assert.equal(OpenCodePermissionProfileSchema.safeParse(implementationProfile).success, true);
  assert.equal(implementationProfile.name, "weave-maintainer-implementation");
  assert.equal(repairProfile.name, "weave-maintainer-repair");
  assert.notEqual(implementationProfile.name, repairProfile.name);
  assert.equal(implementationProfile.tools.network.enabled, false);
  assert.equal(implementationProfile.tools.secrets.enabled, false);
  assert.deepEqual(implementationProfile.tools.git, { allowCommit: false, allowBranchSwitch: false, allowPush: false });
  assert.deepEqual(implementationProfile.tools.shell.commands, ["npm test", "npm run typecheck", "git diff --check"]);
  assert.deepEqual(repairProfile.tools.shell.commands, ["npm test", "npm run typecheck", "git diff --check"]);

  const scenario = await createScenario("mapping");
  const implementationPrompt = buildOpenCodeImplementationPrompt(scenario.implementationInput);
  assert.equal(implementationPrompt.includes("Return only JSON"), true);
  assert.equal(implementationPrompt.includes("Do not merge"), true);
  assert.equal(implementationPrompt.includes("weave/opencode adapter"), true);
  assert.equal(implementationPrompt.includes("src/example.ts"), true);

  const implementationRunInput = buildOpenCodeImplementationRunInput(scenario.implementationInput);
  assert.deepEqual(implementationRunInput.workspace, scenario.workspaceRef);
  assert.deepEqual(implementationRunInput.allowedPaths, ["src/example.ts"]);
  assert.equal(implementationRunInput.prompt, implementationPrompt);

  const repairPrompt = buildOpenCodeRepairPrompt(scenario.repairInput);
  assert.equal(repairPrompt.includes("bounded repair worker"), true);
  assert.equal(repairPrompt.includes("weave/opencode adapter"), true);
  assert.equal(repairPrompt.includes("Tests failed."), true);

  const repairRunInput = buildOpenCodeRepairRunInput(scenario.repairInput);
  assert.deepEqual(repairRunInput.workspace, scenario.workspaceRef);
  assert.deepEqual(repairRunInput.allowedPaths, ["src/example.ts"]);
  assert.equal(repairRunInput.prompt, repairPrompt);

  const maintainerPolicy = createMaintainerOpenCodePolicy({ implementationProfile, repairProfile });
  const allowedPolicyDecision = maintainerPolicy.evaluate(policyRequest(openCodeCapabilityRequestsForProfile(implementationProfile)));
  assert.equal(allowedPolicyDecision?.outcome, "allow");

  const unexpectedNetworkProfile = opencodePermissionProfile({ name: "unexpected-network", tools: { network: true } });
  const unexpectedNetworkCapability = openCodeCapabilityRequestsForProfile(unexpectedNetworkProfile).find((capability) => capability.name === "opencode.network");
  assert(unexpectedNetworkCapability);
  const deniedPolicyDecision = maintainerPolicy.evaluate(policyRequest([unexpectedNetworkCapability]));
  assert.equal(deniedPolicyDecision?.outcome, "deny");
  assert.match(deniedPolicyDecision?.reason ?? "", /Unexpected OpenCode capability/);

  const implementationRunner = createOpenCodeCliImplementationRunner(fakeRunnerConfig(implementationProfile, fakeJsonScript({ filesChanged: ["src/example.ts"], summary: "Implemented." })));
  assert.equal(implementationRunner.openCodeProfile.name, implementationProfile.name);
  assert.equal(implementationRunner.capabilities.some((capability) => capability.name === "opencode.workspace.write"), true);
  const implementation = await implementationRunner.run(scenario.implementationInput);
  assert.deepEqual(implementation.filesChanged, ["src/example.ts"]);
  assert.equal(implementation.summary, "Implemented.");

  const repairRunner = createOpenCodeCliRepairRunner(
    fakeRunnerConfig(
      repairProfile,
      fakeJsonScript({ status: "completed", attempt: 0, filesChanged: ["src/example.ts"], fixesAttempted: ["Fixed test."], summary: "Repair complete." }),
    ),
  );
  assert.equal(repairRunner.openCodeProfile.name, repairProfile.name);
  const repair = await repairRunner.run(scenario.repairInput);
  assert.equal(repair.status, "completed");
  assert.equal(repair.branch, scenario.workspaceRef.workingBranch);
  assert.equal(repair.workspaceRef?.workspaceId, scenario.workspaceRef.workspaceId);

  const branchScenario = await createScenario("branch-mismatch");
  const branchMarker = path.join(branchScenario.workspaceRef.path, "launched.txt");
  const branchMismatchRunner = createOpenCodeCliImplementationRunner(
    fakeRunnerConfig(implementationProfile, fakeJsonScript({ filesChanged: ["src/example.ts"], summary: "Should not launch." }, { writeFile: "launched.txt" })),
  );
  const branchMismatchTool = createOpenCodeImplementationTool(branchMismatchRunner);
  const branchMismatchOutput = await branchMismatchTool.run({
    input: { ...branchScenario.implementationInput, workspaceRef: { ...branchScenario.workspaceRef, workingBranch: "other" } },
    progress: () => undefined,
  } as never);
  assert.equal(branchMismatchOutput.status, "blocked");
  assert.equal(await fileExists(branchMarker), false);

  const reportedOutOfScopeScenario = await createScenario("reported-out-of-scope");
  const reportedOutOfScopeTool = createOpenCodeImplementationTool(
    createOpenCodeCliImplementationRunner(fakeRunnerConfig(implementationProfile, fakeJsonScript({ filesChanged: ["src/other.ts"], summary: "Changed wrong file." }))),
  );
  const reportedOutOfScopeOutput = await reportedOutOfScopeTool.run({ input: reportedOutOfScopeScenario.implementationInput, progress: () => undefined } as never);
  assert.equal(reportedOutOfScopeOutput.status, "blocked");
  assert.match(reportedOutOfScopeOutput.reason, /reported changes outside allowed files/);

  const actualOutOfScopeScenario = await createScenario("actual-out-of-scope");
  const actualOutOfScopeTool = createOpenCodeImplementationTool(
    createOpenCodeCliImplementationRunner(
      fakeRunnerConfig(implementationProfile, fakeJsonScript({ filesChanged: ["src/example.ts"], summary: "Reported only allowed file." }, { writeFile: "docs/outside.md" })),
    ),
  );
  const actualOutOfScopeOutput = await actualOutOfScopeTool.run({ input: actualOutOfScopeScenario.implementationInput, progress: () => undefined } as never);
  assert.equal(actualOutOfScopeOutput.status, "blocked");
  assert.match(actualOutOfScopeOutput.reason, /outside the configured allowed paths/);

  const permissionDeniedScenario = await createScenario("permission-denied");
  const permissionDeniedTool = createOpenCodeImplementationTool(
    createOpenCodeCliImplementationRunner(
      fakeRunnerConfig(implementationProfile, fakeJsonScript({ filesChanged: ["src/example.ts"], summary: "Denied." }, { stderr: "permission denied" })),
    ),
  );
  const permissionDeniedOutput = await permissionDeniedTool.run({ input: permissionDeniedScenario.implementationInput, progress: () => undefined } as never);
  assert.equal(permissionDeniedOutput.status, "blocked");
  assert.match(permissionDeniedOutput.reason, /permission/);

  const permissionRequestScenario = await createScenario("permission-request");
  const permissionRequestTool = createOpenCodeImplementationTool(
    createOpenCodeCliImplementationRunner(
      fakeRunnerConfig(implementationProfile, fakeJsonScript({ filesChanged: ["src/example.ts"], summary: "Requested unsupported permission." }, { stdoutPrefix: "permission requested: network https://example.test\n" })),
    ),
  );
  const permissionRequestOutput = await permissionRequestTool.run({ input: permissionRequestScenario.implementationInput, progress: () => undefined } as never);
  assert.equal(permissionRequestOutput.status, "blocked");
  assert.match(permissionRequestOutput.reason, /permissions outside the configured profile/);

  const invalidJsonScenario = await createScenario("invalid-json");
  const invalidJsonTool = createOpenCodeImplementationTool(createOpenCodeCliImplementationRunner(fakeRunnerConfig(implementationProfile, "process.stdout.write('not json')")));
  const invalidJsonOutput = await invalidJsonTool.run({ input: invalidJsonScenario.implementationInput, progress: () => undefined } as never);
  assert.equal(invalidJsonOutput.status, "blocked");
  assert.match(invalidJsonOutput.reason, /valid JSON/);

  const invalidSchemaScenario = await createScenario("invalid-schema");
  const invalidSchemaTool = createOpenCodeImplementationTool(
    createOpenCodeCliImplementationRunner(fakeRunnerConfig(implementationProfile, fakeJsonScript({ filesChanged: ["src/example.ts"], summary: "" }))),
  );
  const invalidSchemaOutput = await invalidSchemaTool.run({ input: invalidSchemaScenario.implementationInput, progress: () => undefined } as never);
  assert.equal(invalidSchemaOutput.status, "blocked");
  assert.match(invalidSchemaOutput.reason, /schema validation/);

  const maxOutputScenario = await createScenario("max-output");
  const maxOutputTool = createOpenCodeImplementationTool(
    createOpenCodeCliImplementationRunner(fakeRunnerConfig(implementationProfile, "process.stdout.write('x'.repeat(1024)); setTimeout(() => {}, 1000)", { maxOutputBytes: 16, progressIntervalMs: 10 })),
  );
  const maxOutput = await maxOutputTool.run({ input: maxOutputScenario.implementationInput, progress: () => undefined } as never);
  assert.equal(maxOutput.status, "blocked");
  assert.match(maxOutput.reason, /exceeded/);

  const timeoutScenario = await createScenario("timeout");
  const timeoutTool = createOpenCodeImplementationTool(createOpenCodeCliImplementationRunner(fakeRunnerConfig(implementationProfile, "setTimeout(() => {}, 1000)", { timeoutMs: 10 })));
  const timeout = await timeoutTool.run({ input: timeoutScenario.implementationInput, progress: () => undefined } as never);
  assert.equal(timeout.status, "blocked");
  assert.match(timeout.reason, /timed out/);

  const repairBlockedScenario = await createScenario("repair-blocked");
  const repairBlockedTool = createRepairTool(createOpenCodeCliRepairRunner(fakeRunnerConfig(repairProfile, "process.stdout.write('not json')")));
  const repairBlocked = await repairBlockedTool.run({ input: repairBlockedScenario.repairInput, progress: () => undefined } as never);
  assert.equal(repairBlocked.status, "blocked");
  assert.match(repairBlocked.summary, /valid JSON/);

  const runnerSource = await readFile(new URL("../opencode-runner.ts", import.meta.url), "utf8");
  assert.equal(runnerSource.includes('from "weave/opencode"'), true);
  assert.equal(runnerSource.includes("node:child_process"), false);
  assert.equal(runnerSource.includes("spawn("), false);
  assert.equal(runnerSource.includes("execFile"), false);
  assert.equal(runnerSource.includes("parseGitStatusFiles"), false);
  assert.equal(runnerSource.includes("ForbiddenOpenCode"), false);
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
    provider: "git-worktree" as const,
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

function fakeRunnerConfig(profile: OpenCodePermissionProfile, script: string, overrides: Partial<z.input<typeof OpenCodeCliRunnerConfigSchema>> = {}): z.input<typeof OpenCodeCliRunnerConfigSchema> {
  return {
    command: process.execPath,
    args: nodeEvalArgs(script),
    permissionProfile: profile,
    promptDelivery: "stdin",
    cwdArg: false,
    timeoutMs: 5_000,
    maxOutputBytes: 64_000,
    ...overrides,
  };
}

function fakeJsonScript(
  output: Record<string, unknown>,
  options: { permissionRequest?: string; stdoutPrefix?: string; stderr?: string; writeFile?: string } = {},
): string {
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
  ${options.stderr ? `process.stderr.write(${JSON.stringify(options.stderr)});` : ""}
  ${options.permissionRequest ? `process.stdout.write("permission requested: ${options.permissionRequest}\\n");` : ""}
  ${options.stdoutPrefix ? `process.stdout.write(${JSON.stringify(options.stdoutPrefix)});` : ""}
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

function policyRequest(capabilities: readonly CapabilityDeclaration[]): PolicyRequest {
  return {
    type: "tool",
    threadId: "thread",
    agentName: "agent",
    scopeKey: "scope",
    stepKey: "step",
    toolName: "tool",
    input: {},
    capabilities,
  };
}
