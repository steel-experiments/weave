import assert from "node:assert/strict";
import { z } from "zod";
import { isDomainEvent } from "weave/runtime";
import { FINDING_PRODUCED } from "./events.js";
import {
  RepoListFilesInputSchema,
  RepoReadFileInputSchema,
  RepoReadRangeInputSchema,
  RepoSearchTextInputSchema,
  defaultOpenCodeDeniedGlobs,
  defaultOpenCodeRepoRoot,
  hasMutableHarnessCapability,
  listRepositoryFiles,
  parseOpenCodeStructuredOutput,
  readRepositoryFile,
  readRepositoryRange,
  searchRepositoryText,
  workflowCapabilityDecision,
} from "./opencode-adapter.js";
import { createMockModelWorkflowCompiler } from "./workflow-compiler.js";
import {
  compileWorkflowPlan,
  compileWorkflowPlanFromCompiler,
  defaultWorkflowInput,
  extractClaims,
  planRequiresApproval,
  runPromptWorkflowReviewDemo,
  workflowPlanHash,
} from "./workflow.js";

const input = defaultWorkflowInput();

const plan = compileWorkflowPlan(input);
assert.equal(plan.pattern, "adversarial-verification");
assert.equal(plan.requiredCapabilities.some((capability) => capability.name === "repo.read"), true);
assert.equal(planRequiresApproval(plan), false);
assert.equal(plan.steps[0]?.key, "extract-claims");
assert.equal(workflowPlanHash(plan), workflowPlanHash(compileWorkflowPlan(input)));

const claims = extractClaims(input.document);
assert.equal(claims.length, 3);
assert.deepEqual(claims.map((claim) => claim.key), extractClaims(input.document).map((claim) => claim.key));

const unsafePlan = compileWorkflowPlan({
  ...input,
  prompt: `${input.prompt} Also use network access and write fixes back to the repository.`,
});
assert.equal(planRequiresApproval(unsafePlan), true);
assert.equal(unsafePlan.requiredCapabilities.some((capability) => capability.name === "network.access"), true);
assert.equal(unsafePlan.requiredCapabilities.some((capability) => capability.name === "repo.write"), true);

assert.deepEqual(RepoListFilesInputSchema.parse({ directory: "docs", maxResults: 5 }), { directory: "docs", maxResults: 5 });
assert.deepEqual(RepoReadFileInputSchema.parse({ path: "docs/declarative-api.md" }), { path: "docs/declarative-api.md" });
assert.deepEqual(RepoReadRangeInputSchema.parse({ path: "docs/declarative-api.md", startLine: 1, endLine: 2 }), {
  path: "docs/declarative-api.md",
  startLine: 1,
  endLine: 2,
});
assert.deepEqual(RepoSearchTextInputSchema.parse({ query: "child thread lineage" }), { query: "child thread lineage" });
assert.equal(workflowCapabilityDecision(["repo.read"]), "allow");
assert.equal(workflowCapabilityDecision(["network.access"]), "deny");
assert.equal(workflowCapabilityDecision(["shell.exec"]), "deny");
assert.equal(workflowCapabilityDecision(["repo.write"]), "deny");
assert.equal(hasMutableHarnessCapability("network.access"), true);
assert.equal(hasMutableHarnessCapability("shell.exec"), true);
assert.equal(hasMutableHarnessCapability("repo.write"), true);

const repoRoot = defaultOpenCodeRepoRoot();
const deniedGlobs = defaultOpenCodeDeniedGlobs();
const listedFiles = await listRepositoryFiles({ root: repoRoot, deniedGlobs, directory: "docs/slices", maxListFiles: 100 });
assert(listedFiles.files.some((file) => file.path === "docs/slices/50-full-opencode-adapter.md"));
const sliceFile = await readRepositoryFile({ root: repoRoot, deniedGlobs, path: "docs/slices/50-full-opencode-adapter.md", maxFileSizeBytes: 50_000 });
assert(sliceFile.content.includes("Full OpenCode Adapter"));
const sliceRange = await readRepositoryRange({
  root: repoRoot,
  deniedGlobs,
  path: "docs/slices/50-full-opencode-adapter.md",
  startLine: 1,
  endLine: 1,
  maxFileSizeBytes: 50_000,
});
assert.equal(sliceRange.content, "# Full OpenCode Adapter");
const repoSearch = await searchRepositoryText({
  root: repoRoot,
  deniedGlobs,
  query: "Adapt the example-local OpenCode-style harness",
  maxResults: 100,
  maxSearchFiles: 1_000,
  maxFileSizeBytes: 50_000,
});
assert(repoSearch.matches.some((match) => match.path === "docs/slices/50-full-opencode-adapter.md"));
await assert.rejects(
  () => readRepositoryFile({ root: repoRoot, deniedGlobs, path: "../package.json", maxFileSizeBytes: 50_000 }),
  /escapes root/,
);
await assert.rejects(
  () => listRepositoryFiles({ root: repoRoot, deniedGlobs, directory: ".git", maxListFiles: 5 }),
  /denied by glob/,
);
await assert.rejects(
  () => readRepositoryFile({ root: repoRoot, deniedGlobs, path: "package.json", maxFileSizeBytes: 1 }),
  /exceeds maxFileSizeBytes=1/,
);
assert.equal(parseOpenCodeStructuredOutput('{"ok":true}', z.object({ ok: z.literal(true) }), 100).ok, true);
assert.throws(() => parseOpenCodeStructuredOutput("not-json", z.object({ ok: z.boolean() }), 100), /Unexpected token|JSON/);
assert.throws(() => parseOpenCodeStructuredOutput({ ok: true }, z.object({ ok: z.boolean() }), 2), /maxOutputBytes=2/);

const mockedModelCompiler = createMockModelWorkflowCompiler(plan);
const modelPlan = await compileWorkflowPlanFromCompiler(input, mockedModelCompiler);
assert.deepEqual(modelPlan, plan);

await assert.rejects(
  () => compileWorkflowPlanFromCompiler(input, createMockModelWorkflowCompiler({ ...plan, pattern: "unknown-pattern" })),
  /Invalid option/,
);
await assert.rejects(
  () =>
    compileWorkflowPlanFromCompiler(
      input,
      createMockModelWorkflowCompiler({
        ...plan,
        steps: [{ kind: "spawn", key: "unknown-agent", agentName: "workflow.unregistered", input: {} }],
      }),
    ),
  /unregistered agents: workflow\.unregistered/,
);
await assert.rejects(
  () => compileWorkflowPlanFromCompiler(input, createMockModelWorkflowCompiler(unsafePlan), "reject"),
  /unsafe capabilities: network\.access, repo\.write/,
);
await assert.rejects(
  () => compileWorkflowPlanFromCompiler(input, createMockModelWorkflowCompiler({ ...plan, generatedJavaScript: "ctx.spawn(...)" })),
  /executable field: generatedJavaScript/,
);

const result = await runPromptWorkflowReviewDemo(input);
assert.equal(result.report.recommendation, "do-not-publish");
assert.equal(result.report.claims.length, 3);
assert(result.childThreadIds.length >= 5);
assert(result.events.some((event) => event.type === "checkpoint.completed"));
assert(result.events.some((event) => isDomainEvent(event, FINDING_PRODUCED)));
assert(result.allEvents.some((event) => event.type === "policy.evaluated"));
assert(result.allEvents.some((event) => event.type === "tool.requested" && event.payload.toolName === "repo.searchText"));
assert(result.allEvents.some((event) => event.type === "tool.requested" && event.payload.toolName === "repo.readRange"));
assert(result.allEvents.some((event) => event.type === "checkpoint.completed" && event.stepKey === "opencode-task-spec"));
assert(result.allEvents.some((event) => event.type === "checkpoint.completed" && event.stepKey === "opencode-adapter-limits"));
assert.equal(result.events.filter((event) => event.type === "child_thread.spawned").length, new Set(result.childThreadIds).size);

const modelResult = await runPromptWorkflowReviewDemo(input, { compiler: mockedModelCompiler });
assert.equal(modelResult.report.recommendation, "do-not-publish");
assert.equal(modelResult.report.claims.length, 3);
assert(modelResult.events.some((event) => event.type === "checkpoint.completed" && event.stepKey === "workflow-plan"));

console.log("Prompt workflow review example tests passed");
