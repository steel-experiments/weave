import assert from "node:assert/strict";
import { createOpenCodeCliRunner } from "./opencode-adapter.js";
import { ClaimCheckOutputSchema, type ClaimCheckInput } from "./schemas.js";
import { runPromptWorkflowReviewDemo } from "./workflow.js";

const model = process.env.OPENCODE_MODEL ?? "openai/gpt-5.5-fast";
const binary = process.env.OPENCODE_BINARY ?? "opencode";

const realOpenCodeClaimRunner = createOpenCodeCliRunner<ClaimCheckInput>({
  binary,
  model,
  agent: process.env.OPENCODE_AGENT ?? "summary",
  timeoutMs: 120_000,
  async buildPrompt(session) {
    const search = await session.tools.searchText({ query: session.input.claim.text, maxResults: 5 });
    const evidence = [];
    for (const match of search.matches.slice(0, 3)) {
      const range = await session.tools.readRange({ path: match.path, startLine: match.line, endLine: match.line });
      evidence.push({ path: match.path, line: match.line, text: range.content });
    }

    return [
      "You are checking one technical claim against repository evidence already supplied below.",
      "Do not inspect files. Do not call tools. Use only the evidence in this prompt.",
      "Return JSON only, with no markdown, matching this TypeScript shape:",
      '{"claim":"string","status":"verified|unsupported|needs-review","confidence":0.0,"evidence":["path:line text"],"checkerNotes":"string"}',
      `Claim: ${session.input.claim.text}`,
      `Task prompt: ${session.taskPrompt}`,
      `Evidence JSON: ${JSON.stringify(evidence)}`,
      "If the evidence directly supports the claim, use status verified and confidence at least 0.75.",
      "If the evidence is empty or unrelated, use needs-review or unsupported with confidence below 0.75.",
    ].join("\n");
  },
});

const result = await runPromptWorkflowReviewDemo(
  {
    prompt: "Use the real OpenCode CLI to check this single repository claim with mediated read-only tools.",
    document: "Claim: Weave child threads preserve root thread lineage across nested descendants.",
  },
  { claimCheckRunner: realOpenCodeClaimRunner },
);

assert.equal(result.report.claims.length, 1);
ClaimCheckOutputSchema.parse({
  claim: result.report.claims[0]?.claim,
  status: result.report.claims[0]?.status,
  confidence: result.report.claims[0]?.confidence,
  evidence: result.report.claims[0]?.evidence,
  checkerNotes: "validated through final report schema",
});
assert(result.allEvents.some((event) => event.type === "tool.requested" && event.payload.toolName === "repo.searchText"));
assert(result.allEvents.some((event) => event.type === "tool.requested" && event.payload.toolName === "repo.readRange"));
assert(result.allEvents.some((event) => event.type === "checkpoint.completed" && event.stepKey === "opencode-task-spec"));

console.log(`Real OpenCode integration test passed with ${binary} ${model}`);
