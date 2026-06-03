import assert from "node:assert/strict";
import { RepoReadFileInputSchema, RepoSearchTextInputSchema, hasMutableHarnessCapability, workflowCapabilityDecision } from "./opencode-harness.js";
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

assert.deepEqual(RepoReadFileInputSchema.parse({ path: "docs/declarative-api.md" }), { path: "docs/declarative-api.md" });
assert.deepEqual(RepoSearchTextInputSchema.parse({ query: "child thread lineage" }), { query: "child thread lineage" });
assert.equal(workflowCapabilityDecision(["repo.read"]), "allow");
assert.equal(workflowCapabilityDecision(["network.access"]), "deny");
assert.equal(workflowCapabilityDecision(["shell.exec"]), "deny");
assert.equal(workflowCapabilityDecision(["repo.write"]), "deny");
assert.equal(hasMutableHarnessCapability("network.access"), true);
assert.equal(hasMutableHarnessCapability("shell.exec"), true);
assert.equal(hasMutableHarnessCapability("repo.write"), true);

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
assert(result.events.some((event) => event.type === "agent.finding.produced"));
assert(result.allEvents.some((event) => event.type === "policy.evaluated"));
assert(result.allEvents.some((event) => event.type === "tool.requested" && event.payload.toolName === "repo.searchText"));
assert(result.allEvents.some((event) => event.type === "tool.requested" && event.payload.toolName === "repo.readFile"));
assert(result.allEvents.some((event) => event.type === "checkpoint.completed" && event.stepKey === "opencode-harness-limits"));
assert.equal(result.events.filter((event) => event.type === "child_thread.spawned").length, new Set(result.childThreadIds).size);

const modelResult = await runPromptWorkflowReviewDemo(input, { compiler: mockedModelCompiler });
assert.equal(modelResult.report.recommendation, "do-not-publish");
assert.equal(modelResult.report.claims.length, 3);
assert(modelResult.events.some((event) => event.type === "checkpoint.completed" && event.stepKey === "workflow-plan"));

console.log("Prompt workflow review example tests passed");
