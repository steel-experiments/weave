import { toTextTimeline } from "weave/runtime";
import { runPromptWorkflowReviewDemo } from "./workflow.js";

const result = await runPromptWorkflowReviewDemo();

console.log("Prompt workflow review demo completed");
console.log(`threadId=${result.threadId}`);
console.log(`childThreads=${result.childThreadIds.length}`);
console.log(`recommendation=${result.report.recommendation}`);
console.log(result.report.summary);
for (const claim of result.report.claims) {
  console.log(`- [${claim.status}] confidence=${claim.confidence} ${claim.claim}`);
  for (const evidence of claim.evidence) {
    console.log(`  evidence: ${evidence}`);
  }
  if (claim.verifierNotes) {
    console.log(`  verifier: ${claim.verifierNotes}`);
  }
}
console.log("timeline:");
console.log(toTextTimeline(result.events));
