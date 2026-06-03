import assert from "node:assert/strict";
import { compileWorkflowPlan, defaultWorkflowInput, extractClaims, planRequiresApproval, runPromptWorkflowReviewDemo, workflowPlanHash } from "./workflow.js";

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

const result = await runPromptWorkflowReviewDemo(input);
assert.equal(result.report.recommendation, "do-not-publish");
assert.equal(result.report.claims.length, 3);
assert(result.childThreadIds.length >= 5);
assert(result.events.some((event) => event.type === "checkpoint.completed"));
assert(result.events.some((event) => event.type === "agent.finding.produced"));
assert(result.allEvents.some((event) => event.type === "policy.evaluated"));
assert(result.allEvents.some((event) => event.type === "tool.requested" && event.payload.toolName === "repo.searchEvidence"));
assert.equal(result.events.filter((event) => event.type === "child_thread.spawned").length, new Set(result.childThreadIds).size);

console.log("Prompt workflow review example tests passed");
