import assert from "node:assert/strict";
import { z } from "zod";
import { agent, event } from "../agent-contract.js";
import { createAgentPlanner } from "../agent-runner.js";
import type { AppendOptions, AppendResult, FollowCursor, Lease, ReadOptions, ThreadEngine, ThreadLeaseStore } from "../contracts.js";
import { ReplayMismatchError } from "../errors.js";
import {
  deterministicUuid,
  eventKey,
  nowIso,
  type ThreadProjection,
  type ThreadEvent,
} from "../events.js";
import { approvalPolicy } from "../policy-contract.js";
import { ThreadRunner } from "../runner.js";
import { tool, type AnyToolContract } from "../tool-contract.js";
import { ContractToolWorker } from "../tool-worker.js";

const inputSchema = z.object({ query: z.string().min(1) });
const outputSchema = z.object({
  summary: z.string().min(1),
  requiresManualApproval: z.literal(false),
  data: z.object({ result: z.string().min(1) }),
});

const lookupTool = tool({
  name: "test.lookup",
  description: "Test lookup tool.",
  input: inputSchema,
  output: outputSchema,
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
  const threadId = `worker-${toolName}`;
  const request = requestedEventForTool(threadId, toolName);
  const engine = new MemoryThreadEngine([request]);
  const worker = new ContractToolWorker(engine, [toolContract]);

  assert.equal((await worker.processOnce(threadId)).eventType, "tool.started");
  assert.equal((await worker.processOnce(threadId)).eventType, "tool.completed");

  const completion = engine.events.find((event): event is Extract<ThreadEvent, { type: "tool.completed" }> => {
    return event.type === "tool.completed";
  });
  assert(completion);
  return completion;
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

class MemoryThreadEngine implements ThreadEngine, ThreadLeaseStore {
  constructor(readonly events: ThreadEvent[] = []) {}

  async createThread(): Promise<void> {}

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

  async getProjection(): Promise<ThreadProjection | null> {
    return null;
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

await testDuplicatePrevention();
await testDecodeFailure();
await testToolFailedReplayNoPlan();
await testReplayMismatch();
await testEmitPayloadMismatch();
await testCheckpointReplay();
await testCheckpointMismatch();
await testDomainToolOutputReplay();
await testToolWorkerOutputSummaries();
await testGateReplay();
await testGatePayloadMismatch();
await testApprovalPolicyEvaluation();
await testTypedEventFactory();
await testAgentFailureEvent();

console.log("Replay authoring tests passed");
