import assert from "node:assert/strict";
import {
  agent,
  approvalPolicy,
  capability,
  defineCapability,
  defineAgent,
  defineApprovalPolicy,
  defineEvent,
  defineIntegration,
  defineTool,
  defineWeaveApp,
  event,
  integration,
  policy,
  tool,
  weave,
  definePolicy,
} from "weave";
import { ThreadService, ContractToolWorker, ThreadRunner, createWeaveRuntime } from "weave/runtime";
import { PostgresThreadEngine, createPool, migrate } from "weave/postgres";
import { createApiServer } from "weave/server";
import { DeterministicMockAgent, MockAsyncToolWorker } from "weave/testing";
import { z } from "zod";

const inputSchema = z.object({ text: z.string().min(1) });
const outputSchema = z.object({ text: z.string().min(1) });

const githubRead = capability({
  name: "github.read",
  description: "Read GitHub issues and pull requests.",
  scopes: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
  }),
});
const definedGitHubWrite = defineCapability({
  name: "github.write",
  description: "Write GitHub issues and pull requests.",
  scopes: z.object({
    owner: z.string().min(1),
    repo: z.string().min(1),
  }),
});

const echoTool = tool({
  name: "public-api.echo",
  description: "Echo input text.",
  input: inputSchema,
  output: outputSchema,
  capabilities: [githubRead],
  summarize(output) {
    return output.text;
  },
  run(ctx) {
    return { text: ctx.input.text };
  },
});

const echoAgent = agent({
  name: "public-api.agent",
  input: inputSchema,
  output: outputSchema,
  tools: [echoTool],
  async run(ctx, input) {
    return ctx.tool("echo", echoTool, input);
  },
});

const allowEchoPolicy = policy({
  name: "public-api.allow-echo",
  evaluate(request) {
    return request.type === "tool" && request.toolName === "public-api.echo" ? { outcome: "allow" } : undefined;
  },
});
const denyNothingPolicy = definePolicy({
  name: "public-api.deny-nothing",
  evaluate() {
    return undefined;
  },
});

const echoIntegration = integration({
  name: "public-api.integration",
  tools: [echoTool],
});

const echoApp = weave({
  name: "public-api-app",
  agents: [echoAgent],
  tools: [echoTool],
  integrations: [echoIntegration],
  policies: [allowEchoPolicy],
});

assert.equal(defineTool(echoTool), echoTool);
assert.equal(defineAgent(echoAgent), echoAgent);
assert.equal(defineIntegration(echoIntegration), echoIntegration);
assert.equal(defineWeaveApp(echoApp), echoApp);
assert.equal(githubRead.name, "github.read");
assert.equal(definedGitHubWrite.name, "github.write");
assert.equal(echoTool.capabilities?.[0], githubRead);
assert.equal(allowEchoPolicy.name, "public-api.allow-echo");
assert.equal(denyNothingPolicy.name, "public-api.deny-nothing");
assert.equal(echoApp.policies?.[0], allowEchoPolicy);

const emitted = event("agent.response.produced", { message: "ok" });
const defined = defineEvent("agent.response.produced", { message: "ok" });
const responseProduced = event({
  type: "agent.response.produced",
  payload: z.object({ message: z.string().min(1) }),
  description: "Public API response event.",
});
assert.equal(emitted.type, "agent.response.produced");
assert.deepEqual(defined.payload, { message: "ok" });
assert.equal(responseProduced.type, "agent.response.produced");
assert.equal(responseProduced.description, "Public API response event.");
assert.deepEqual(responseProduced({ message: "ok" }).payload, { message: "ok" });

const approval = approvalPolicy({
  name: "public-api.policy",
  requiresApproval(input: { risky: boolean }) {
    return input.risky;
  },
  gate() {
    return { reason: "risky-remediation", proposedAction: "approve public api smoke test" };
  },
});
const definedPolicy = defineApprovalPolicy({
  name: "public-api.defined-policy",
  requiresApproval(input: { risky: boolean }) {
    return input.risky;
  },
  gate() {
    return { reason: "risky-remediation" };
  },
});

assert.equal(approval.evaluate({ risky: false }), undefined);
assert.equal(approval.evaluate({ risky: true })?.reason, "risky-remediation");
assert.equal(definedPolicy.requiresApproval({ risky: true }), true);

assert.equal(typeof createWeaveRuntime, "function");
assert.equal(typeof ThreadRunner, "function");
assert.equal(typeof ContractToolWorker, "function");
assert.equal(typeof ThreadService, "function");

assert.equal(typeof PostgresThreadEngine, "function");
assert.equal(typeof createPool, "function");
assert.equal(typeof migrate, "function");

assert.equal(typeof createApiServer, "function");

assert.equal(typeof DeterministicMockAgent, "function");
assert.equal(typeof MockAsyncToolWorker, "function");

assert.equal(echoApp.agents[0]?.name, "public-api.agent");
assert.equal(echoApp.integrations?.[0]?.name, "public-api.integration");

console.log("Public API export smoke test passed");
