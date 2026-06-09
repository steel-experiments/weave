import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInitiativeRunInput,
  formatInitiativeRunResumeCommand,
  parseInitiativeRunOptions,
  slugify,
  titleFromMarkdown,
} from "../development-initiative-runner.js";
import { compileMarkdownInitiativePlan } from "../development-orchestrator.js";

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
assert.equal(
  formatInitiativeRunResumeCommand({
    from: "docs/prds/auth-gateway-epic.md",
    baseBranch: "main",
    workingBranch: "auth-gateway-remaining",
    idempotencyKey: "initiative-run:v1:f13b53d0f365:main:auth-gateway-remaining",
  }),
  "npm run initiative:run -- --from docs/prds/auth-gateway-epic.md --base-branch main --working-branch auth-gateway-remaining --idempotency-key initiative-run:v1:f13b53d0f365:main:auth-gateway-remaining",
);
assert.match(formatInitiativeRunResumeCommand({
  from: "docs/prds/auth gateway.md",
  baseBranch: "main",
  workingBranch: "auth-gateway-remaining",
  idempotencyKey: "key",
  openCodeArgs: ["run", "--format", "json"],
}), /'docs\/prds\/auth gateway\.md'/);
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
  assert.deepEqual(built.initiativeInput.contextFiles, ["dashboard-prd.md", "examples/weave-maintainer/docs/README.md"]);
  assert.match(built.idempotencyKey, /^initiative-run:v1:/);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const authEpicPrd = await readFile(path.join(repoRoot, "docs/prds/auth-gateway-epic.md"), "utf8");
const authEpicPlan = compileMarkdownInitiativePlan({
  repo: "weave",
  baseBranch: "main",
  workingBranch: "auth-gateway-remaining",
  spec: {
    title: titleFromMarkdown(authEpicPrd) ?? "Auth Gateway Remaining Epic",
    statementOfWork: authEpicPrd,
    source: "prd",
    contextFiles: ["docs/prds/auth-gateway-epic.md", "examples/weave-maintainer/docs/README.md"],
  },
});
assert.deepEqual(authEpicPlan.slices.map((slice) => slice.title), [
  "Authenticated Thread Actions",
  "Authenticated Integration Ingress",
  "Auth Decision Audit Trail",
  "Auth Provider Adapter Boundary",
]);
assert.equal(authEpicPlan.slices.length, 4);
assert.equal(authEpicPlan.slices.every((slice) => slice.acceptanceCriteria.length >= 6), true);

console.log("Development initiative runner tests passed");
