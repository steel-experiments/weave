import assert from "node:assert/strict";
import { z } from "zod";
import { agent, event } from "../agent-contract.js";
import { createAgentPlanner } from "../agent-runner.js";
import { createApiServer } from "../api-server.js";
import { weave } from "../app-contract.js";
import { capability, isCapabilityRequest } from "../capability-contract.js";
import type { CredentialProvider, CredentialRequest, CredentialResolution, CredentialResolutionContext } from "../credentials.js";
import type {
  AppendOptions,
  AppendResult,
  CreateThreadOptions,
  FollowCursor,
  Lease,
  ReadOptions,
  ThreadEngine,
  ThreadLeaseStore,
} from "../contracts.js";
import { ParallelDurableEffectError, ReplayMismatchError, WeaveError } from "../errors.js";
import {
  deterministicUuid,
  eventKey,
  nowIso,
  stableJsonHash,
  ThreadEventSchema,
  ThreadProjectionSchema,
  type ThreadProjection,
  type ThreadEvent,
} from "../events.js";
import { approvalPolicy, policy } from "../policy-contract.js";
import { ThreadRunner } from "../runner.js";
import { createRuntimeAgentPlanner, createWeaveRuntime } from "../runtime.js";
import { buildThreadSummary } from "../summary.js";
import { ThreadService } from "../thread-service.js";
import { toMermaidTimeline, toTextTimeline } from "../timeline.js";
import { RetryableToolError, tool, type AnyToolContract } from "../tool-contract.js";
import { ContractToolWorker } from "../tool-worker.js";
import { integrationEvent } from "../integration-contract.js";

const inputSchema = z.object({ query: z.string().min(1) });
const outputSchema = z.object({
  summary: z.string().min(1),
  requiresManualApproval: z.literal(false),
  data: z.object({ result: z.string().min(1) }),
});

const testLookupRead = capability({
  name: "test.lookup.read",
  description: "Read lookup data for replay tests.",
  scopes: z.object({ query: z.string().min(1) }),
});

const lookupTool = tool({
  name: "test.lookup",
  description: "Test lookup tool.",
  input: inputSchema,
  output: outputSchema,
  capabilities: [testLookupRead],
  run() {
    return {
      summary: "looked up",
      requiresManualApproval: false,
      data: { result: "ok" },
    };
  },
});

const lookupAgent = agent({
  name: "test-agent",
  input: inputSchema,
  tools: [lookupTool],
  async run(ctx, input) {
    const result = await ctx.tool("lookup", lookupTool, input);
    return result.data.result;
  },
});

const childAgent = agent({
  name: "child-agent",
  input: inputSchema,
  async run(_ctx, input) {
    return `child handled ${input.query}`;
  },
});

const childOutputSchema = z.object({ answer: z.number().int() });

const structuredChildAgent = agent({
  name: "structured-child-agent",
  input: inputSchema,
  output: childOutputSchema,
  async run(_ctx, input) {
    return { answer: input.query.length };
  },
});

async function testDuplicatePrevention(): Promise<void> {
  const planner = createAgentPlanner(lookupAgent);
  const history = initialHistory("duplicate-prevention");

  const firstPlan = await planner.plan("duplicate-prevention", history);
  assert(firstPlan);
  assert.equal(firstPlan.events.length, 1);
  assert.equal(firstPlan.events[0]?.type, "tool.requested");
  assert.equal(firstPlan.events[0]?.scopeKey, "agent:test-agent");
  assert.equal(firstPlan.events[0]?.stepKey, "lookup");

  const secondPlan = await planner.plan("duplicate-prevention", [...history, ...firstPlan.events]);
  assert.equal(secondPlan, null);
}

async function testCapabilityMetadataDoesNotAffectToolPlanning(): Promise<void> {
  const planner = createAgentPlanner(lookupAgent);
  const history = initialHistory("capability-metadata-inert");

  const plan = await planner.plan("capability-metadata-inert", history);

  assert(plan);
  assert(Array.isArray(lookupTool.capabilities));
  assert.equal(lookupTool.capabilities?.[0], testLookupRead);
  assert.equal(plan.events.length, 1);
  assert.equal(plan.events[0]?.type, "tool.requested");
  assert.equal(plan.events[0]?.payload.toolName, "test.lookup");
}

async function testPolicyAllowRecordsAuditAndRequestsTool(): Promise<void> {
  const allowLookup = policy({
    name: "test.allow-lookup-capability",
    evaluate(request) {
      assert.equal(request.type, "tool");
      assert(request.capabilities.some((capability) => capability.name === "test.lookup.read"));
      return { outcome: "allow", reason: "lookup reads are allowed" };
    },
  });
  const planner = createAgentPlanner(lookupAgent, lookupAgent.name, { policies: [allowLookup] });
  const history = initialHistory("policy-allow");

  const plan = await planner.plan("policy-allow", history);

  assert(plan);
  assert.equal(plan.events.length, 2);
  assert.equal(plan.events[0]?.type, "policy.evaluated");
  assert.equal(plan.events[0]?.payload.outcome, "allowed");
  assert.equal(plan.events[0]?.payload.policyName, "test.allow-lookup-capability");
  assert.equal(plan.events[0]?.payload.requestKind, "tool.requested");
  assert.equal(typeof plan.events[0]?.payload.requestHash, "string");
  assert.deepEqual(plan.events[0]?.payload.capabilityNames, ["test.lookup.read"]);
  assert.equal(plan.events[1]?.type, "tool.requested");

  const replay = await planner.plan("policy-allow", [...history, ...plan.events]);
  assert.equal(replay, null);
}

async function testPolicyDenyRecordsAuditAndFailsAgent(): Promise<void> {
  const denyLookup = policy({
    name: "test.deny-lookup",
    evaluate(request) {
      return request.toolName === "test.lookup" ? { outcome: "deny", reason: "lookup denied by policy" } : undefined;
    },
  });
  const planner = createAgentPlanner(lookupAgent, lookupAgent.name, { policies: [denyLookup] });
  const history = initialHistory("policy-deny");

  const plan = await planner.plan("policy-deny", history);

  assert(plan);
  assert.equal(plan.events.length, 2);
  assert.equal(plan.events[0]?.type, "policy.evaluated");
  assert.equal(plan.events[0]?.payload.outcome, "denied");
  assert.equal(plan.events[0]?.payload.reason, "lookup denied by policy");
  assert.equal(plan.events[1]?.type, "agent.failed");
  assert.equal(plan.events[1]?.payload.errorCode, "POLICY_DENIED");
  assert(!plan.events.some((event) => event.type === "tool.requested"));

  const replay = await planner.plan("policy-deny", [...history, ...plan.events]);
  assert.equal(replay, null);
}

async function testPolicyApprovalRequiredCreatesGateThenRequestsTool(): Promise<void> {
  const requireApproval = policy({
    name: "test.require-lookup-approval",
    evaluate(request) {
      return request.toolName === "test.lookup"
        ? {
            outcome: "approval_required",
            reason: "lookup requires approval",
            gate: {
              reason: "risky-remediation",
              proposedAction: "Approve lookup tool execution.",
            },
          }
        : undefined;
    },
  });
  const planner = createAgentPlanner(lookupAgent, lookupAgent.name, { policies: [requireApproval] });
  const history = initialHistory("policy-approval");

  const firstPlan = await planner.plan("policy-approval", history);

  assert(firstPlan);
  assert.equal(firstPlan.events.length, 2);
  assert.equal(firstPlan.events[0]?.type, "policy.evaluated");
  assert.equal(firstPlan.events[0]?.payload.outcome, "approval_required");
  const gateCreated = firstPlan.events[1];
  assert.equal(gateCreated?.type, "gate.created");
  assert.equal(gateCreated.stepKey, "lookup:policy:test.require-lookup-approval:approval");
  assert.equal(gateCreated.payload.relatedToolCallId, firstPlan.events[0]?.payload.toolCallId);

  const pendingPlan = await planner.plan("policy-approval", [...history, ...firstPlan.events]);
  assert.equal(pendingPlan, null);

  assert(gateCreated.type === "gate.created");
  const gateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
    eventId: eventKey("policy-approval", "gate.resolved", "lookup-policy-gate"),
    threadId: "policy-approval",
    type: "gate.resolved",
    occurredAt: nowIso(),
    correlationId: gateCreated.correlationId,
    causationId: gateCreated.eventId,
    scopeKey: gateCreated.scopeKey,
    stepKey: gateCreated.stepKey,
    actor: { type: "human", id: "approver" },
    payload: {
      gateId: gateCreated.payload.gateId,
      resolution: "approved",
    },
  };

  const approvedPlan = await planner.plan("policy-approval", [...history, ...firstPlan.events, gateResolved]);
  assert(approvedPlan);
  assert.equal(approvedPlan.resumeReason, "gate-resolved");
  assert.equal(approvedPlan.events.length, 1);
  assert.equal(approvedPlan.events[0]?.type, "tool.requested");
}

async function testPolicyApprovalDeniedFailsAgent(): Promise<void> {
  const requireApproval = policy({
    name: "test.require-denied-approval",
    evaluate() {
      return {
        outcome: "approval_required",
        gate: {
          reason: "risky-remediation",
          proposedAction: "Approve denied lookup tool execution.",
        },
      };
    },
  });
  const planner = createAgentPlanner(lookupAgent, lookupAgent.name, { policies: [requireApproval] });
  const history = initialHistory("policy-approval-denied");
  const firstPlan = await planner.plan("policy-approval-denied", history);
  assert(firstPlan);
  const gateCreated = firstPlan.events.find((event): event is Extract<ThreadEvent, { type: "gate.created" }> => {
    return event.type === "gate.created";
  });
  assert(gateCreated);
  const gateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
    eventId: eventKey("policy-approval-denied", "gate.resolved", "lookup-policy-gate-denied"),
    threadId: "policy-approval-denied",
    type: "gate.resolved",
    occurredAt: nowIso(),
    correlationId: gateCreated.correlationId,
    causationId: gateCreated.eventId,
    scopeKey: gateCreated.scopeKey,
    stepKey: gateCreated.stepKey,
    actor: { type: "human", id: "approver" },
    payload: {
      gateId: gateCreated.payload.gateId,
      resolution: "denied",
      comment: "not allowed now",
    },
  };

  const deniedPlan = await planner.plan("policy-approval-denied", [...history, ...firstPlan.events, gateResolved]);
  assert(deniedPlan);
  assert.equal(deniedPlan.events.length, 1);
  assert.equal(deniedPlan.events[0]?.type, "agent.failed");
  assert.equal(deniedPlan.events[0]?.payload.errorCode, "POLICY_DENIED");
}

async function testPolicyEvaluationInputMismatch(): Promise<void> {
  const allowLookup = policy({
    name: "test.allow-lookup-mismatch",
    evaluate() {
      return { outcome: "allow" };
    },
  });
  const planner = createAgentPlanner(lookupAgent, lookupAgent.name, { policies: [allowLookup] });
  const history = initialHistory("policy-input-mismatch");
  const plan = await planner.plan("policy-input-mismatch", history);
  assert(plan);
  const changedHistory = initialHistory("policy-input-mismatch");
  const sessionStarted = changedHistory[0];
  assert(sessionStarted?.type === "session.started");
  sessionStarted.payload.metadata = { query: "changed" };

  await assert.rejects(
    async () => {
      await planner.plan("policy-input-mismatch", [...changedHistory, plan.events[0]!]);
    },
    ReplayMismatchError,
  );
}

async function testPolicyCapabilityDeclarationMismatch(): Promise<void> {
  const readCapability = capability({
    name: "github.repo.read",
    description: "Read a GitHub repository.",
    scopes: z.object({ repo: z.string().min(1) }),
  });
  const writeCapability = capability({
    name: "github.repo.write",
    description: "Write a GitHub repository.",
    scopes: z.object({ repo: z.string().min(1) }),
  });
  const readTool = tool({
    name: "test.capabilitySensitive",
    description: "Capability sensitive test tool.",
    input: inputSchema,
    output: outputSchema,
    capabilities: [readCapability],
    run() {
      return { summary: "read", requiresManualApproval: false, data: { result: "read" } };
    },
  });
  const writeTool = tool({
    ...readTool,
    capabilities: [writeCapability],
  });
  const readAgent = agent({
    name: "capability-sensitive-agent",
    input: inputSchema,
    tools: [readTool],
    async run(ctx, input) {
      return ctx.tool("capability-sensitive", readTool, input);
    },
  });
  const writeAgent = agent({
    name: "capability-sensitive-agent",
    input: inputSchema,
    tools: [writeTool],
    async run(ctx, input) {
      return ctx.tool("capability-sensitive", writeTool, input);
    },
  });
  const allow = policy({
    name: "test.capability-sensitive-policy",
    evaluate() {
      return { outcome: "allow" };
    },
  });
  const history = initialHistory("policy-capability-mismatch");
  const firstPlan = await createAgentPlanner(readAgent, readAgent.name, { policies: [allow] }).plan("policy-capability-mismatch", history);
  assert(firstPlan);

  await assert.rejects(
    async () => {
      await createAgentPlanner(writeAgent, writeAgent.name, { policies: [allow] }).plan("policy-capability-mismatch", [
        ...history,
        firstPlan.events[0]!,
      ]);
    },
    ReplayMismatchError,
  );
}

async function testCapabilityRequestValidationPolicyAndCredentialResolution(): Promise<void> {
  const githubRepoWrite = capability({
    name: "github.repo.write",
    description: "Write to a GitHub repository.",
    params: z.object({ owner: z.string().min(1), repo: z.string().min(1) }),
    scope(params) {
      return {
        credentialName: "github-write-token",
        provider: "github",
        resource: `${params.owner}/${params.repo}`,
        permissions: ["pull_requests:write"],
      };
    },
  });

  assert.throws(() => {
    githubRepoWrite.request({ owner: "acme" } as { owner: string; repo: string });
  }, /Invalid params for capability github\.repo\.write/);

  const capabilityTool = tool({
    name: "test.capabilityCredential",
    description: "Capability-mediated credential tool.",
    input: inputSchema,
    output: z.object({ token: z.string().min(1) }),
    capabilities({ input }) {
      return [githubRepoWrite.request({ owner: "acme", repo: input.query })];
    },
    run(ctx) {
      return { token: ctx.credentials.value("github-write-token") };
    },
  });
  const capabilityAgent = agent({
    name: "capability-credential-agent",
    input: inputSchema,
    tools: [capabilityTool],
    async run(ctx, input) {
      return ctx.tool("capability-credential", capabilityTool, input);
    },
  });
  const seenCapabilities: string[] = [];
  const allowCapability = policy({
    name: "test.allow-capability-credential",
    evaluate(request) {
      const requested = request.capabilities.find(isCapabilityRequest);
      assert(requested);
      const params = requested.params as { repo: string };
      seenCapabilities.push(`${requested.name}:${params.repo}`);
      return { outcome: "allow" };
    },
  });

  const plan = await createAgentPlanner(capabilityAgent, capabilityAgent.name, { policies: [allowCapability] }).plan(
    "capability-policy-context",
    initialHistory("capability-policy-context"),
  );
  assert(plan);
  assert.deepEqual(seenCapabilities, ["github.repo.write:hello"]);
  assert.equal(plan.events[0]?.type, "policy.evaluated");
  assert.deepEqual(plan.events[0]?.payload.capabilityNames, ["github.repo.write"]);

  const provider = new CapturingCredentialProvider({ "github-write-token": "secret-token" });
  const completed = await runToolToTerminal(capabilityTool.name, capabilityTool, provider);
  assert.equal(completed.terminal.type, "tool.completed");
  assert.deepEqual(completed.terminal.payload.output, { token: "secret-token" });
  assert.equal(provider.requests[0]?.name, "github-write-token");
  assert.equal(provider.requests[0]?.kind, "scoped-token");
  assert.equal(provider.requests[0]?.provider, "github");
  assert.deepEqual(provider.requests[0]?.scopes, ["pull_requests:write"]);
  assert.deepEqual(provider.requests[0]?.scope, {
    capability: "github.repo.write",
    resource: "acme/hello",
  });

  const missingCredential = await runToolToTerminal(capabilityTool.name, capabilityTool);
  assert.equal(missingCredential.terminal.type, "tool.failed");
  assert.equal(missingCredential.terminal.payload.errorCode, "credential_resolution_failed");
  assert(
    missingCredential.events.some(
      (event) => event.type === "credential.failed" && event.payload.credentialName === "github-write-token",
    ),
  );
}

async function testCapabilityRequestHashMismatch(): Promise<void> {
  const githubRepoWrite = capability({
    name: "github.repo.write",
    description: "Write to a GitHub repository.",
    params: z.object({ owner: z.string().min(1), repo: z.string().min(1) }),
    scope(params) {
      return {
        credentialName: "github-write-token",
        provider: "github",
        resource: `${params.owner}/${params.repo}`,
        permissions: ["pull_requests:write"],
      };
    },
  });
  const firstTool = tool({
    name: "test.capabilityHash",
    description: "Capability hash test tool.",
    input: inputSchema,
    output: outputSchema,
    capabilities({ input }) {
      return [githubRepoWrite.request({ owner: "acme", repo: input.query })];
    },
    run() {
      return { summary: "ok", requiresManualApproval: false, data: { result: "ok" } };
    },
  });
  const changedTool = tool({
    ...firstTool,
    capabilities({ input }) {
      return [githubRepoWrite.request({ owner: "other", repo: input.query })];
    },
  });
  const firstAgent = agent({
    name: "capability-hash-agent",
    input: inputSchema,
    tools: [firstTool],
    async run(ctx, input) {
      return ctx.tool("capability-hash", firstTool, input);
    },
  });
  const changedAgent = agent({
    name: "capability-hash-agent",
    input: inputSchema,
    tools: [changedTool],
    async run(ctx, input) {
      return ctx.tool("capability-hash", changedTool, input);
    },
  });
  const allow = policy({
    name: "test.capability-hash-policy",
    evaluate() {
      return { outcome: "allow" };
    },
  });
  const history = initialHistory("capability-request-hash-mismatch");
  const firstPlan = await createAgentPlanner(firstAgent, firstAgent.name, { policies: [allow] }).plan(
    "capability-request-hash-mismatch",
    history,
  );
  assert(firstPlan);

  await assert.rejects(
    async () => {
      await createAgentPlanner(changedAgent, changedAgent.name, { policies: [allow] }).plan("capability-request-hash-mismatch", [
        ...history,
        firstPlan.events[0]!,
      ]);
    },
    ReplayMismatchError,
  );
}

async function testPolicyOrderingAllowThenDeny(): Promise<void> {
  const calls: string[] = [];
  const allowA = policy({
    name: "test.order-a-allow",
    evaluate() {
      calls.push("a");
      return { outcome: "allow", reason: "a allowed" };
    },
  });
  const denyB = policy({
    name: "test.order-b-deny",
    evaluate() {
      calls.push("b");
      return { outcome: "deny", reason: "b denied" };
    },
  });
  const allowC = policy({
    name: "test.order-c-allow",
    evaluate() {
      calls.push("c");
      return { outcome: "allow" };
    },
  });
  const planner = createAgentPlanner(lookupAgent, lookupAgent.name, { policies: [allowA, denyB, allowC] });
  const plan = await planner.plan("policy-order-deny", initialHistory("policy-order-deny"));

  assert(plan);
  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(plan.events.filter((event) => event.type === "policy.evaluated").length, 2);
  assert.equal(plan.events[0]?.type, "policy.evaluated");
  assert.equal(plan.events[0]?.payload.policyName, "test.order-a-allow");
  assert.equal(plan.events[0]?.payload.outcome, "allowed");
  assert.equal(plan.events[1]?.type, "policy.evaluated");
  assert.equal(plan.events[1]?.payload.policyName, "test.order-b-deny");
  assert.equal(plan.events[1]?.payload.outcome, "denied");
  assert.equal(plan.events[2]?.type, "agent.failed");
  assert(!plan.events.some((event) => event.type === "tool.requested"));
}

async function testPolicyOrderingAllowThenApproval(): Promise<void> {
  const calls: string[] = [];
  const allowA = policy({
    name: "test.order-approval-a-allow",
    evaluate() {
      calls.push("a");
      return { outcome: "allow" };
    },
  });
  const approvalB = policy({
    name: "test.order-approval-b-gate",
    evaluate() {
      calls.push("b");
      return {
        outcome: "approval_required",
        gate: { reason: "risky-remediation", proposedAction: "Approve ordered policy test." },
      };
    },
  });
  const denyC = policy({
    name: "test.order-approval-c-deny",
    evaluate() {
      calls.push("c");
      return { outcome: "deny", reason: "c denied" };
    },
  });
  const planner = createAgentPlanner(lookupAgent, lookupAgent.name, { policies: [allowA, approvalB, denyC] });
  const plan = await planner.plan("policy-order-approval", initialHistory("policy-order-approval"));

  assert(plan);
  assert.deepEqual(calls, ["a", "b"]);
  assert.equal(plan.events.filter((event) => event.type === "policy.evaluated").length, 2);
  assert.equal(plan.events[0]?.type, "policy.evaluated");
  assert.equal(plan.events[0]?.payload.outcome, "allowed");
  assert.equal(plan.events[1]?.type, "policy.evaluated");
  assert.equal(plan.events[1]?.payload.outcome, "approval_required");
  assert.equal(plan.events[2]?.type, "gate.created");
  assert.equal(plan.events[2]?.stepKey, "lookup:policy:test.order-approval-b-gate:approval");
}

async function testPolicyVersionAuditDoesNotBreakReplay(): Promise<void> {
  const versionOne = policy({
    name: "test.versioned-policy",
    version: "1",
    evaluate() {
      return {
        outcome: "approval_required",
        gate: { reason: "risky-remediation", proposedAction: "Approve versioned policy test." },
      };
    },
  });
  const history = initialHistory("policy-version-replay");
  const firstPlan = await createAgentPlanner(lookupAgent, lookupAgent.name, { policies: [versionOne] }).plan("policy-version-replay", history);
  assert(firstPlan);
  assert.equal(firstPlan.events[0]?.type, "policy.evaluated");
  assert.equal(firstPlan.events[0]?.payload.policyVersion, "1");

  const versionTwoThrows = policy({
    name: "test.versioned-policy",
    version: "2",
    evaluate() {
      throw new Error("current policy code should not run for recorded decisions");
    },
  });
  const replay = await createAgentPlanner(lookupAgent, lookupAgent.name, { policies: [versionTwoThrows] }).plan("policy-version-replay", [
    ...history,
    ...firstPlan.events,
  ]);
  assert.equal(replay, null);

  const versionTwo = policy({
    name: "test.versioned-policy",
    version: "2",
    evaluate() {
      return { outcome: "allow" };
    },
  });
  const newPlan = await createAgentPlanner(lookupAgent, lookupAgent.name, { policies: [versionTwo] }).plan(
    "policy-version-new-request",
    initialHistory("policy-version-new-request"),
  );
  assert(newPlan);
  assert.equal(newPlan.events[0]?.type, "policy.evaluated");
  assert.equal(newPlan.events[0]?.payload.policyVersion, "2");
}

async function testPolicyEvaluationThrownErrorRecordsAgentFailure(): Promise<void> {
  const threadId = "policy-evaluation-throws";
  const throwingPolicy = policy({
    name: "test.throwing-policy",
    evaluate() {
      throw new Error("policy evaluation exploded");
    },
  });
  const engine = new MemoryThreadEngine(initialHistory(threadId));
  const runner = new ThreadRunner(
    engine,
    engine,
    createAgentPlanner(lookupAgent, lookupAgent.name, { policies: [throwingPolicy] }),
    "test-runner",
  );

  const result = await runner.runOnce(threadId);

  assert.deepEqual(result, { acted: true, appendedEvents: 1, reason: "agent-failed" });
  const events = await engine.read(threadId);
  const failed = events.find(
    (event): event is Extract<ThreadEvent, { type: "agent.failed" }> => event.type === "agent.failed",
  );
  assert(failed);
  assert.equal(failed.payload.errorCode, "AGENT_FAILED");
  assert.equal(failed.payload.message, "policy evaluation exploded");
  assert.equal(events.some((event) => event.type === "policy.evaluated"), false);
  assert.equal(events.some((event) => event.type === "tool.requested"), false);
}

async function testSleepSchedulesAndPendingReplayDoesNotDuplicate(): Promise<void> {
  const sleeper = agent({
    name: "sleep-pending-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.sleep("cooldown", { until: "2999-01-01T00:00:00.000Z" });
      return "awake";
    },
  });
  const planner = createAgentPlanner(sleeper);
  const history = initialHistory("sleep-pending");

  const firstPlan = await planner.plan("sleep-pending", history);

  assert(firstPlan);
  assert.equal(firstPlan.events.length, 1);
  const scheduled = firstPlan.events[0];
  assert.equal(scheduled?.type, "timer.scheduled");
  assert.equal(scheduled.scopeKey, "agent:sleep-pending-agent");
  assert.equal(scheduled.stepKey, "cooldown");
  assert.equal(scheduled.payload.fireAt, "2999-01-01T00:00:00.000Z");
  assert.deepEqual(scheduled.payload.target, { type: "until", until: "2999-01-01T00:00:00.000Z" });

  const replay = await planner.plan("sleep-pending", [...history, ...firstPlan.events]);
  assert.equal(replay, null);
}

async function testSleepFiredResumesAgent(): Promise<void> {
  const sleeper = agent({
    name: "sleep-fired-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.sleep("cooldown", { until: "2000-01-01T00:00:00.000Z" });
      return "awake";
    },
  });
  const threadId = "sleep-fired";
  const engine = new MemoryThreadEngine(initialHistory(threadId));
  const runner = new ThreadRunner(engine, engine, createAgentPlanner(sleeper), "test-runner");

  const scheduledRun = await runner.runOnce(threadId);
  assert.equal(scheduledRun.acted, true);
  assert.equal(scheduledRun.reason, "new-prompt");
  let events = await engine.read(threadId);
  assert.equal(events.some((event) => event.type === "timer.scheduled"), true);
  assert.equal(events.some((event) => event.type === "timer.fired"), false);

  const firedRun = await runner.runOnce(threadId);
  assert.equal(firedRun.acted, true);
  assert.equal(firedRun.reason, "timer-fired");
  events = await engine.read(threadId);
  assert.equal(events.filter((event) => event.type === "timer.fired").length, 1);
  assert.equal(events.some((event) => event.type === "agent.response.produced"), false);

  const completedRun = await runner.runOnce(threadId);
  assert.equal(completedRun.acted, true);
  assert.equal(completedRun.reason, "timer-fired");
  events = await engine.read(threadId);
  assert.equal(events.filter((event) => event.type === "timer.fired").length, 1);
  assert.equal(events.some((event) => event.type === "agent.response.produced"), true);
}

async function testSleepTargetMismatch(): Promise<void> {
  const firstSleeper = agent({
    name: "sleep-mismatch-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.sleep("cooldown", { seconds: 30 });
      return "awake";
    },
  });
  const changedSleeper = agent({
    name: "sleep-mismatch-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.sleep("cooldown", { seconds: 60 });
      return "awake";
    },
  });
  const history = initialHistory("sleep-mismatch");
  const firstPlan = await createAgentPlanner(firstSleeper).plan("sleep-mismatch", history);
  assert(firstPlan);

  await assert.rejects(
    async () => createAgentPlanner(changedSleeper).plan("sleep-mismatch", [...history, ...firstPlan.events]),
    (error: unknown) => error instanceof ReplayMismatchError && error.message.includes("different target"),
  );
}

async function testCompletedRunFirstAgentIsTerminal(): Promise<void> {
  const threadId = "completed-run-first-agent-is-terminal";
  const terminalAgent = agent({
    name: "terminal-agent",
    input: inputSchema,
    output: z.object({ finalMessage: z.string().min(1) }),
    async run(_ctx, input) {
      return { finalMessage: `done ${input.query}` };
    },
  });
  const engine = new MemoryThreadEngine(initialHistory(threadId));
  const runner = new ThreadRunner(engine, engine, createAgentPlanner(terminalAgent), "test-runner");

  const firstRun = await runner.runOnce(threadId);
  assert.equal(firstRun.acted, true);
  assert.equal(firstRun.reason, "new-prompt");
  const afterFirstRun = await engine.read(threadId);
  assert.equal(afterFirstRun.filter((event) => event.type === "agent.response.produced").length, 1);
  assert.equal(afterFirstRun.filter((event) => event.type === "agent.output.completed").length, 1);

  const secondRun = await runner.runOnce(threadId);
  assert.deepEqual(secondRun, { acted: false, appendedEvents: 0, reason: "no-plan" });
  const afterSecondRun = await engine.read(threadId);
  assert.equal(afterSecondRun.filter((event) => event.type === "agent.response.produced").length, 1);
  assert.equal(afterSecondRun.filter((event) => event.type === "agent.output.completed").length, 1);
}

async function testRunnerReadsFullReplayHistory(): Promise<void> {
  const threadId = "full-replay-history";
  const history = initialHistory(threadId);
  const fillerEvents = Array.from({ length: 1000 }, (_, index): Extract<ThreadEvent, { type: "checkpoint.completed" }> => ({
    eventId: eventKey(threadId, "checkpoint.completed", `filler:${index}`),
    threadId,
    type: "checkpoint.completed",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    actor: { type: "agent", id: "filler" },
    scopeKey: "agent:filler",
    stepKey: `filler:${index}`,
    payload: {
      scopeKey: "agent:filler",
      stepKey: `filler:${index}`,
      value: index,
    },
  }));
  const request = requestedEvent(threadId);
  const completion: Extract<ThreadEvent, { type: "tool.completed" }> = {
    eventId: eventKey(threadId, "tool.completed", "lookup"),
    threadId,
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: request.eventId,
    scopeKey: "agent:test-agent",
    stepKey: "lookup",
    actor: { type: "worker", id: "test-worker" },
    payload: {
      toolCallId: request.payload.toolCallId,
      output: { summary: "looked up", requiresManualApproval: false, data: { result: "ok" } },
    },
  };
  const engine = new MemoryThreadEngine([...history, ...fillerEvents, request, completion]);
  const runner = new ThreadRunner(engine, engine, createAgentPlanner(lookupAgent), "test-runner");

  const result = await runner.runOnce(threadId);

  assert.equal(result.reason, "tool-completed");
  const events = await engine.read(threadId, { limit: 2000 });
  assert.equal(events.filter((event) => event.type === "tool.requested").length, 1);
  assert(events.some((event) => event.type === "agent.response.produced"));
}

async function testDecodeFailure(): Promise<void> {
  const planner = createAgentPlanner(lookupAgent);
  const history = initialHistory("decode-failure");
  const request = requestedEvent("decode-failure");
  const invalidCompletion: Extract<ThreadEvent, { type: "tool.completed" }> = {
    eventId: eventKey("decode-failure", "tool.completed", "lookup"),
    threadId: "decode-failure",
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: request.eventId,
    scopeKey: "agent:test-agent",
    stepKey: "lookup",
    actor: { type: "worker", id: "test-worker" },
    payload: {
      toolCallId: request.payload.toolCallId,
      output: {
        summary: "invalid output",
        requiresManualApproval: false,
        data: { result: 123 },
      },
    },
  };

  await assert.rejects(
    async () => {
      await planner.plan("decode-failure", [...history, request, invalidCompletion]);
    },
    ReplayMismatchError,
  );
}

async function testToolFailedReplayNoPlan(): Promise<void> {
  const planner = createAgentPlanner(lookupAgent);
  const history = initialHistory("tool-failed-replay");
  const request = requestedEvent("tool-failed-replay");
  const failed: Extract<ThreadEvent, { type: "tool.failed" }> = {
    eventId: eventKey("tool-failed-replay", "tool.failed", "lookup"),
    threadId: "tool-failed-replay",
    type: "tool.failed",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: request.eventId,
    scopeKey: "agent:test-agent",
    stepKey: "lookup",
    actor: { type: "worker", id: "test-worker" },
    payload: {
      toolCallId: request.payload.toolCallId,
      errorCode: "execution_failed",
      message: "lookup failed",
    },
  };

  const plan = await planner.plan("tool-failed-replay", [...history, request, failed]);
  assert.equal(plan, null);
}

async function testParallelDurableEffectRejected(): Promise<void> {
  const parallelAgent = agent({
    name: "parallel-agent",
    input: inputSchema,
    tools: [lookupTool],
    async run(ctx, input) {
      await Promise.all([
        ctx.tool("first-lookup", lookupTool, input),
        ctx.tool("second-lookup", lookupTool, input),
      ]);
    },
  });
  const planner = createAgentPlanner(parallelAgent);

  await assert.rejects(
    async () => {
      await planner.plan("parallel-durable-effect", initialHistory("parallel-durable-effect"));
    },
    ParallelDurableEffectError,
  );
}

async function testMixedParallelDurableEffectRejected(): Promise<void> {
  const parallelAgent = agent({
    name: "parallel-mixed-agent",
    input: inputSchema,
    tools: [lookupTool],
    async run(ctx, input) {
      await Promise.all([
        ctx.tool("lookup", lookupTool, input),
        ctx.gate("approve", {
          reason: "risky-remediation",
          proposedAction: "Approve a mixed parallel durable effect test.",
        }),
      ]);
    },
  });
  const planner = createAgentPlanner(parallelAgent);

  await assert.rejects(
    async () => {
      await planner.plan("mixed-parallel-durable-effect", initialHistory("mixed-parallel-durable-effect"));
    },
    ParallelDurableEffectError,
  );
}

async function testReplayMismatch(): Promise<void> {
  const planner = createAgentPlanner(lookupAgent);
  const history = initialHistory("replay-mismatch");
  const mismatchedGate: Extract<ThreadEvent, { type: "gate.created" }> = {
    eventId: eventKey("replay-mismatch", "gate.created", "lookup"),
    threadId: "replay-mismatch",
    type: "gate.created",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: history.at(-1)?.eventId,
    scopeKey: "agent:test-agent",
    stepKey: "lookup",
    actor: { type: "agent", id: "test-agent" },
    payload: {
      gateId: deterministicUuid("gate", "replay-mismatch", "lookup"),
      gateType: "manual-approval",
      reason: "risky-remediation",
    },
  };

  await assert.rejects(
    async () => {
      await planner.plan("replay-mismatch", [...history, mismatchedGate]);
    },
    ReplayMismatchError,
  );
}

async function testEmitPayloadMismatch(): Promise<void> {
  const emitAgent = agent({
    name: "emit-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.emit(
        "final",
        event("agent.finding.produced", {
          findingId: ctx.uuid("final"),
          severity: "warning",
          summary: "new message",
          evidence: [{ source: "test", summary: "evidence" }],
        }),
      );
    },
  });
  const planner = createAgentPlanner(emitAgent);
  const history = initialHistory("emit-payload-mismatch");
  const existingFinding: Extract<ThreadEvent, { type: "agent.finding.produced" }> = {
    eventId: eventKey("emit-payload-mismatch", "agent.finding.produced", "agent:emit-agent:final"),
    threadId: "emit-payload-mismatch",
    type: "agent.finding.produced",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: history.at(-1)?.eventId,
    scopeKey: "agent:emit-agent",
    stepKey: "final",
    actor: { type: "agent", id: "emit-agent" },
    payload: {
      findingId: deterministicUuid("agent-context", "emit-payload-mismatch", "agent:emit-agent", "final"),
      severity: "warning",
      summary: "old message",
      evidence: [{ source: "test", summary: "evidence" }],
    },
  };

  await assert.rejects(
    async () => {
      await planner.plan("emit-payload-mismatch", [...history, existingFinding]);
    },
    ReplayMismatchError,
  );
}

async function testTypedEventFactoryAppendAndReplay(): Promise<void> {
  const findingProduced = event({
    type: "agent.finding.produced",
    payload: z.object({
      findingId: z.string().uuid(),
      severity: z.enum(["info", "warning", "critical"]),
      summary: z.string().min(1),
      evidence: z.array(z.object({ source: z.string().min(1), summary: z.string().min(1) })),
    }),
    description: "Typed finding event for replay tests.",
  });
  const emitAgent = agent({
    name: "typed-event-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.emit("finding", findingProduced({
        findingId: ctx.id("finding"),
        severity: "info",
        summary: "Done",
        evidence: [{ source: "test", summary: "evidence" }],
      }));
      return "Done";
    },
  });
  const planner = createAgentPlanner(emitAgent);
  const history = initialHistory("typed-event-append-replay");

  const firstPlan = await planner.plan("typed-event-append-replay", history);
  assert(firstPlan);
  assert.equal(findingProduced.type, "agent.finding.produced");
  assert.equal(findingProduced.description, "Typed finding event for replay tests.");
  assert.equal(firstPlan.events.filter((planned) => planned.type === "agent.finding.produced").length, 1);
  assert.deepEqual(firstPlan.events[0]?.payload, {
    findingId: deterministicUuid("agent-context", "typed-event-append-replay", "agent:typed-event-agent", "finding"),
    severity: "info",
    summary: "Done",
    evidence: [{ source: "test", summary: "evidence" }],
  });

  const replayPlan = await planner.plan("typed-event-append-replay", [...history, firstPlan.events[0] as ThreadEvent]);
  assert(replayPlan);
  assert.equal(replayPlan.events.some((planned) => planned.type === "agent.finding.produced"), false);
  assert.equal(replayPlan.events[0]?.type, "agent.response.produced");
  assert.equal(replayPlan.events[1]?.type, "agent.output.completed");
}

async function testTypedEventFactoryTypeMismatch(): Promise<void> {
  const responseProduced = event({
    type: "agent.response.produced",
    payload: z.object({ message: z.string().min(1) }),
  });
  const emitAgent = agent({
    name: "typed-event-type-mismatch-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.emit("final", responseProduced({ message: "Done" }));
    },
  });
  const planner = createAgentPlanner(emitAgent);
  const history = initialHistory("typed-event-type-mismatch");
  const existingFinding: Extract<ThreadEvent, { type: "agent.finding.produced" }> = {
    eventId: eventKey("typed-event-type-mismatch", "agent.finding.produced", "agent:typed-event-type-mismatch-agent:final"),
    threadId: "typed-event-type-mismatch",
    type: "agent.finding.produced",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: history.at(-1)?.eventId,
    scopeKey: "agent:typed-event-type-mismatch-agent",
    stepKey: "final",
    actor: { type: "agent", id: "typed-event-type-mismatch-agent" },
    payload: {
      findingId: deterministicUuid("agent-context", "typed-event-type-mismatch", "agent:typed-event-type-mismatch-agent", "final"),
      severity: "info",
      summary: "existing finding",
      evidence: [{ source: "test", summary: "evidence" }],
    },
  };

  await assert.rejects(
    async () => {
      await planner.plan("typed-event-type-mismatch", [...history, existingFinding]);
    },
    ReplayMismatchError,
  );
}

async function testTypedEventFactoryPayloadMismatch(): Promise<void> {
  const findingProduced = event({
    type: "agent.finding.produced",
    payload: z.object({
      findingId: z.string().uuid(),
      severity: z.enum(["info", "warning", "critical"]),
      summary: z.string().min(1),
      evidence: z.array(z.object({ source: z.string().min(1), summary: z.string().min(1) })),
    }),
  });
  const emitAgent = agent({
    name: "typed-event-payload-mismatch-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.emit("finding", findingProduced({
        findingId: ctx.id("finding"),
        severity: "warning",
        summary: "Changed",
        evidence: [{ source: "test", summary: "evidence" }],
      }));
    },
  });
  const planner = createAgentPlanner(emitAgent);
  const history = initialHistory("typed-event-payload-mismatch");
  const existingFinding: Extract<ThreadEvent, { type: "agent.finding.produced" }> = {
    eventId: eventKey("typed-event-payload-mismatch", "agent.finding.produced", "agent:typed-event-payload-mismatch-agent:finding"),
    threadId: "typed-event-payload-mismatch",
    type: "agent.finding.produced",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: history.at(-1)?.eventId,
    scopeKey: "agent:typed-event-payload-mismatch-agent",
    stepKey: "finding",
    actor: { type: "agent", id: "typed-event-payload-mismatch-agent" },
    payload: {
      findingId: deterministicUuid("agent-context", "typed-event-payload-mismatch", "agent:typed-event-payload-mismatch-agent", "finding"),
      severity: "warning",
      summary: "Original",
      evidence: [{ source: "test", summary: "evidence" }],
    },
  };

  await assert.rejects(
    async () => {
      await planner.plan("typed-event-payload-mismatch", [...history, existingFinding]);
    },
    ReplayMismatchError,
  );
}

async function testTypedEventFactorySchemaValidation(): Promise<void> {
  const responseProduced = event({
    type: "agent.response.produced",
    payload: z.object({ message: z.string().min(1) }),
  });

  assert.throws(
    () => responseProduced({ message: 123 } as unknown as { message: string }),
    (error: unknown) => error instanceof WeaveError && error.code === "EVENT_PAYLOAD_INVALID",
  );
}

async function testContextIdStabilityAndUuidAlias(): Promise<void> {
  const idAgent = agent({
    name: "id-agent",
    input: inputSchema,
    async run(ctx) {
      return {
        sameKey: [ctx.id("finding:0"), ctx.id("finding:0")],
        differentKey: ctx.id("finding:1"),
        uuidAlias: ctx.uuid("finding:0"),
      };
    },
  });
  const planner = createAgentPlanner(idAgent);
  const firstThreadHistory = initialHistory("ctx-id-stability-a");
  const secondThreadHistory = initialHistory("ctx-id-stability-b");

  const firstPlan = await planner.plan("ctx-id-stability-a", firstThreadHistory);
  const firstReplayPlan = await planner.plan("ctx-id-stability-a", firstThreadHistory);
  const secondPlan = await planner.plan("ctx-id-stability-b", secondThreadHistory);
  assert(firstPlan);
  assert(firstReplayPlan);
  assert(secondPlan);

  const firstOutput = typedOutput(firstPlan.events);
  const firstReplayOutput = typedOutput(firstReplayPlan.events);
  const secondOutput = typedOutput(secondPlan.events);
  assert.equal(firstOutput.sameKey[0], firstOutput.sameKey[1]);
  assert.equal(firstOutput.uuidAlias, firstOutput.sameKey[0]);
  assert.notEqual(firstOutput.differentKey, firstOutput.sameKey[0]);
  assert.deepEqual(firstReplayOutput, firstOutput);
  assert.notEqual(secondOutput.sameKey[0], firstOutput.sameKey[0]);
}

async function testRawEmitCompatibility(): Promise<void> {
  const rawAgent = agent({
    name: "raw-emit-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.emit("final", {
        type: "agent.response.produced",
        payload: { message: "raw still works" },
      });
    },
  });
  const planner = createAgentPlanner(rawAgent);
  const plan = await planner.plan("raw-emit-compatibility", initialHistory("raw-emit-compatibility"));
  assert(plan);
  assert.deepEqual(plan.events[0]?.payload, { message: "raw still works" });
}

async function testTypedIntegrationEventHandlers(): Promise<void> {
  const messages: string[] = [];
  const responseHandler = integrationEvent({
    type: "agent.response.produced",
    handle(event) {
      messages.push(event.payload.message);
    },
  });
  assert.deepEqual(responseHandler.eventTypes, ["agent.response.produced"]);

  const responseEvent: Extract<ThreadEvent, { type: "agent.response.produced" }> = {
    eventId: eventKey("integration-handler", "agent.response.produced", "response"),
    threadId: "integration-handler",
    type: "agent.response.produced",
    occurredAt: nowIso(),
    actor: { type: "agent", id: "test" },
    payload: { message: "hello" },
  };
  await responseHandler.handle(responseEvent, integrationRuntimeContext("integration-handler"));
  assert.deepEqual(messages, ["hello"]);

  const outputs: unknown[] = [];
  const toolCompletedHandler = integrationEvent({
    type: "tool.completed",
    handle(event) {
      outputs.push(event.payload.output);
    },
  });
  await toolCompletedHandler.handle(
    {
      eventId: eventKey("integration-handler", "tool.completed", "legacy-tool"),
      threadId: "integration-handler",
      type: "tool.completed",
      occurredAt: nowIso(),
      actor: { type: "worker", id: "test" },
      payload: {
        toolCallId: deterministicUuid("tool-call", "integration-handler", "legacy-tool"),
        summary: "legacy",
        requiresManualApproval: false,
        data: { result: "ok" },
      },
    } as unknown as ThreadEvent,
    integrationRuntimeContext("integration-handler"),
  );
  assert.deepEqual(outputs, [{ summary: "legacy", requiresManualApproval: false, data: { result: "ok" } }]);

  assert.throws(() => {
    responseHandler.handle(
      {
        ...responseEvent,
        payload: { message: "" },
      } as ThreadEvent,
      integrationRuntimeContext("integration-handler"),
    );
  });

  assert.throws(() => {
    responseHandler.handle(
      {
        ...responseEvent,
        type: "agent.failed",
        payload: { errorCode: "FAILED", message: "failed" },
      } as ThreadEvent,
      integrationRuntimeContext("integration-handler"),
    );
  }, /Integration handler expected agent\.response\.produced, received agent\.failed/);
}

function typedOutput(events: readonly ThreadEvent[]): {
  sameKey: [string, string];
  differentKey: string;
  uuidAlias: string;
} {
  const output = events.find((planned) => planned.type === "agent.output.completed");
  assert(output?.type === "agent.output.completed");
  return output.payload.output as {
    sameKey: [string, string];
    differentKey: string;
    uuidAlias: string;
  };
}

async function testEmitReplayDoesNotDuplicateEvent(): Promise<void> {
  const threadId = "emit-replay-no-duplicate";
  const emitAgent = agent({
    name: "emit-replay-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.emit(
        "finding",
        event("agent.finding.produced", {
          findingId: ctx.uuid("finding"),
          severity: "info",
          summary: "replayed finding",
          evidence: [{ source: "test", summary: "evidence" }],
        }),
      );
      return "done";
    },
  });
  const planner = createAgentPlanner(emitAgent);
  const history = initialHistory(threadId);

  const firstPlan = await planner.plan(threadId, history);
  assert(firstPlan);
  assert.equal(firstPlan.events.filter((event) => event.type === "agent.finding.produced").length, 1);
  const emittedFinding = firstPlan.events.find(
    (planned): planned is Extract<ThreadEvent, { type: "agent.finding.produced" }> => planned.type === "agent.finding.produced",
  );
  assert(emittedFinding);

  const replayPlan = await planner.plan(threadId, [...history, emittedFinding]);
  assert(replayPlan);
  assert.equal(replayPlan.events.some((planned) => planned.type === "agent.finding.produced"), false);
  assert.equal(replayPlan.events[0]?.type, "agent.response.produced");
  assert.equal(replayPlan.events[1]?.type, "agent.output.completed");

  const terminalPlan = await planner.plan(threadId, [...history, ...firstPlan.events]);
  assert.equal(terminalPlan, null);
}

async function testCheckpointReplay(): Promise<void> {
  let computeCalls = 0;
  const checkpointAgent = agent({
    name: "checkpoint-agent",
    input: inputSchema,
    async run(ctx) {
      const value = await ctx.checkpoint("normalize", () => {
        computeCalls += 1;
        return { normalized: "hello" };
      });
      await ctx.emit("final", event("agent.response.produced", { message: value.normalized }));
    },
  });
  const planner = createAgentPlanner(checkpointAgent);
  const history = initialHistory("checkpoint-replay");

  const firstPlan = await planner.plan("checkpoint-replay", history);
  assert(firstPlan);
  assert.equal(computeCalls, 1);
  assert.equal(firstPlan.events[0]?.type, "checkpoint.completed");
  assert.deepEqual(firstPlan.events[0]?.payload, {
    scopeKey: "agent:checkpoint-agent",
    stepKey: "normalize",
    value: { normalized: "hello" },
  });

  const secondPlan = await planner.plan("checkpoint-replay", [...history, firstPlan.events[0]]);
  assert(secondPlan);
  assert.equal(computeCalls, 1);
  assert.equal(secondPlan.events.length, 1);
  assert.equal(secondPlan.events[0]?.type, "agent.response.produced");
}

async function testCheckpointMismatch(): Promise<void> {
  const checkpointAgent = agent({
    name: "checkpoint-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.checkpoint("lookup", () => "value");
    },
  });
  const planner = createAgentPlanner(checkpointAgent);
  const history = initialHistory("checkpoint-mismatch");
  const request: Extract<ThreadEvent, { type: "tool.requested" }> = {
    ...requestedEvent("checkpoint-mismatch"),
    scopeKey: "agent:checkpoint-agent",
    payload: {
      ...requestedEvent("checkpoint-mismatch").payload,
      scopeKey: "agent:checkpoint-agent",
    },
  };

  await assert.rejects(
    async () => {
      await planner.plan("checkpoint-mismatch", [...history, request]);
    },
    ReplayMismatchError,
  );
}

async function testDomainToolOutputReplay(): Promise<void> {
  const domainOutput = z.object({ result: z.string().min(1), count: z.number().int() });
  const domainTool = tool({
    name: "test.domainLookup",
    description: "Test domain output tool.",
    input: inputSchema,
    output: domainOutput,
    summarize(output) {
      return `domain ${output.result}`;
    },
    run() {
      return { result: "ok", count: 1 };
    },
  });
  const domainAgent = agent({
    name: "domain-agent",
    input: inputSchema,
    tools: [domainTool],
    async run(ctx, input) {
      const result = await ctx.tool("domain-lookup", domainTool, input);
      return `${result.result}:${result.count}`;
    },
  });
  const planner = createAgentPlanner(domainAgent);
  const history = initialHistory("domain-output-replay");
  const firstPlan = await planner.plan("domain-output-replay", history);
  assert(firstPlan);
  const request = firstPlan.events[0];
  assert.equal(request?.type, "tool.requested");
  const completion: Extract<ThreadEvent, { type: "tool.completed" }> = {
    eventId: eventKey("domain-output-replay", "tool.completed", "domain-lookup"),
    threadId: "domain-output-replay",
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: request.eventId,
    scopeKey: "agent:domain-agent",
    stepKey: "domain-lookup",
    actor: { type: "worker", id: "test-worker" },
    payload: {
      toolCallId: request.payload.toolCallId,
      output: { result: "ok", count: 1 },
      summary: "domain ok",
    },
  };

  const secondPlan = await planner.plan("domain-output-replay", [...history, request, completion]);
  assert(secondPlan);
  assert.equal(secondPlan.events[0]?.type, "agent.response.produced");
  assert.deepEqual(secondPlan.events[0]?.payload, { message: "ok:1" });
  assert.equal(secondPlan.events[1]?.type, "agent.output.completed");
  assert.deepEqual(secondPlan.events[1]?.payload, {
    output: "ok:1",
    summary: "ok:1",
  });
}

async function testLegacyTopLevelToolCompletionCompatibility(): Promise<void> {
  const threadId = "legacy-top-level-tool-completion";
  const history = initialHistory(threadId);
  const request = requestedEvent(threadId);
  const parsed = ThreadEventSchema.parse({
    eventId: eventKey(threadId, "tool.completed", "legacy-top-level"),
    threadId,
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: request.eventId,
    actor: { type: "worker", id: "legacy-worker" },
    payload: {
      toolCallId: request.payload.toolCallId,
      summary: "Old tool completed",
      requiresManualApproval: false,
      data: { result: "Legacy output" },
    },
  });

  assert.equal(parsed.type, "tool.completed");
  assert.deepEqual(parsed.payload, {
    toolCallId: request.payload.toolCallId,
    output: {
      summary: "Old tool completed",
      requiresManualApproval: false,
      data: { result: "Legacy output" },
    },
    summary: "Old tool completed",
  });
}

async function testLegacyToolCompletionPlannerGateCompatibility(): Promise<void> {
  const threadId = "legacy-tool-completion-planner-gate";
  const history = initialHistory(threadId);
  const request = requestedEvent(threadId);
  const legacyCompletion = ThreadEventSchema.parse({
    eventId: eventKey(threadId, "tool.completed", "legacy-gated-completion"),
    threadId,
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: request.eventId,
    actor: { type: "worker", id: "legacy-worker" },
    payload: {
      toolCallId: request.payload.toolCallId,
      summary: "Legacy gated output",
      requiresManualApproval: true,
      data: { result: "requires approval" },
    },
  });
  const engine = new MemoryThreadEngine([...history, request, legacyCompletion]);
  const runner = new ThreadRunner(engine, engine, undefined, "legacy-runner");

  const result = await runner.runOnce(threadId);
  assert.equal(result.reason, "tool-completed");
  const events = await engine.read(threadId);
  const gateCreated = events.find((event): event is Extract<ThreadEvent, { type: "gate.created" }> => {
    return event.type === "gate.created";
  });
  assert(gateCreated);
  assert.equal(gateCreated.payload.relatedToolCallId, request.payload.toolCallId);
}

async function testLegacyEventsWithoutDurableIdentityRemainReadable(): Promise<void> {
  const threadId = "legacy-events-without-durable-identity";
  const history = initialHistory(threadId);
  const legacyRequest: Extract<ThreadEvent, { type: "tool.requested" }> = {
    eventId: eventKey(threadId, "tool.requested", "legacy-unscoped-request"),
    threadId,
    type: "tool.requested",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: history.at(-1)?.eventId,
    actor: { type: "agent", id: "legacy-agent" },
    payload: {
      toolCallId: deterministicUuid("tool-call", threadId, "legacy-unscoped-request"),
      toolName: "test.lookup",
      args: { query: "hello" },
    },
  };
  const legacyCompletion = ThreadEventSchema.parse({
    eventId: eventKey(threadId, "tool.completed", "legacy-unscoped-completion"),
    threadId,
    type: "tool.completed",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: legacyRequest.eventId,
    actor: { type: "worker", id: "legacy-worker" },
    payload: {
      toolCallId: legacyRequest.payload.toolCallId,
      summary: "Legacy unscoped output",
      requiresManualApproval: false,
      data: { result: "legacy" },
    },
  });
  const finalResponse: Extract<ThreadEvent, { type: "agent.response.produced" }> = {
    eventId: eventKey(threadId, "agent.response.produced", "legacy-final-response"),
    threadId,
    type: "agent.response.produced",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: legacyCompletion.eventId,
    actor: { type: "agent", id: "legacy-agent" },
    payload: { message: "Legacy final response" },
  };
  const events = [...history, legacyRequest, legacyCompletion, finalResponse];
  const engine = new MemoryThreadEngine(events);
  const projection = await engine.getProjection(threadId);
  assert(projection);

  const summary = buildThreadSummary(projection, await engine.read(threadId));
  assert.equal(summary.finalMessage, "Legacy final response");
  assert.match(toTextTimeline(events), /tool.completed/);
  assert.match(toMermaidTimeline(events), /agent.response.produced/);

  const planner = createAgentPlanner(lookupAgent);
  const plan = await planner.plan(threadId, await engine.read(threadId));
  assert.equal(plan, null);
}

async function testInvalidAgentOutputRecordsFailure(): Promise<void> {
  const threadId = "invalid-agent-output";
  const invalidOutputAgent = agent({
    name: "invalid-output-agent",
    input: inputSchema,
    output: z.object({ answer: z.number().int() }),
    async run() {
      return { answer: "not a number" } as unknown as { answer: number };
    },
  });
  const engine = new MemoryThreadEngine(initialHistory(threadId));
  const runner = new ThreadRunner(engine, engine, createAgentPlanner(invalidOutputAgent), "test-runner");

  const result = await runner.runOnce(threadId);
  assert.deepEqual(result, { acted: true, appendedEvents: 1, reason: "agent-failed" });
  const failed = (await engine.read(threadId)).find(
    (event): event is Extract<ThreadEvent, { type: "agent.failed" }> => event.type === "agent.failed",
  );
  assert(failed);
  assert.equal(failed.payload.errorCode, "AGENT_OUTPUT_INVALID");
  assert.equal((await engine.read(threadId)).some((event) => event.type === "agent.output.completed"), false);
}

async function testInvalidAgentInputRecordsFailure(): Promise<void> {
  const threadId = "invalid-agent-input";
  const inputValidatingAgent = agent({
    name: "input-validating-agent",
    input: inputSchema,
    async run(_ctx, input) {
      return { finalMessage: input.query };
    },
  });
  const history = initialHistory(threadId).map((event) => {
    if (event.type !== "session.started") {
      return event;
    }

    return {
      ...event,
      payload: {
        source: "test" as const,
        metadata: { query: "" },
      },
    } satisfies ThreadEvent;
  });
  const engine = new MemoryThreadEngine(history);
  const runner = new ThreadRunner(engine, engine, createAgentPlanner(inputValidatingAgent), "test-runner");

  const result = await runner.runOnce(threadId);
  assert.deepEqual(result, { acted: true, appendedEvents: 1, reason: "agent-failed" });
  const events = await engine.read(threadId);
  const failed = events.find(
    (event): event is Extract<ThreadEvent, { type: "agent.failed" }> => event.type === "agent.failed",
  );
  assert(failed);
  assert.equal(failed.payload.errorCode, "AGENT_INPUT_INVALID");
  assert.equal(events.some((event) => event.type === "agent.response.produced"), false);
  assert.equal(events.some((event) => event.type === "agent.output.completed"), false);
}

async function testToolWorkerOutputSummaries(): Promise<void> {
  const domainTool = tool({
    name: "test.workerDomain",
    description: "Worker domain output tool.",
    input: inputSchema,
    output: z.object({ total: z.number().int() }),
    summarize(output) {
      return `total ${output.total}`;
    },
    run() {
      return { total: 2 };
    },
  });
  const domainCompletion = await runToolToCompletion(domainTool.name, domainTool);
  assert.deepEqual(domainCompletion.payload.output, { total: 2 });
  assert.equal(domainCompletion.payload.summary, "total 2");

  const unsummarizedTool = tool({
    name: "test.workerUnsummarized",
    description: "Worker unsummarized output tool.",
    input: inputSchema,
    output: z.object({ value: z.string().min(1) }),
    run() {
      return { value: "raw" };
    },
  });
  const unsummarizedCompletion = await runToolToCompletion(unsummarizedTool.name, unsummarizedTool);
  assert.deepEqual(unsummarizedCompletion.payload.output, { value: "raw" });
  assert.equal(unsummarizedCompletion.payload.summary, undefined);

  const legacyTool = tool({
    name: "test.workerLegacy",
    description: "Worker legacy output tool.",
    input: inputSchema,
    output: outputSchema,
    run() {
      return {
        summary: "legacy summary",
        requiresManualApproval: false,
        data: { result: "legacy" },
      };
    },
  });
  const legacyCompletion = await runToolToCompletion(legacyTool.name, legacyTool);
  assert.deepEqual(legacyCompletion.payload.output, {
    summary: "legacy summary",
    requiresManualApproval: false,
    data: { result: "legacy" },
  });
  assert.equal(legacyCompletion.payload.summary, "legacy summary");
}

async function testToolWorkerEffectPathFailureParity(): Promise<void> {
  const invalidOutputTool = tool({
    name: "test.workerInvalidOutput",
    description: "Worker invalid output tool.",
    input: inputSchema,
    output: z.object({ value: z.string().min(1) }),
    run() {
      return { value: 123 } as unknown as { value: string };
    },
  });
  const invalidOutput = await runToolToTerminal(invalidOutputTool.name, invalidOutputTool);
  assert.equal(invalidOutput.terminal.type, "tool.failed");
  assert.equal(invalidOutput.terminal.payload.errorCode, "output_validation_failed");

  const credentialedTool = tool({
    name: "test.workerMissingCredential",
    description: "Worker missing credential tool.",
    input: inputSchema,
    output: z.object({ value: z.string().min(1) }),
    credentials() {
      return { name: "github", kind: "secret" };
    },
    run(ctx) {
      return { value: ctx.credentials.value("github") };
    },
  });
  const missingCredential = await runToolToTerminal(credentialedTool.name, credentialedTool);
  assert.equal(missingCredential.terminal.type, "tool.failed");
  assert.equal(missingCredential.terminal.payload.errorCode, "credential_resolution_failed");
  assert(missingCredential.events.some((event) => event.type === "credential.requested"));
  assert(missingCredential.events.some((event) => event.type === "credential.failed" && event.payload.errorCode === "credential_not_found"));

  const providerError = await runToolToTerminal(
    "test.workerProviderError",
    {
      ...credentialedTool,
      name: "test.workerProviderError",
    },
    new ThrowingCredentialProvider("provider exploded"),
  );
  assert.equal(providerError.terminal.type, "tool.failed");
  assert.equal(providerError.terminal.payload.errorCode, "credential_resolution_failed");
  assert(providerError.events.some((event) => event.type === "credential.failed" && event.payload.errorCode === "credential_provider_error"));

  let attempts = 0;
  const retryableTool = tool({
    name: "test.workerRetryable",
    description: "Worker retryable tool.",
    input: inputSchema,
    output: z.object({ ok: z.literal(true) }),
    run() {
      attempts += 1;
      if (attempts < 2) {
        throw new RetryableToolError("temporary failure");
      }
      return { ok: true };
    },
  });
  const retryable = await runToolToTerminal(retryableTool.name, retryableTool);
  assert.equal(retryable.terminal.type, "tool.completed");
  assert.equal(attempts, 2);
  assert(retryable.events.some((event) => event.type === "tool.progress" && event.payload.message.includes("Retrying")));

  const throwingTool = tool({
    name: "test.workerThrows",
    description: "Worker throwing tool.",
    input: inputSchema,
    output: z.object({ ok: z.literal(true) }),
    run() {
      throw new Error("terminal failure");
    },
  });
  const throwing = await runToolToTerminal(throwingTool.name, throwingTool);
  assert.equal(throwing.terminal.type, "tool.failed");
  assert.equal(throwing.terminal.payload.errorCode, "execution_failed");
  assert.equal(throwing.terminal.payload.message, "terminal failure");
}

async function testGateReplay(): Promise<void> {
  const gateAgent = agent({
    name: "gate-agent",
    input: inputSchema,
    async run(ctx) {
      const resolution = await ctx.gate("approve-remediation", {
        reason: "risky-remediation",
        proposedAction: "Approve rebuilding nats-prod-1 in production.",
      });
      return resolution.resolution;
    },
  });
  const planner = createAgentPlanner(gateAgent);
  const history = initialHistory("gate-replay");

  const firstPlan = await planner.plan("gate-replay", history);
  assert(firstPlan);
  assert.equal(firstPlan.events.length, 1);
  const gateCreated = firstPlan.events[0];
  assert.equal(gateCreated?.type, "gate.created");
  assert.equal(gateCreated.scopeKey, "agent:gate-agent");
  assert.equal(gateCreated.stepKey, "approve-remediation");
  assert.deepEqual(gateCreated.payload, {
    gateId: deterministicUuid("gate", "gate-replay", "agent:gate-agent", "approve-remediation"),
    gateType: "manual-approval",
    reason: "risky-remediation",
    relatedToolCallId: undefined,
    proposedAction: "Approve rebuilding nats-prod-1 in production.",
  });

  const pendingPlan = await planner.plan("gate-replay", [...history, gateCreated]);
  assert.equal(pendingPlan, null);

  const gateResolved: Extract<ThreadEvent, { type: "gate.resolved" }> = {
    eventId: eventKey("gate-replay", "gate.resolved", "approve-remediation"),
    threadId: "gate-replay",
    type: "gate.resolved",
    occurredAt: nowIso(),
    correlationId: gateCreated.correlationId,
    causationId: gateCreated.eventId,
    scopeKey: gateCreated.scopeKey,
    stepKey: gateCreated.stepKey,
    actor: { type: "human", id: "approver" },
    payload: {
      gateId: gateCreated.payload.gateId,
      resolution: "approved",
      comment: "ship it",
    },
  };

  const resolvedPlan = await planner.plan("gate-replay", [...history, gateCreated, gateResolved]);
  assert(resolvedPlan);
  assert.equal(resolvedPlan.resumeReason, "gate-resolved");
  assert.equal(resolvedPlan.events[0]?.type, "agent.response.produced");
  assert.deepEqual(resolvedPlan.events[0]?.payload, { message: "approved" });
}

async function testGatePayloadMismatch(): Promise<void> {
  const gateAgent = agent({
    name: "gate-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.gate("approve-remediation", {
        reason: "risky-remediation",
        proposedAction: "New approval text.",
      });
    },
  });
  const planner = createAgentPlanner(gateAgent);
  const history = initialHistory("gate-mismatch");
  const existingGate: Extract<ThreadEvent, { type: "gate.created" }> = {
    eventId: eventKey("gate-mismatch", "gate.created", "agent:gate-agent:approve-remediation"),
    threadId: "gate-mismatch",
    type: "gate.created",
    occurredAt: nowIso(),
    correlationId: history[0]?.correlationId,
    causationId: history.at(-1)?.eventId,
    scopeKey: "agent:gate-agent",
    stepKey: "approve-remediation",
    actor: { type: "agent", id: "gate-agent" },
    payload: {
      gateId: deterministicUuid("gate", "gate-mismatch", "agent:gate-agent", "approve-remediation"),
      gateType: "manual-approval",
      reason: "risky-remediation",
      proposedAction: "Old approval text.",
    },
  };

  await assert.rejects(
    async () => {
      await planner.plan("gate-mismatch", [...history, existingGate]);
    },
    ReplayMismatchError,
  );
}

async function testApprovalPolicyEvaluation(): Promise<void> {
  const policy = approvalPolicy({
    name: "production-change",
    requiresApproval(input: { environment: "staging" | "production" }) {
      return input.environment === "production";
    },
    gate() {
      return {
        reason: "risky-remediation",
        proposedAction: "Approve production change.",
      };
    },
  });

  assert.equal(policy.evaluate({ environment: "staging" }), undefined);
  assert.deepEqual(policy.evaluate({ environment: "production" }), {
    reason: "risky-remediation",
    proposedAction: "Approve production change.",
  });
}

async function testTypedEventFactory(): Promise<void> {
  const finding = event("agent.finding.produced", {
    findingId: deterministicUuid("typed-event", "finding"),
    severity: "info",
    summary: "typed finding",
    evidence: [{ source: "test", summary: "evidence" }],
  });
  assert.equal(finding.type, "agent.finding.produced");
  assert.equal(finding.payload.summary, "typed finding");
}

async function testChildThreadEventSchemas(): Promise<void> {
  const base = {
    threadId: "parent-thread",
    occurredAt: nowIso(),
    correlationId: deterministicUuid("child-thread", "correlation"),
    actor: { type: "agent", id: "parent-agent" } as const,
  };

  const spawned = ThreadEventSchema.parse({
    ...base,
    eventId: deterministicUuid("child-thread", "spawned"),
    type: "child_thread.spawned",
    scopeKey: "agent:parent-agent",
    stepKey: "spawn-research",
    payload: {
      childThreadId: "child-thread",
      childAgentName: "research-agent",
      scopeKey: "agent:parent-agent",
      stepKey: "spawn-research",
      mode: "attached",
      inputSummary: "Research docs sync approach.",
      metadata: { priority: "normal" },
    },
  });
  assert.equal(spawned.type, "child_thread.spawned");
  assert.equal(spawned.payload.childThreadId, "child-thread");

  const completed = ThreadEventSchema.parse({
    ...base,
    eventId: deterministicUuid("child-thread", "completed"),
    type: "child_thread.completed",
    payload: {
      childThreadId: "child-thread",
      childAgentName: "research-agent",
      outputSummary: "Research complete.",
    },
  });
  assert.equal(completed.type, "child_thread.completed");

  const failed = ThreadEventSchema.parse({
    ...base,
    eventId: deterministicUuid("child-thread", "failed"),
    type: "child_thread.failed",
    payload: {
      childThreadId: "child-thread",
      childAgentName: "research-agent",
      errorCode: "CHILD_FAILED",
      message: "Child failed.",
    },
  });
  assert.equal(failed.type, "child_thread.failed");
}

async function testThreadProjectionLineageSchema(): Promise<void> {
  const projection = ThreadProjectionSchema.parse({
    threadId: "child-thread",
    status: "idle",
    tailSeq: 0,
    activeLeaseOwnerId: null,
    pendingGateIds: [],
    parentThreadId: "parent-thread",
    rootThreadId: "root-thread",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-research",
    updatedAt: nowIso(),
  });

  assert.equal(projection.parentThreadId, "parent-thread");
  assert.equal(projection.rootThreadId, "root-thread");
  assert.equal(projection.parentScopeKey, "agent:parent-agent");
  assert.equal(projection.parentStepKey, "spawn-research");
}

async function testStartChildSessionCreatesLineage(): Promise<void> {
  const parentThreadId = "parent-child-service";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);

  const result = await service.startChildSession({
    parentThreadId,
    agentName: "research-agent",
    input: { query: "research docs" },
    prompt: "Research docs sync approach.",
    source: "test",
    actor: { type: "user", id: "tester" },
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-research",
    idempotencyKey: "spawn-research",
  });

  assert.equal(result.parentThreadId, parentThreadId);
  assert.equal(result.rootThreadId, parentThreadId);

  const childProjection = await engine.getProjection(result.threadId);
  assert(childProjection);
  assert.equal(childProjection.parentThreadId, parentThreadId);
  assert.equal(childProjection.rootThreadId, parentThreadId);
  assert.equal(childProjection.parentScopeKey, "agent:parent-agent");
  assert.equal(childProjection.parentStepKey, "spawn-research");

  const childEvents = await engine.read(result.threadId);
  assert.equal(childEvents[0]?.type, "session.started");
  assert.deepEqual(childEvents[0]?.payload, {
    source: "test",
    agentName: "research-agent",
    metadata: { query: "research docs" },
  });
  assert.equal(childEvents[1]?.type, "prompt.received");
  assert.deepEqual(childEvents[1]?.payload, { prompt: "Research docs sync approach." });

  const parentEvents = await engine.read(parentThreadId);
  const spawnedEvents = parentEvents.filter((event) => event.type === "child_thread.spawned");
  assert.equal(spawnedEvents.length, 1);
  const spawned = spawnedEvents[0];
  assert(spawned?.type === "child_thread.spawned");
  assert.deepEqual(spawned.payload, {
    childThreadId: result.threadId,
    childAgentName: "research-agent",
    scopeKey: "agent:parent-agent",
    stepKey: "spawn-research",
    mode: "attached",
    inputHash: stableJsonHash({ query: "research docs" }),
    inputSummary: "Research docs sync approach.",
  });
}

async function testNestedChildSessionPreservesRootLineage(): Promise<void> {
  const rootThreadId = "nested-child-root";
  const engine = new MemoryThreadEngine(initialHistory(rootThreadId));
  const service = new ThreadService(engine);

  const child = await service.startChildSession({
    parentThreadId: rootThreadId,
    agentName: "child-agent",
    input: { query: "child" },
    source: "test",
    parentScopeKey: "agent:root-agent",
    parentStepKey: "spawn-child",
    idempotencyKey: "spawn-child",
  });
  const grandchild = await service.startChildSession({
    parentThreadId: child.threadId,
    agentName: "grandchild-agent",
    input: { query: "grandchild" },
    source: "test",
    parentScopeKey: "agent:child-agent",
    parentStepKey: "spawn-grandchild",
    idempotencyKey: "spawn-grandchild",
  });

  assert.equal(child.rootThreadId, rootThreadId);
  assert.equal(grandchild.rootThreadId, rootThreadId);
  const grandchildProjection = await engine.getProjection(grandchild.threadId);
  assert(grandchildProjection);
  assert.equal(grandchildProjection.parentThreadId, child.threadId);
  assert.equal(grandchildProjection.rootThreadId, rootThreadId);
  assert.equal(grandchildProjection.parentScopeKey, "agent:child-agent");
  assert.equal(grandchildProjection.parentStepKey, "spawn-grandchild");
}

async function testSpawnCreatesChildSession(): Promise<void> {
  const parentThreadId = "spawn-child-session";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      const child = await ctx.spawn("spawn-child", childAgent, input, {
        prompt: "Run child agent.",
        metadata: { priority: "high" },
      });
      return { finalMessage: `spawned ${child.threadId}` };
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });

  const firstPlan = await planner.plan(parentThreadId, await engine.read(parentThreadId));
  assert.equal(firstPlan, null);

  const parentEvents = await engine.read(parentThreadId);
  const spawned = parentEvents.find(
    (event): event is Extract<ThreadEvent, { type: "child_thread.spawned" }> => event.type === "child_thread.spawned",
  );
  assert(spawned);
  assert.equal(spawned.scopeKey, "agent:parent-agent");
  assert.equal(spawned.stepKey, "spawn-child");
  assert.equal(spawned.payload.childAgentName, "child-agent");
  assert.equal(spawned.payload.inputHash, stableJsonHash({ query: "hello" }));
  assert.equal(spawned.payload.inputSummary, "Run child agent.");
  assert.deepEqual(spawned.payload.metadata, { priority: "high" });

  const childProjection = await engine.getProjection(spawned.payload.childThreadId);
  assert(childProjection);
  assert.equal(childProjection.parentThreadId, parentThreadId);
  assert.equal(childProjection.parentScopeKey, "agent:parent-agent");
  assert.equal(childProjection.parentStepKey, "spawn-child");

  const replayPlan = await planner.plan(parentThreadId, await engine.read(parentThreadId));
  assert(replayPlan);
  assert.equal(replayPlan.resumeReason, "child-spawned");
  assert.equal(replayPlan.events[0]?.type, "agent.response.produced");
  const spawnedAgain = (await engine.read(parentThreadId)).filter((event) => event.type === "child_thread.spawned");
  assert.equal(spawnedAgain.length, 1);
}

async function testDetachedSpawnDoesNotBlockParentCompletion(): Promise<void> {
  const parentThreadId = "detached-spawn-parent-completion";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      const child = await ctx.spawn("spawn-detached", childAgent, input, { detached: true });
      return { finalMessage: `detached ${child.agentName}` };
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });

  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  const spawned = (await engine.read(parentThreadId)).find(
    (event): event is Extract<ThreadEvent, { type: "child_thread.spawned" }> => event.type === "child_thread.spawned",
  );
  assert(spawned);
  assert.equal(spawned.payload.mode, "detached");
  const childProjection = await engine.getProjection(spawned.payload.childThreadId);
  assert(childProjection);
  assert.equal(childProjection.status, "waiting");
  assert.equal(childProjection.parentThreadId, parentThreadId);

  const finalPlan = await planner.plan(parentThreadId, await engine.read(parentThreadId));
  assert(finalPlan);
  assert.equal(finalPlan.resumeReason, "child-spawned");
  assert.deepEqual(finalPlan.events[0]?.payload, { message: "detached child-agent" });
  assert.equal((await engine.getProjection(spawned.payload.childThreadId))?.status, "waiting");
}

async function testSpawnInputMismatch(): Promise<void> {
  const parentThreadId = "spawn-input-mismatch";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      await ctx.spawn("spawn-child", childAgent, input);
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });

  await planner.plan(parentThreadId, await engine.read(parentThreadId));

  const mismatchAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx) {
      await ctx.spawn("spawn-child", childAgent, { query: "changed" });
    },
  });
  const mismatchPlanner = createAgentPlanner(mismatchAgent, mismatchAgent.name, { service });

  await assert.rejects(
    async () => {
      await mismatchPlanner.plan(parentThreadId, await engine.read(parentThreadId));
    },
    ReplayMismatchError,
  );
}

async function testSpawnPromptMismatch(): Promise<void> {
  const parentThreadId = "spawn-prompt-mismatch";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      await ctx.spawn("spawn-child", childAgent, input, { prompt: "Run original prompt." });
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });
  await planner.plan(parentThreadId, await engine.read(parentThreadId));

  const mismatchAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      await ctx.spawn("spawn-child", childAgent, input, { prompt: "Run changed prompt." });
    },
  });
  const mismatchPlanner = createAgentPlanner(mismatchAgent, mismatchAgent.name, { service });

  await assert.rejects(
    async () => {
      await mismatchPlanner.plan(parentThreadId, await engine.read(parentThreadId));
    },
    ReplayMismatchError,
  );
}

async function testSpawnMetadataMismatch(): Promise<void> {
  const parentThreadId = "spawn-metadata-mismatch";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      await ctx.spawn("spawn-child", childAgent, input, { metadata: { region: "us" } });
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });
  await planner.plan(parentThreadId, await engine.read(parentThreadId));

  const mismatchAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      await ctx.spawn("spawn-child", childAgent, input, { metadata: { region: "eu" } });
    },
  });
  const mismatchPlanner = createAgentPlanner(mismatchAgent, mismatchAgent.name, { service });

  await assert.rejects(
    async () => {
      await mismatchPlanner.plan(parentThreadId, await engine.read(parentThreadId));
    },
    ReplayMismatchError,
  );
}

async function testJoinMirrorsCompletedChild(): Promise<void> {
  const parentThreadId = "join-completed-child";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      const child = await ctx.spawn("spawn-child", childAgent, input);
      const result = await ctx.join("wait-child", child);
      if (result.status === "failed") {
        return { finalMessage: result.message };
      }
      const output = result.output as { answer?: number } | undefined;
      return { finalMessage: `answer=${output?.answer ?? "missing"}` };
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });

  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  const spawned = (await engine.read(parentThreadId)).find(
    (event): event is Extract<ThreadEvent, { type: "child_thread.spawned" }> => event.type === "child_thread.spawned",
  );
  assert(spawned);
  await engine.append([
    {
      eventId: eventKey(spawned.payload.childThreadId, "agent.response.produced", "done"),
      threadId: spawned.payload.childThreadId,
      type: "agent.response.produced",
      occurredAt: nowIso(),
      correlationId: spawned.correlationId,
      actor: { type: "agent", id: "child-agent" },
      payload: { message: "child finished" },
    },
    {
      eventId: eventKey(spawned.payload.childThreadId, "agent.output.completed", "done"),
      threadId: spawned.payload.childThreadId,
      type: "agent.output.completed",
      occurredAt: nowIso(),
      correlationId: spawned.correlationId,
      actor: { type: "agent", id: "child-agent" },
      payload: {
        output: { answer: 42 },
        summary: "child finished",
      },
    },
  ]);

  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  const completed = (await engine.read(parentThreadId)).find(
    (event): event is Extract<ThreadEvent, { type: "child_thread.completed" }> => event.type === "child_thread.completed",
  );
  assert(completed);
  assert.equal(completed.scopeKey, "agent:parent-agent");
  assert.equal(completed.stepKey, "wait-child");
  assert.deepEqual(completed.payload, {
    childThreadId: spawned.payload.childThreadId,
    childAgentName: "child-agent",
    output: { answer: 42 },
    outputSummary: "child finished",
  });

  const finalPlan = await planner.plan(parentThreadId, await engine.read(parentThreadId));
  assert(finalPlan);
  assert.equal(finalPlan.resumeReason, "child-completed");
  assert.equal(finalPlan.events[0]?.type, "agent.response.produced");
  assert.deepEqual(finalPlan.events[0]?.payload, { message: "answer=42" });
  assert.equal(finalPlan.events[1]?.type, "agent.output.completed");
  assert.deepEqual(finalPlan.events[1]?.payload, {
    output: { finalMessage: "answer=42" },
    summary: "answer=42",
  });
}

async function testChildTerminalMirroringIdempotency(): Promise<void> {
  const parentThreadId = "child-terminal-mirroring-idempotency";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const child = await service.startChildSession({
    parentThreadId,
    agentName: "child-agent",
    input: { query: "child" },
    source: "test",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-child",
    idempotencyKey: "spawn-child",
  });
  await engine.append([
    {
      eventId: eventKey(child.threadId, "agent.response.produced", "done"),
      threadId: child.threadId,
      type: "agent.response.produced",
      occurredAt: nowIso(),
      actor: { type: "agent", id: "child-agent" },
      payload: { message: "child done" },
    },
  ]);

  const firstMirror = await service.mirrorChildTerminalEvent({
    parentThreadId,
    childThreadId: child.threadId,
    childAgentName: "child-agent",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "wait-child",
  });
  const secondMirror = await service.mirrorChildTerminalEvent({
    parentThreadId,
    childThreadId: child.threadId,
    childAgentName: "child-agent",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "wait-child",
  });

  assert.deepEqual(firstMirror, { mirrored: true, eventType: "child_thread.completed" });
  assert.deepEqual(secondMirror, { mirrored: true, eventType: "child_thread.completed" });
  const mirrored = (await engine.read(parentThreadId)).filter((event) => event.type === "child_thread.completed");
  assert.equal(mirrored.length, 1);
}

async function testJoinValidatesStructuredChildOutput(): Promise<void> {
  const parentThreadId = "join-validates-structured-child-output";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      const child = await ctx.spawn("spawn-child", structuredChildAgent, input);
      const result = await ctx.join("wait-child", child);
      if (result.status === "failed") {
        return { finalMessage: result.message };
      }
      return { finalMessage: `answer=${result.output?.answer ?? "missing"}` };
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });

  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  const spawned = (await engine.read(parentThreadId)).find(
    (event): event is Extract<ThreadEvent, { type: "child_thread.spawned" }> => event.type === "child_thread.spawned",
  );
  assert(spawned);
  await engine.append([
    {
      eventId: eventKey(spawned.payload.childThreadId, "agent.response.produced", "done"),
      threadId: spawned.payload.childThreadId,
      type: "agent.response.produced",
      occurredAt: nowIso(),
      correlationId: spawned.correlationId,
      actor: { type: "agent", id: "structured-child-agent" },
      payload: { message: "child finished" },
    },
    {
      eventId: eventKey(spawned.payload.childThreadId, "agent.output.completed", "done"),
      threadId: spawned.payload.childThreadId,
      type: "agent.output.completed",
      occurredAt: nowIso(),
      correlationId: spawned.correlationId,
      actor: { type: "agent", id: "structured-child-agent" },
      payload: {
        output: { answer: 42 },
        summary: "child finished",
      },
    },
  ]);

  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  const finalPlan = await planner.plan(parentThreadId, await engine.read(parentThreadId));
  assert(finalPlan);
  assert.deepEqual(finalPlan.events[0]?.payload, { message: "answer=42" });
}

async function testJoinRejectsInvalidStructuredChildOutput(): Promise<void> {
  const parentThreadId = "join-invalid-structured-child-output";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      const child = await ctx.spawn("spawn-child", structuredChildAgent, input);
      await ctx.join("wait-child", child);
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });

  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  const spawned = (await engine.read(parentThreadId)).find(
    (event): event is Extract<ThreadEvent, { type: "child_thread.spawned" }> => event.type === "child_thread.spawned",
  );
  assert(spawned);
  await engine.append([
    {
      eventId: eventKey(spawned.payload.childThreadId, "agent.response.produced", "done"),
      threadId: spawned.payload.childThreadId,
      type: "agent.response.produced",
      occurredAt: nowIso(),
      correlationId: spawned.correlationId,
      actor: { type: "agent", id: "structured-child-agent" },
      payload: { message: "child finished" },
    },
    {
      eventId: eventKey(spawned.payload.childThreadId, "agent.output.completed", "done"),
      threadId: spawned.payload.childThreadId,
      type: "agent.output.completed",
      occurredAt: nowIso(),
      correlationId: spawned.correlationId,
      actor: { type: "agent", id: "structured-child-agent" },
      payload: {
        output: { answer: "not a number" },
        summary: "child finished",
      },
    },
  ]);

  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  await assert.rejects(
    async () => {
      await planner.plan(parentThreadId, await engine.read(parentThreadId));
    },
    ReplayMismatchError,
  );
}

async function testCancelChildRecordsTerminalFailure(): Promise<void> {
  const parentThreadId = "cancel-child-terminal-failure";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      const child = await ctx.spawn("spawn-child", childAgent, input);
      await ctx.cancelChild("cancel-child", child, { reason: "No longer needed." });
      return { finalMessage: "cancelled" };
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });

  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  const spawned = (await engine.read(parentThreadId)).find(
    (event): event is Extract<ThreadEvent, { type: "child_thread.spawned" }> => event.type === "child_thread.spawned",
  );
  assert(spawned);
  const childFailed = (await engine.read(spawned.payload.childThreadId)).find(
    (event): event is Extract<ThreadEvent, { type: "agent.failed" }> => event.type === "agent.failed",
  );
  assert(childFailed);
  assert.deepEqual(childFailed.payload, { errorCode: "CHILD_CANCELLED", message: "No longer needed." });
  const parentFailed = (await engine.read(parentThreadId)).find(
    (event): event is Extract<ThreadEvent, { type: "child_thread.failed" }> => event.type === "child_thread.failed",
  );
  assert(parentFailed);
  assert.equal(parentFailed.scopeKey, "agent:parent-agent");
  assert.equal(parentFailed.stepKey, "cancel-child");
  assert.deepEqual(parentFailed.payload, {
    childThreadId: spawned.payload.childThreadId,
    childAgentName: "child-agent",
    errorCode: "CHILD_CANCELLED",
    message: "No longer needed.",
  });

  const finalPlan = await planner.plan(parentThreadId, await engine.read(parentThreadId));
  assert(finalPlan);
  assert.deepEqual(finalPlan.events[0]?.payload, { message: "cancelled" });
  const childFailures = (await engine.read(spawned.payload.childThreadId)).filter((event) => event.type === "agent.failed");
  assert.equal(childFailures.length, 1);
}

async function testCancelChildThreadIdempotencyAndTerminalRejection(): Promise<void> {
  const parentThreadId = "cancel-child-idempotency";
  const otherParentThreadId = "cancel-child-other-parent";
  const engine = new MemoryThreadEngine([...initialHistory(parentThreadId), ...initialHistory(otherParentThreadId)]);
  const service = new ThreadService(engine);
  const child = await service.startChildSession({
    parentThreadId,
    agentName: "child-agent",
    input: { query: "child" },
    source: "test",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-child",
    idempotencyKey: "spawn-child",
  });

  await assert.rejects(
    async () => {
      await service.cancelChildThread({ parentThreadId: otherParentThreadId, childThreadId: child.threadId });
    },
    /Child thread not found for parent/,
  );

  const firstCancel = await service.cancelChildThread({
    parentThreadId,
    childThreadId: child.threadId,
    childAgentName: "child-agent",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "cancel-child",
    reason: "No longer needed.",
  });
  const secondCancel = await service.cancelChildThread({
    parentThreadId,
    childThreadId: child.threadId,
    childAgentName: "child-agent",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "cancel-child",
    reason: "No longer needed.",
  });

  assert.deepEqual(firstCancel, { childThreadId: child.threadId, cancelled: true, errorCode: "CHILD_CANCELLED" });
  assert.deepEqual(secondCancel, { childThreadId: child.threadId, cancelled: true, errorCode: "CHILD_CANCELLED" });
  assert.equal((await engine.read(child.threadId)).filter((event) => event.type === "agent.failed").length, 1);
  assert.equal((await engine.read(parentThreadId)).filter((event) => event.type === "child_thread.failed").length, 1);

  const completedChild = await service.startChildSession({
    parentThreadId,
    agentName: "completed-child-agent",
    input: { query: "completed" },
    source: "test",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-completed-child",
    idempotencyKey: "spawn-completed-child",
  });
  await engine.append([
    {
      eventId: eventKey(completedChild.threadId, "agent.response.produced", "done"),
      threadId: completedChild.threadId,
      type: "agent.response.produced",
      occurredAt: nowIso(),
      actor: { type: "agent", id: "completed-child-agent" },
      payload: { message: "done" },
    },
  ]);

  await assert.rejects(
    async () => {
      await service.cancelChildThread({ parentThreadId, childThreadId: completedChild.threadId });
    },
    /Child thread is already completed/,
  );
}

async function testJoinCancelledChild(): Promise<void> {
  const parentThreadId = "join-cancelled-child";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      const child = await ctx.spawn("spawn-child", childAgent, input);
      await ctx.cancelChild("cancel-child", child, { reason: "Cancelled before join." });
      const result = await ctx.join("wait-child", child);
      return { finalMessage: result.status === "failed" ? `${result.errorCode}:${result.message}` : "unexpected" };
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });

  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  const finalPlan = await planner.plan(parentThreadId, await engine.read(parentThreadId));
  assert(finalPlan);
  assert.deepEqual(finalPlan.events[0]?.payload, { message: "CHILD_CANCELLED:Cancelled before join." });
}

async function testJoinFailedChild(): Promise<void> {
  const parentThreadId = "join-failed-child";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx, input) {
      const child = await ctx.spawn("spawn-child", childAgent, input);
      const result = await ctx.join("wait-child", child);
      return { finalMessage: result.status === "failed" ? result.message : "unexpected" };
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });

  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  const spawned = (await engine.read(parentThreadId)).find(
    (event): event is Extract<ThreadEvent, { type: "child_thread.spawned" }> => event.type === "child_thread.spawned",
  );
  assert(spawned);
  await engine.append([
    {
      eventId: eventKey(spawned.payload.childThreadId, "agent.failed", "boom"),
      threadId: spawned.payload.childThreadId,
      type: "agent.failed",
      occurredAt: nowIso(),
      correlationId: spawned.correlationId,
      actor: { type: "system", id: "test" },
      payload: { errorCode: "CHILD_ERROR", message: "child failed" },
    },
  ]);

  assert.equal(await planner.plan(parentThreadId, await engine.read(parentThreadId)), null);
  const failed = (await engine.read(parentThreadId)).find(
    (event): event is Extract<ThreadEvent, { type: "child_thread.failed" }> => event.type === "child_thread.failed",
  );
  assert(failed);
  assert.deepEqual(failed.payload, {
    childThreadId: spawned.payload.childThreadId,
    childAgentName: "child-agent",
    errorCode: "CHILD_ERROR",
    message: "child failed",
  });

  const finalPlan = await planner.plan(parentThreadId, await engine.read(parentThreadId));
  assert(finalPlan);
  assert.equal(finalPlan.resumeReason, "child-failed");
  assert.deepEqual(finalPlan.events[0]?.payload, { message: "child failed" });
}

async function testJoinRejectsUnrelatedChild(): Promise<void> {
  const parentA = "join-parent-a";
  const parentB = "join-parent-b";
  const engine = new MemoryThreadEngine([...initialHistory(parentA), ...initialHistory(parentB)]);
  const service = new ThreadService(engine);
  const child = await service.startChildSession({
    parentThreadId: parentA,
    agentName: "child-agent",
    input: { query: "a" },
    source: "test",
    parentScopeKey: "agent:parent-a",
    parentStepKey: "spawn-child",
    idempotencyKey: "spawn-child",
  });
  await engine.append([
    {
      eventId: eventKey(child.threadId, "agent.response.produced", "done"),
      threadId: child.threadId,
      type: "agent.response.produced",
      occurredAt: nowIso(),
      actor: { type: "agent", id: "child-agent" },
      payload: { message: "done" },
    },
  ]);
  const parentBAgent = agent({
    name: "parent-b",
    input: inputSchema,
    async run(ctx) {
      await ctx.join("wait-child", { threadId: child.threadId, agentName: "child-agent" });
    },
  });
  const planner = createAgentPlanner(parentBAgent, parentBAgent.name, { service });

  await assert.rejects(
    async () => {
      await planner.plan(parentB, await engine.read(parentB));
    },
    /Child thread not found for parent/,
  );
  const parentBEvents = await engine.read(parentB);
  assert.equal(parentBEvents.some((event) => event.type === "child_thread.completed" || event.type === "child_thread.failed"), false);
}

async function testListChildren(): Promise<void> {
  const parentThreadId = "list-children-service";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);

  const attached = await service.startChildSession({
    parentThreadId,
    agentName: "attached-agent",
    input: { query: "attached" },
    source: "test",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-attached",
    idempotencyKey: "spawn-attached",
  });
  await service.startChildSession({
    parentThreadId,
    agentName: "detached-agent",
    input: { query: "detached" },
    source: "test",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-detached",
    detached: true,
    idempotencyKey: "spawn-detached",
  });

  const defaultChildren = await service.listChildren(parentThreadId);
  assert.deepEqual(defaultChildren, [
    {
      threadId: attached.threadId,
      agentName: "attached-agent",
      parentThreadId,
      rootThreadId: parentThreadId,
      parentScopeKey: "agent:parent-agent",
      parentStepKey: "spawn-attached",
      status: "waiting",
    },
  ]);

  const allChildren = await service.listChildren(parentThreadId, { includeDetached: true });
  assert.equal(allChildren.length, 2);
  assert.deepEqual(
    allChildren.map((child) => child.agentName),
    ["attached-agent", "detached-agent"],
  );

  const attachedByAgent = await service.listChildren(parentThreadId, { agentName: "attached-agent" });
  assert.deepEqual(
    attachedByAgent.map((child) => child.agentName),
    ["attached-agent"],
  );

  await engine.append([
    {
      eventId: eventKey(attached.threadId, "agent.response.produced", "done"),
      threadId: attached.threadId,
      type: "agent.response.produced",
      occurredAt: nowIso(),
      actor: { type: "agent", id: "attached-agent" },
      payload: { message: "done" },
    },
  ]);

  const completedChildren = await service.listChildren(parentThreadId, { status: "completed" });
  assert.deepEqual(
    completedChildren.map((child) => ({ agentName: child.agentName, status: child.status })),
    [{ agentName: "attached-agent", status: "completed" }],
  );
}

async function testContextChildren(): Promise<void> {
  const parentThreadId = "context-children";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  await service.startChildSession({
    parentThreadId,
    agentName: "child-agent",
    input: { query: "existing" },
    source: "test",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-existing",
    idempotencyKey: "spawn-existing",
  });
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx) {
      const children = await ctx.children();
      return { finalMessage: `children=${children.map((child) => child.agentName).join(",")}` };
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });

  const plan = await planner.plan(parentThreadId, await engine.read(parentThreadId));
  assert(plan);
  assert.deepEqual(plan.events[0]?.payload, { message: "children=child-agent" });
}

async function testContextChildrenFilters(): Promise<void> {
  const parentThreadId = "context-children-filters";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const first = await service.startChildSession({
    parentThreadId,
    agentName: "first-agent",
    input: { query: "first" },
    source: "test",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-first",
    idempotencyKey: "spawn-first",
  });
  await service.startChildSession({
    parentThreadId,
    agentName: "second-agent",
    input: { query: "second" },
    source: "test",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-second",
    idempotencyKey: "spawn-second",
  });
  await engine.append([
    {
      eventId: eventKey(first.threadId, "agent.response.produced", "done"),
      threadId: first.threadId,
      type: "agent.response.produced",
      occurredAt: nowIso(),
      actor: { type: "agent", id: "first-agent" },
      payload: { message: "done" },
    },
  ]);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run(ctx) {
      const children = await ctx.children({ agentName: ["first-agent", "second-agent"], status: "completed" });
      return { finalMessage: `children=${children.map((child) => `${child.agentName}:${child.status}`).join(",")}` };
    },
  });
  const planner = createAgentPlanner(parentAgent, parentAgent.name, { service });

  const plan = await planner.plan(parentThreadId, await engine.read(parentThreadId));
  assert(plan);
  assert.deepEqual(plan.events[0]?.payload, { message: "children=first-agent:completed" });
}

async function testRuntimePlannerDispatchesChildAgent(): Promise<void> {
  const parentThreadId = "dispatch-parent";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const parentAgent = agent({
    name: "parent-agent",
    input: inputSchema,
    async run() {
      return { finalMessage: "parent ran" };
    },
  });
  const childDispatchAgent = agent({
    name: "dispatch-child-agent",
    input: inputSchema,
    async run(_ctx, input) {
      return { finalMessage: `child ran ${input.query}` };
    },
  });
  const app = weave({ agents: [parentAgent, childDispatchAgent] });
  const child = await service.startChildSession({
    parentThreadId,
    agentName: childDispatchAgent.name,
    input: { query: "child-input" },
    source: "test",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-child",
    idempotencyKey: "spawn-child",
  });
  const planner = createRuntimeAgentPlanner(app, parentAgent.name, service);

  const plan = await planner.plan(child.threadId, await engine.read(child.threadId));
  assert(plan);
  assert.deepEqual(plan.events[0]?.payload, { message: "child ran child-input" });
}

async function testRuntimePlannerFallsBackToDefaultAgent(): Promise<void> {
  const threadId = "dispatch-root-default";
  const engine = new MemoryThreadEngine(initialHistory(threadId));
  const service = new ThreadService(engine);
  const defaultAgent = agent({
    name: "default-agent",
    input: inputSchema,
    async run(_ctx, input) {
      return { finalMessage: `default ran ${input.query}` };
    },
  });
  const otherAgent = agent({
    name: "other-agent",
    input: inputSchema,
    async run() {
      return { finalMessage: "other ran" };
    },
  });
  const app = weave({ agents: [defaultAgent, otherAgent] });
  const planner = createRuntimeAgentPlanner(app, defaultAgent.name, service);

  const plan = await planner.plan(threadId, await engine.read(threadId));
  assert(plan);
  assert.deepEqual(plan.events[0]?.payload, { message: "default ran hello" });
}

async function testStartSessionAgentNameDispatchesRootSession(): Promise<void> {
  const engine = new MemoryThreadEngine();
  const service = new ThreadService(engine);
  const defaultAgent = agent({
    name: "default-agent",
    input: inputSchema,
    async run() {
      return { finalMessage: "default ran" };
    },
  });
  const targetAgent = agent({
    name: "target-root-agent",
    input: inputSchema,
    async run(_ctx, input) {
      return { finalMessage: `target ran ${input.query}` };
    },
  });
  const app = weave({ agents: [defaultAgent, targetAgent] });
  const session = await service.startSession({
    prompt: "Run target agent.",
    source: "test",
    agentName: targetAgent.name,
    metadata: { query: "root-input" },
    idempotencyKey: "target-root-agent-session",
  });
  const events = await engine.read(session.threadId);
  const started = events.find(
    (event): event is Extract<ThreadEvent, { type: "session.started" }> => event.type === "session.started",
  );
  assert(started);
  assert.equal(started.payload.agentName, targetAgent.name);

  const planner = createRuntimeAgentPlanner(app, defaultAgent.name, service);
  const plan = await planner.plan(session.threadId, events);
  assert(plan);
  assert.deepEqual(plan.events[0]?.payload, { message: "target ran root-input" });
}

async function testApiCreateThreadAcceptsAgentName(): Promise<void> {
  const engine = new MemoryThreadEngine();
  const service = new ThreadService(engine);
  const server = createApiServer(engine, service);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");
    const response = await fetch(`http://127.0.0.1:${address.port}/threads`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Run target agent.",
        agentName: "target-root-agent",
        metadata: { query: "root-input" },
      }),
    });
    assert.equal(response.status, 201);
    const body = (await response.json()) as { threadId: string };
    const events = await engine.read(body.threadId);
    const started = events.find(
      (event): event is Extract<ThreadEvent, { type: "session.started" }> => event.type === "session.started",
    );
    assert(started);
    assert.equal(started.payload.agentName, "target-root-agent");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

async function testStartSessionIdempotencyMismatch(): Promise<void> {
  const engine = new MemoryThreadEngine();
  const service = new ThreadService(engine);
  const input = {
    prompt: "Run target agent.",
    source: "test" as const,
    agentName: "target-agent",
    metadata: { query: "root-input" },
    idempotencyKey: "root-session-idempotency",
  };

  const first = await service.startSession(input);
  const second = await service.startSession(input);
  assert.deepEqual(second, first);
  assert.equal((await engine.read(first.threadId)).length, 2);

  await assert.rejects(
    async () => {
      await service.startSession({ ...input, prompt: "Different prompt." });
    },
    ReplayMismatchError,
  );
  await assert.rejects(
    async () => {
      await service.startSession({ ...input, agentName: "different-agent" });
    },
    ReplayMismatchError,
  );
  await assert.rejects(
    async () => {
      await service.startSession({ ...input, metadata: { query: "changed" } });
    },
    ReplayMismatchError,
  );
}

async function testUnknownRootSessionAgentRecordsFailure(): Promise<void> {
  const engine = new MemoryThreadEngine();
  const service = new ThreadService(engine);
  const defaultAgent = agent({
    name: "default-agent",
    input: inputSchema,
    async run() {
      return { finalMessage: "default ran" };
    },
  });
  const app = weave({ agents: [defaultAgent] });
  const session = await service.startSession({
    prompt: "Run missing agent.",
    source: "test",
    agentName: "missing-agent",
    metadata: { query: "root-input" },
    idempotencyKey: "missing-root-agent-session",
  });
  const runner = new ThreadRunner(
    engine,
    engine,
    createRuntimeAgentPlanner(app, defaultAgent.name, service),
    "test-runner",
  );

  const result = await runner.runOnce(session.threadId);
  assert.deepEqual(result, { acted: true, appendedEvents: 1, reason: "agent-failed" });
  const events = await engine.read(session.threadId);
  const failed = events.find(
    (event): event is Extract<ThreadEvent, { type: "agent.failed" }> => event.type === "agent.failed",
  );
  assert(failed);
  assert.equal(failed.payload.errorCode, "AGENT_NOT_FOUND");
  assert.equal(events.some((event) => event.type === "agent.response.produced"), false);
  assert.equal(events.some((event) => event.type === "agent.output.completed"), false);
}

async function testUnknownChildSessionAgentRecordsFailure(): Promise<void> {
  const parentThreadId = "unknown-child-agent-parent";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const defaultAgent = agent({
    name: "default-agent",
    input: inputSchema,
    async run() {
      return { finalMessage: "default ran" };
    },
  });
  const child = await service.startChildSession({
    parentThreadId,
    agentName: "missing-child-agent",
    input: { query: "child-input" },
    source: "test",
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-missing-child",
    idempotencyKey: "spawn-missing-child",
  });
  const runner = new ThreadRunner(
    engine,
    engine,
    createRuntimeAgentPlanner(weave({ agents: [defaultAgent] }), defaultAgent.name, service),
    "test-runner",
  );

  const result = await runner.runOnce(child.threadId);
  assert.deepEqual(result, { acted: true, appendedEvents: 1, reason: "agent-failed" });
  const events = await engine.read(child.threadId);
  const failed = events.find(
    (event): event is Extract<ThreadEvent, { type: "agent.failed" }> => event.type === "agent.failed",
  );
  assert(failed);
  assert.equal(failed.payload.errorCode, "AGENT_NOT_FOUND");
  assert.equal(events.some((event) => event.type === "agent.response.produced"), false);
  assert.equal(events.some((event) => event.type === "agent.output.completed"), false);
}

async function testRuntimeRegistersToolsFromAllAgents(): Promise<void> {
  const threadId = "runtime-all-agent-tools";
  const childOnlyTool = tool({
    name: "child.only-tool",
    description: "Tool declared only by the non-default child agent.",
    input: inputSchema,
    output: z.object({ value: z.string().min(1) }),
    run({ input }) {
      return { value: `handled ${input.query}` };
    },
  });
  const defaultAgent = agent({
    name: "default-agent",
    input: inputSchema,
    async run() {
      return { finalMessage: "default ran" };
    },
  });
  const childToolAgent = agent({
    name: "child-tool-agent",
    input: inputSchema,
    tools: [childOnlyTool],
    async run(ctx, input) {
      const result = await ctx.tool("child-only", childOnlyTool, input);
      return { finalMessage: result.value };
    },
  });
  const request: Extract<ThreadEvent, { type: "tool.requested" }> = {
    eventId: eventKey(threadId, "tool.requested", "child-only"),
    threadId,
    type: "tool.requested",
    occurredAt: nowIso(),
    correlationId: deterministicUuid("correlation", threadId),
    scopeKey: "agent:child-tool-agent",
    stepKey: "child-only",
    actor: { type: "agent", id: "child-tool-agent" },
    payload: {
      toolCallId: deterministicUuid("tool-call", threadId, "agent:child-tool-agent", "child-only", childOnlyTool.name),
      toolName: childOnlyTool.name,
      args: { query: "child-input" },
      scopeKey: "agent:child-tool-agent",
      stepKey: "child-only",
    },
  };
  const engine = new MemoryThreadEngine([request]);
  const service = new ThreadService(engine);
  const runtimeEngine = engine as unknown as Parameters<typeof createWeaveRuntime>[0]["engine"];
  const runtime = createWeaveRuntime({
    app: weave({ agents: [defaultAgent, childToolAgent] }),
    agentName: defaultAgent.name,
    engine: runtimeEngine,
    service,
  });

  assert.equal((await runtime.toolWorker.processOnce(threadId)).eventType, "tool.started");
  assert.equal((await runtime.toolWorker.processOnce(threadId)).eventType, "tool.completed");
  const completed = (await engine.read(threadId)).find(
    (event): event is Extract<ThreadEvent, { type: "tool.completed" }> => event.type === "tool.completed",
  );
  assert(completed);
  assert.deepEqual(completed.payload.output, { value: "handled child-input" });
}

async function testStartChildSessionIdempotency(): Promise<void> {
  const parentThreadId = "parent-child-idempotent";
  const engine = new MemoryThreadEngine(initialHistory(parentThreadId));
  const service = new ThreadService(engine);
  const input = {
    parentThreadId,
    agentName: "research-agent",
    input: { query: "research docs" },
    source: "test" as const,
    parentScopeKey: "agent:parent-agent",
    parentStepKey: "spawn-research",
    idempotencyKey: "spawn-research",
  };

  const first = await service.startChildSession(input);
  const second = await service.startChildSession(input);

  assert.deepEqual(second, first);
  assert.equal((await engine.read(first.threadId)).length, 2);
  const spawnedEvents = (await engine.read(parentThreadId)).filter((event) => event.type === "child_thread.spawned");
  assert.equal(spawnedEvents.length, 1);

  await assert.rejects(
    async () => {
      await service.startChildSession({ ...input, input: { query: "changed" } });
    },
    ReplayMismatchError,
  );
  await assert.rejects(
    async () => {
      await service.startChildSession({ ...input, agentName: "different-agent" });
    },
    ReplayMismatchError,
  );
  await assert.rejects(
    async () => {
      await service.startChildSession({ ...input, parentStepKey: "different-step" });
    },
    ReplayMismatchError,
  );
  await assert.rejects(
    async () => {
      await service.startChildSession({ ...input, detached: true });
    },
    ReplayMismatchError,
  );
  await assert.rejects(
    async () => {
      await service.startChildSession({ ...input, metadata: { priority: "high" } });
    },
    ReplayMismatchError,
  );
}

async function testAgentFailureEvent(): Promise<void> {
  const threadId = "agent-failure-event";
  const engine = new MemoryThreadEngine(initialHistory(threadId));
  const runner = new ThreadRunner(
    engine,
    engine,
    {
      plan() {
        throw new Error("planner exploded");
      },
    },
    "test-runner",
  );

  const result = await runner.runOnce(threadId);
  assert.deepEqual(result, { acted: true, appendedEvents: 1, reason: "agent-failed" });
  const failed = engine.events.find((event): event is Extract<ThreadEvent, { type: "agent.failed" }> => {
    return event.type === "agent.failed";
  });
  assert(failed);
  assert.equal(failed.payload.errorCode, "AGENT_FAILED");
  assert.equal(failed.payload.message, "planner exploded");
}

function initialHistory(threadId: string): ThreadEvent[] {
  const correlationId = deterministicUuid("correlation", threadId);
  const sessionStarted: Extract<ThreadEvent, { type: "session.started" }> = {
    eventId: eventKey(threadId, "session.started", "initial"),
    threadId,
    type: "session.started",
    occurredAt: nowIso(),
    correlationId,
    actor: { type: "system", id: "test" },
    payload: {
      source: "test",
      metadata: { query: "hello" },
    },
  };
  const promptReceived: Extract<ThreadEvent, { type: "prompt.received" }> = {
    eventId: eventKey(threadId, "prompt.received", "initial"),
    threadId,
    type: "prompt.received",
    occurredAt: nowIso(),
    correlationId,
    causationId: sessionStarted.eventId,
    actor: { type: "user", id: "test" },
    payload: { prompt: "hello" },
  };

  return [sessionStarted, promptReceived];
}

function requestedEvent(threadId: string): Extract<ThreadEvent, { type: "tool.requested" }> {
  return {
    eventId: eventKey(threadId, "tool.requested", "agent:test-agent:lookup:test.lookup"),
    threadId,
    type: "tool.requested",
    occurredAt: nowIso(),
    correlationId: deterministicUuid("correlation", threadId),
    causationId: eventKey(threadId, "prompt.received", "initial"),
    scopeKey: "agent:test-agent",
    stepKey: "lookup",
    actor: { type: "agent", id: "test-agent" },
    payload: {
      toolCallId: deterministicUuid("tool-call", threadId, "agent:test-agent", "lookup", "test.lookup"),
      toolName: "test.lookup",
      args: { query: "hello" },
      scopeKey: "agent:test-agent",
      stepKey: "lookup",
    },
  };
}

async function runToolToCompletion(
  toolName: string,
  toolContract: AnyToolContract,
): Promise<Extract<ThreadEvent, { type: "tool.completed" }>> {
  const result = await runToolToTerminal(toolName, toolContract);
  assert.equal(result.terminal.type, "tool.completed");
  return result.terminal;
}

async function runToolToTerminal(
  toolName: string,
  toolContract: AnyToolContract,
  credentialProvider?: CredentialProvider,
): Promise<{
  events: ThreadEvent[];
  terminal: Extract<ThreadEvent, { type: "tool.completed" | "tool.failed" }>;
}> {
  const threadId = `worker-${toolName}`;
  const request = requestedEventForTool(threadId, toolName);
  const engine = new MemoryThreadEngine([request]);
  const worker = new ContractToolWorker(engine, [toolContract], "test-worker", credentialProvider);

  assert.equal((await worker.processOnce(threadId)).eventType, "tool.started");
  const second = await worker.processOnce(threadId);
  assert(second.eventType === "tool.completed" || second.eventType === "tool.failed");

  const terminal = engine.events.find((event): event is Extract<ThreadEvent, { type: "tool.completed" | "tool.failed" }> => {
    return event.type === second.eventType;
  });
  assert(terminal);
  return { events: engine.events, terminal };
}

class ThrowingCredentialProvider implements CredentialProvider {
  constructor(private readonly message: string) {}

  async resolve(
    _request: CredentialRequest,
    _context: CredentialResolutionContext,
  ): Promise<CredentialResolution | null> {
    throw new Error(this.message);
  }
}

class CapturingCredentialProvider implements CredentialProvider {
  readonly requests: CredentialRequest[] = [];

  constructor(private readonly values: Record<string, string>) {}

  async resolve(
    request: CredentialRequest,
    _context: CredentialResolutionContext,
  ): Promise<CredentialResolution | null> {
    this.requests.push(request);
    const value = this.values[request.name];
    if (value === undefined) {
      return null;
    }

    return {
      name: request.name,
      kind: request.kind,
      source: "capturing-test",
      value,
    };
  }
}

function requestedEventForTool(threadId: string, toolName: string): Extract<ThreadEvent, { type: "tool.requested" }> {
  return {
    eventId: eventKey(threadId, "tool.requested", `agent:test-agent:worker:${toolName}`),
    threadId,
    type: "tool.requested",
    occurredAt: nowIso(),
    correlationId: deterministicUuid("correlation", threadId),
    causationId: eventKey(threadId, "prompt.received", "initial"),
    scopeKey: "agent:test-agent",
    stepKey: "worker",
    actor: { type: "agent", id: "test-agent" },
    payload: {
      toolCallId: deterministicUuid("tool-call", threadId, "agent:test-agent", "worker", toolName),
      toolName,
      args: { query: "hello" },
      scopeKey: "agent:test-agent",
      stepKey: "worker",
    },
  };
}

function integrationRuntimeContext(threadId: string) {
  const engine = new MemoryThreadEngine(initialHistory(threadId));
  return {
    engine,
    service: new ThreadService(engine),
    integrationName: "test.integration",
  };
}

class MemoryThreadEngine implements ThreadEngine, ThreadLeaseStore {
  private readonly threads = new Map<string, CreateThreadOptions & { rootThreadId: string }>();

  constructor(readonly events: ThreadEvent[] = []) {
    this.events = events.map((event, index) => ({ ...event, seq: event.seq ?? index }) as ThreadEvent);
    for (const event of events) {
      if (!this.threads.has(event.threadId)) {
        this.threads.set(event.threadId, { rootThreadId: event.threadId });
      }
    }
  }

  async createThread(threadId: string, options: CreateThreadOptions = {}): Promise<void> {
    if (this.threads.has(threadId)) {
      return;
    }

    this.threads.set(threadId, {
      ...options,
      rootThreadId: options.rootThreadId ?? threadId,
    });
  }

  async append(events: ThreadEvent[], _options: AppendOptions = {}): Promise<AppendResult> {
    const firstSeq = this.events.length;
    for (const event of events) {
      this.events.push({ ...event, seq: this.events.length } as ThreadEvent);
    }
    return { firstSeq, lastSeq: this.events.length - 1 };
  }

  async read(threadId: string, options: ReadOptions = {}): Promise<ThreadEvent[]> {
    const fromSeq = options.fromSeq ?? 0;
    const events = this.events.filter((event) => event.threadId === threadId && (event.seq ?? 0) >= fromSeq);
    return options.limit === undefined ? events : events.slice(0, options.limit);
  }

  async *follow(_threadId: string, _cursor: FollowCursor = {}): AsyncIterable<ThreadEvent> {}

  async getTail(): Promise<{ tailSeq: number; updatedAt: string }> {
    return { tailSeq: Math.max(0, this.events.length - 1), updatedAt: nowIso() };
  }

  async getProjection(threadId: string): Promise<ThreadProjection | null> {
    const thread = this.threads.get(threadId);
    if (!thread) {
      return null;
    }

    const threadEvents = this.events.filter((event) => event.threadId === threadId);
    const pendingGateIds = threadEvents
      .filter((event): event is Extract<ThreadEvent, { type: "gate.created" }> => event.type === "gate.created")
      .filter((gateCreated) => {
        return !threadEvents.some((event) => {
          return event.type === "gate.resolved" && event.payload.gateId === gateCreated.payload.gateId;
        });
      })
      .map((event) => event.payload.gateId);

    return ThreadProjectionSchema.parse({
      threadId,
      status: statusForEvents(threadEvents),
      tailSeq: threadEvents.length,
      activeLeaseOwnerId: null,
      pendingGateIds,
      parentThreadId: thread.parentThreadId ?? null,
      rootThreadId: thread.rootThreadId,
      parentScopeKey: thread.parentScopeKey ?? null,
      parentStepKey: thread.parentStepKey ?? null,
      updatedAt: nowIso(),
    });
  }

  async acquireLease(threadId: string, ownerId: string, ttlMs: number): Promise<Lease> {
    return {
      threadId,
      ownerId,
      token: `lease:${threadId}:${ownerId}`,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
  }

  async renewLease(threadId: string, token: string, ttlMs: number): Promise<Lease> {
    return {
      threadId,
      ownerId: "renewed",
      token,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
  }

  async releaseLease(): Promise<void> {}
}

function statusForEvents(events: readonly ThreadEvent[]): ThreadProjection["status"] {
  if (events.some((event) => event.type === "tool.failed" || event.type === "agent.failed")) {
    return "failed";
  }

  if (events.some((event) => event.type === "agent.response.produced")) {
    return "completed";
  }

  if (events.some((event) => event.type === "gate.created")) {
    return "blocked";
  }

  if (events.length > 0) {
    return "waiting";
  }

  return "idle";
}

await testDuplicatePrevention();
await testCapabilityMetadataDoesNotAffectToolPlanning();
await testPolicyAllowRecordsAuditAndRequestsTool();
await testPolicyDenyRecordsAuditAndFailsAgent();
await testPolicyApprovalRequiredCreatesGateThenRequestsTool();
await testPolicyApprovalDeniedFailsAgent();
await testPolicyEvaluationInputMismatch();
await testPolicyCapabilityDeclarationMismatch();
await testCapabilityRequestValidationPolicyAndCredentialResolution();
await testCapabilityRequestHashMismatch();
await testPolicyOrderingAllowThenDeny();
await testPolicyOrderingAllowThenApproval();
await testPolicyVersionAuditDoesNotBreakReplay();
await testPolicyEvaluationThrownErrorRecordsAgentFailure();
await testSleepSchedulesAndPendingReplayDoesNotDuplicate();
await testSleepFiredResumesAgent();
await testSleepTargetMismatch();
await testCompletedRunFirstAgentIsTerminal();
await testRunnerReadsFullReplayHistory();
await testDecodeFailure();
await testToolFailedReplayNoPlan();
await testParallelDurableEffectRejected();
await testMixedParallelDurableEffectRejected();
await testReplayMismatch();
await testEmitPayloadMismatch();
await testTypedEventFactoryAppendAndReplay();
await testTypedEventFactoryTypeMismatch();
await testTypedEventFactoryPayloadMismatch();
await testTypedEventFactorySchemaValidation();
await testContextIdStabilityAndUuidAlias();
await testRawEmitCompatibility();
await testTypedIntegrationEventHandlers();
await testEmitReplayDoesNotDuplicateEvent();
await testCheckpointReplay();
await testCheckpointMismatch();
await testDomainToolOutputReplay();
await testLegacyTopLevelToolCompletionCompatibility();
await testLegacyToolCompletionPlannerGateCompatibility();
await testLegacyEventsWithoutDurableIdentityRemainReadable();
await testInvalidAgentOutputRecordsFailure();
await testInvalidAgentInputRecordsFailure();
await testToolWorkerOutputSummaries();
await testToolWorkerEffectPathFailureParity();
await testGateReplay();
await testGatePayloadMismatch();
await testApprovalPolicyEvaluation();
await testTypedEventFactory();
await testChildThreadEventSchemas();
await testThreadProjectionLineageSchema();
await testStartChildSessionCreatesLineage();
await testNestedChildSessionPreservesRootLineage();
await testSpawnCreatesChildSession();
await testDetachedSpawnDoesNotBlockParentCompletion();
await testSpawnInputMismatch();
await testSpawnPromptMismatch();
await testSpawnMetadataMismatch();
await testJoinMirrorsCompletedChild();
await testChildTerminalMirroringIdempotency();
await testJoinValidatesStructuredChildOutput();
await testJoinRejectsInvalidStructuredChildOutput();
await testCancelChildRecordsTerminalFailure();
await testCancelChildThreadIdempotencyAndTerminalRejection();
await testJoinCancelledChild();
await testJoinFailedChild();
await testJoinRejectsUnrelatedChild();
await testListChildren();
await testContextChildren();
await testContextChildrenFilters();
await testRuntimePlannerDispatchesChildAgent();
await testRuntimePlannerFallsBackToDefaultAgent();
await testStartSessionAgentNameDispatchesRootSession();
await testApiCreateThreadAcceptsAgentName();
await testStartSessionIdempotencyMismatch();
await testUnknownRootSessionAgentRecordsFailure();
await testUnknownChildSessionAgentRecordsFailure();
await testRuntimeRegistersToolsFromAllAgents();
await testStartChildSessionIdempotency();
await testAgentFailureEvent();

console.log("Replay authoring tests passed");
