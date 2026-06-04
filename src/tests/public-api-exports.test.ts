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
  integrationEvent,
  isCapabilityRequest,
  policy,
  tool,
  weave,
  definePolicy,
  DevelopmentInitiativeInputSchema,
  DevelopmentWorkspacePolicySchema,
  developmentBranchStateReadTool,
  developmentRepoContextReadTool,
  developmentEvents,
  weaveMaintainer,
  weaveSliceRunner,
  buildPrDraft,
  buildWorkspaceAllocateInput,
  createWeaveMaintainerAgent,
  createGithubPrUpsertTool,
  createSliceRunnerAgent,
  createOpenCodeImplementerAgent,
  createOpenCodeImplementationTool,
  createPrAgent,
  createRepairAgent,
  createRepairTool,
  createReviewerAgent,
  createVerificationAgent,
  createInitialInitiativeExecutionState,
  decideNextSliceAction,
  decideNextInitiativeAction,
  decideRepairLoop,
  shouldCleanupWorkspace,
  OpenCodeCliRunnerConfigSchema,
  OpenCodeRunnerError,
  buildOpenCodeImplementationPrompt,
  buildOpenCodeRepairPrompt,
  createOpenCodeCliImplementationRunner,
  createOpenCodeCliRepairRunner,
  InitiativeActionSchema,
  InitiativeExecutionStateSchema,
  SliceActionSchema,
  SliceExecutionStateSchema,
  GitWorktreeWorkspaceProvider,
  WorkspaceRefSchema,
  createWorkspaceAllocateTool,
  repairAttemptKey,
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
    await ctx.sleep("brief-wait", { milliseconds: 0 });
    await ctx.waitForSignal("external-ok", { signal: "public-api.ok", schema: z.object({ ok: z.literal(true) }) });
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
  eventHandlers: [
    integrationEvent({
      type: "agent.response.produced",
      handle(event) {
        assert.equal(event.payload.message.length > 0, true);
      },
    }),
  ],
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
const githubReadRequest = githubRead.request({ owner: "acme", repo: "agent-mailbox" });
assert.equal(isCapabilityRequest(githubReadRequest), true);
assert.equal(githubReadRequest.credential.name, "github.read");
assert(Array.isArray(echoTool.capabilities));
assert.equal(echoTool.capabilities?.[0], githubRead);
assert.equal(allowEchoPolicy.name, "public-api.allow-echo");
assert.equal(denyNothingPolicy.name, "public-api.deny-nothing");
assert.equal(echoApp.policies?.[0], allowEchoPolicy);
assert.equal(typeof DevelopmentInitiativeInputSchema.parse, "function");
assert.equal(DevelopmentWorkspacePolicySchema.parse({}).mode, "initiative");
assert.equal(developmentEvents.sliceCompleted.type, "dev.slice.completed");
assert.equal(weaveMaintainer.name, "weave.maintainer");
assert.equal(developmentRepoContextReadTool.name, "dev.repoContext.read");
assert.equal(developmentBranchStateReadTool.name, "dev.branchState.read");
assert.equal(weaveSliceRunner.name, "weave.sliceRunner");
assert.equal(typeof createWeaveMaintainerAgent, "function");
assert.equal(typeof createOpenCodeImplementerAgent, "function");
assert.equal(typeof createOpenCodeImplementationTool, "function");
assert.equal(typeof createVerificationAgent, "function");
assert.equal(typeof createReviewerAgent, "function");
assert.equal(typeof createRepairAgent, "function");
assert.equal(typeof createRepairTool, "function");
assert.equal(typeof buildPrDraft, "function");
assert.equal(typeof createPrAgent, "function");
assert.equal(typeof createGithubPrUpsertTool, "function");
assert.equal(typeof createSliceRunnerAgent, "function");
assert.equal(typeof createInitialInitiativeExecutionState, "function");
assert.equal(typeof buildWorkspaceAllocateInput, "function");
assert.equal(typeof shouldCleanupWorkspace, "function");
assert.equal(OpenCodeCliRunnerConfigSchema.parse({}).command, "opencode");
assert.equal(typeof OpenCodeRunnerError, "function");
assert.equal(typeof buildOpenCodeImplementationPrompt, "function");
assert.equal(typeof buildOpenCodeRepairPrompt, "function");
assert.equal(typeof createOpenCodeCliImplementationRunner, "function");
assert.equal(typeof createOpenCodeCliRepairRunner, "function");
assert.equal(typeof decideNextSliceAction, "function");
assert.equal(typeof decideNextInitiativeAction, "function");
assert.equal(typeof InitiativeExecutionStateSchema.parse, "function");
assert.equal(typeof InitiativeActionSchema.parse, "function");
assert.equal(typeof SliceExecutionStateSchema.parse, "function");
assert.equal(typeof SliceActionSchema.parse, "function");
assert.equal(repairAttemptKey(1), "repair:1");
assert.equal(decideRepairLoop({ currentAttempt: 0, maxAttempts: 1, findings: [{ severity: "low", issue: "test" }] }).status, "attempt-repair");
assert.equal(typeof GitWorktreeWorkspaceProvider, "function");
assert.equal(typeof WorkspaceRefSchema.parse, "function");
assert.equal(createWorkspaceAllocateTool(new GitWorktreeWorkspaceProvider()).name, "workspace.allocate");

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
assert.deepEqual(echoIntegration.eventHandlers?.[0]?.eventTypes, ["agent.response.produced"]);

console.log("Public API export smoke test passed");
