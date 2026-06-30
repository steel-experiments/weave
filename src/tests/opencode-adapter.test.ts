import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { capability } from "weave/runtime";
import {
  OpenCodeAdapterError,
  buildOpenCodeChildEnv,
  createOpenCodeCliAdapter,
  openCodeCapabilityRequestsForProfile,
  opencodeDenyAllPermissionProfile,
  opencodePermissionProfile,
  parseOpenCodeJsonOutput,
  runOpenCodeCliCommand,
} from "weave/opencode";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const tempRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "weave-core-opencode-adapter-")));
const OutputSchema = z.object({ summary: z.string().min(1), filesChanged: z.array(z.string()).default([]) });

try {
  const denyAll = opencodeDenyAllPermissionProfile();
  assert.equal(denyAll.tools.readFiles.enabled, false);
  assert.equal(denyAll.tools.writeFiles.enabled, false);
  assert.equal(denyAll.tools.shell.enabled, false);
  assert.equal(denyAll.tools.network.enabled, false);
  assert.equal(denyAll.tools.secrets.enabled, false);
  assert.deepEqual(denyAll.tools.git, { allowCommit: false, allowBranchSwitch: false, allowPush: false });
  assert.deepEqual(openCodeCapabilityRequestsForProfile(denyAll).map((request) => request.name), ["opencode.run"]);

  const workspaceRef = workspaceRefFor("capability-map", path.join(tempRoot, "capability-map"));
  const mappedProfile = opencodePermissionProfile({
    name: "mapped",
    workspace: workspaceRef,
    tools: {
      readFiles: true,
      writeFiles: { allowedPaths: ["src/**"] },
      shell: { commands: ["npm test"] },
      network: false,
      secrets: false,
      git: { allowCommit: false, allowBranchSwitch: false, allowPush: false },
    },
  });
  assert.deepEqual(openCodeCapabilityRequestsForProfile(mappedProfile).map((request) => request.name), [
    "opencode.run",
    "opencode.workspace.read",
    "opencode.workspace.write",
    "opencode.shell",
  ]);
  assert.deepEqual(mappedProfile.allowedPermissionRequests, ["file.read", "workspace.read", "file.write", "workspace.write", "shell npm test"]);

  assert.throws(
    () => opencodePermissionProfile({ exposedTools: [{ name: "custom.missingCapability" } as never] }),
    (error) => error instanceof OpenCodeAdapterError && error.code === "UNSAFE_PROFILE",
  );
  const customCapability = capability({
    name: "custom.search",
    description: "Search an app-owned system.",
    params: z.object({ scope: z.string().min(1) }),
  });
  const customProfile = opencodePermissionProfile({
    exposedTools: [{ name: "custom.search", capabilities: [customCapability], allowedPermissionRequests: ["custom.search"] }],
  });
  assert.equal(customProfile.exposedTools[0]?.capabilities[0], customCapability);
  assert.equal(customProfile.capabilityDeclarations.includes(customCapability), true);

  assert.throws(
    () => opencodePermissionProfile({ tools: { shell: { commands: ["sh -c npm test"] } } }),
    (error) => error instanceof OpenCodeAdapterError && error.code === "UNSAFE_PROFILE",
  );
  assert.throws(
    () => opencodePermissionProfile({ envAllowlist: ["PATH", "GITHUB_TOKEN"] }),
    (error) => error instanceof OpenCodeAdapterError && error.code === "UNSAFE_PROFILE",
  );

  const sanitizedEnv = buildOpenCodeChildEnv(denyAll, { PATH: "/bin" }, { PATH: "/usr/bin", HOME: "/home/test", GITHUB_TOKEN: "secret" });
  assert.deepEqual(sanitizedEnv, { PATH: "/bin", HOME: "/home/test" });

  const adapterSource = await readFile(new URL("../runtime/opencode-adapter.ts", import.meta.url), "utf8");
  assert.equal(adapterSource.includes("examples/weave-maintainer"), false);

  const successScenario = await createScenario("success");
  const successAdapter = createFakeAdapter(fakeJsonScript({ summary: "ok", filesChanged: [] }));
  const success = await successAdapter.run({ workspace: successScenario.workspacePath, prompt: "test prompt" });
  assert.deepEqual(success.output, { summary: "ok", filesChanged: [] });
  assert.deepEqual(success.command.gitChangedFilesAfter, []);
  assert.equal(success.command.args.includes("--pure"), true);

  const inScopeScenario = await createScenario("in-scope");
  const inScopeAdapter = createFakeAdapter(
    fakeJsonScript({ summary: "changed", filesChanged: ["src/example.ts"] }, { writeFile: "src/example.ts" }),
    opencodePermissionProfile({ tools: { writeFiles: { allowedPaths: ["src/**"] } } }),
  );
  const inScope = await inScopeAdapter.run({ workspace: inScopeScenario.workspacePath, prompt: "test prompt", allowedPaths: ["src/**"] });
  assert.deepEqual(inScope.changedFiles, ["src/example.ts"]);

  const invalidJsonScenario = await createScenario("invalid-json");
  await assertRejectsCode(
    () => createFakeAdapter("process.stdout.write('not json')").run({ workspace: invalidJsonScenario.workspacePath, prompt: "test prompt" }),
    "INVALID_JSON",
  );

  const invalidSchemaScenario = await createScenario("invalid-schema");
  await assertRejectsCode(
    () => createFakeAdapter(fakeJsonScript({ summary: "", filesChanged: [] })).run({ workspace: invalidSchemaScenario.workspacePath, prompt: "test prompt" }),
    "INVALID_SCHEMA",
  );

  const timeoutScenario = await createScenario("timeout");
  await assertRejectsCode(
    () => createFakeAdapter("setTimeout(() => {}, 1000)", undefined, { timeoutMs: 10 }).run({ workspace: timeoutScenario.workspacePath, prompt: "test prompt" }),
    "TIMEOUT",
  );

  const maxOutputScenario = await createScenario("max-output");
  await assertRejectsCode(
    () => createFakeAdapter("process.stdout.write('x'.repeat(1024)); setTimeout(() => {}, 1000)", undefined, { maxOutputBytes: 16 }).run({ workspace: maxOutputScenario.workspacePath, prompt: "test prompt" }),
    "MAX_OUTPUT_EXCEEDED",
  );

  assert.throws(
    () => createFakeAdapter(fakeJsonScript({ summary: "ok", filesChanged: [] }), undefined, { env: { GITHUB_TOKEN: "secret" } }),
    (error) => error instanceof OpenCodeAdapterError && error.code === "UNSAFE_ENV",
  );

  assert.throws(
    () => createFakeAdapter(fakeJsonScript({ summary: "ok", filesChanged: [] }), undefined, { args: [...nodeEvalArgs("process.stdout.write('{}')"), "--dangerously-skip-permissions"] }),
    (error) => error instanceof OpenCodeAdapterError && error.code === "UNSAFE_ARGS",
  );
  assert.throws(
    () => createFakeAdapter(fakeJsonScript({ summary: "ok", filesChanged: [] }), undefined, { command: "sh" }),
    (error) => error instanceof OpenCodeAdapterError && error.code === "UNSAFE_CONFIG",
  );

  const permissionScenario = await createScenario("permission-request");
  await assertRejectsCode(
    () =>
      createFakeAdapter(fakeJsonScript({ summary: "ok", filesChanged: [] }, { stdoutPrefix: "permission requested: network https://example.test\\n" })).run({
        workspace: permissionScenario.workspacePath,
        prompt: "test prompt",
      }),
    "PERMISSION_REQUEST_BLOCKED",
  );

  const deniedScenario = await createScenario("permission-denied");
  await assertRejectsCode(
    () => createFakeAdapter(fakeJsonScript({ summary: "ok", filesChanged: [] }, { stderr: "permission denied" })).run({ workspace: deniedScenario.workspacePath, prompt: "test prompt" }),
    "PERMISSION_DENIED",
  );

  const outOfScopeScenario = await createScenario("out-of-scope");
  const writeSrcOnlyProfile = opencodePermissionProfile({ tools: { writeFiles: { allowedPaths: ["src/**"] } } });
  await assertRejectsCode(
    () =>
      createFakeAdapter(fakeJsonScript({ summary: "reported only src", filesChanged: ["src/example.ts"] }, { writeFile: "docs/outside.md" }), writeSrcOnlyProfile).run({
        workspace: outOfScopeScenario.workspacePath,
        prompt: "test prompt",
        allowedPaths: ["src/**"],
      }),
    "OUT_OF_SCOPE_DIFF",
  );

  const nonGitRoot = await mkdtemp(path.join(tempRoot, "not-git-"));
  await assertRejectsCode(
    () => createFakeAdapter(fakeJsonScript({ summary: "ok", filesChanged: [] })).run({ workspace: nonGitRoot, prompt: "test prompt" }),
    "WORKSPACE_INVALID",
  );

  const directScenario = await createScenario("direct-command");
  const directProfile = opencodePermissionProfile();
  const directResult = await runOpenCodeCliCommand(
    {
      profile: directProfile,
      cli: { command: process.execPath, args: nodeEvalArgs("process.stdout.write(JSON.stringify({ summary: 'direct', filesChanged: [] }))"), cwdArg: false, promptDelivery: "stdin", timeoutMs: 5_000 },
    },
    { cwd: directScenario.workspacePath, prompt: "test prompt" },
  );
  assert.equal(parseOpenCodeJsonOutput(directResult.stdout, OutputSchema).summary, "direct");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

console.log("OpenCode adapter tests passed");

function createFakeAdapter(script: string, profile = opencodePermissionProfile(), cliOverrides: Parameters<typeof createOpenCodeCliAdapter>[0]["cli"] = {}) {
  return createOpenCodeCliAdapter({
    profile,
    output: OutputSchema,
    cli: {
      command: process.execPath,
      args: nodeEvalArgs(script),
      cwdArg: false,
      promptDelivery: "stdin",
      timeoutMs: 5_000,
      maxStdoutBytes: 64_000,
      maxStderrBytes: 64_000,
      maxOutputBytes: 64_000,
      progressIntervalMs: 1_000,
      ...cliOverrides,
    },
  });
}

async function createScenario(label: string): Promise<{ workspacePath: string }> {
  const workspacePath = await mkdtemp(path.join(tempRoot, `${label}-`));
  await execFileAsync("git", ["init"], { cwd: workspacePath });
  await mkdir(path.join(workspacePath, "src"), { recursive: true });
  return { workspacePath };
}

function workspaceRefFor(label: string, workspacePath: string) {
  return {
    provider: "git-worktree",
    workspaceId: `${label}-workspace`,
    path: workspacePath,
    repo: "weave",
    baseBranch: "main",
    workingBranch: "feature/opencode-adapter",
    baseCommit: "abc123",
  };
}

function fakeJsonScript(
  output: Record<string, unknown>,
  options: { writeFile?: string; stdoutPrefix?: string; stderr?: string } = {},
): string {
  return `const fs = require("node:fs");
const path = require("node:path");
let input = "";
process.stdin.on("data", chunk => input += chunk);
process.stdin.on("end", () => {
  if (!input.includes("test prompt")) {
    process.stderr.write("missing prompt");
    process.exit(2);
  }
  ${options.writeFile ? `fs.mkdirSync(path.dirname(${JSON.stringify(options.writeFile)}), { recursive: true }); fs.writeFileSync(${JSON.stringify(options.writeFile)}, "changed");` : ""}
  ${options.stderr ? `process.stderr.write(${JSON.stringify(options.stderr)});` : ""}
  ${options.stdoutPrefix ? `process.stdout.write(${JSON.stringify(options.stdoutPrefix)});` : ""}
  process.stdout.write(JSON.stringify(${JSON.stringify(output)}));
});`;
}

function nodeEvalArgs(script: string): string[] {
  return ["-e", script, "--"];
}

async function assertRejectsCode(action: () => Promise<unknown>, code: OpenCodeAdapterError["code"]): Promise<void> {
  await assert.rejects(
    action,
    (error) => error instanceof OpenCodeAdapterError && error.code === code,
  );
}
