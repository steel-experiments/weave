import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildInitiativeRunInput,
  parseInitiativeRunOptions,
  slugify,
  titleFromMarkdown,
} from "../development-initiative-runner.js";

assert.equal(titleFromMarkdown("# Build The Thing\n\nBody"), "Build The Thing");
assert.equal(titleFromMarkdown("Body only"), undefined);
assert.equal(slugify("Build PRD/SOW Automation!"), "build-prd-sow-automation");

const parsed = parseInitiativeRunOptions([
  "--from",
  "docs/prds/example.md",
  "--base-branch",
  "main",
  "--working-branch",
  "prd-automation",
  "--timeout-ms",
  "12345",
  "--opencode-args",
  "run --format json",
]);

assert.equal(parsed.from, "docs/prds/example.md");
assert.equal(parsed.baseBranch, "main");
assert.equal(parsed.workingBranch, "prd-automation");
assert.equal(parsed.timeoutMs, 12345);
assert.deepEqual(parsed.openCodeArgs, ["run", "--format", "json"]);
assert.throws(() => parseInitiativeRunOptions(["--from"]), /requires a value/);
assert.throws(() => parseInitiativeRunOptions(["--unknown"]), /Unknown option/);

const tempDir = await mkdtemp(path.join(tmpdir(), "weave-initiative-runner-test-"));
try {
  const prdPath = path.join(tempDir, "dashboard-prd.md");
  await writeFile(
    prdPath,
    `# Local Workflow Dashboard\n\nBuild a local dashboard.\n\n## Slice 1: Dashboard Shell\n\nAdd the shell.\n`,
    "utf8",
  );
  const built = await buildInitiativeRunInput({
    options: parseInitiativeRunOptions(["--from", "dashboard-prd.md"]),
    repoRoot: tempDir,
    baseBranch: "main",
  });

  assert.equal(built.initiativeInput.initiative, "Local Workflow Dashboard");
  assert.equal(built.initiativeInput.workingBranch, "initiative-local-workflow-dashboard");
  assert.equal(built.initiativeInput.initiativeSpec?.source, "prd");
  assert.deepEqual(built.initiativeInput.contextFiles, ["dashboard-prd.md", "docs/development-orchestrator/README.md"]);
  assert.match(built.idempotencyKey, /^initiative-run:v1:/);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("Development initiative runner tests passed");
