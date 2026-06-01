import assert from "node:assert/strict";
import { z } from "zod";
import { agent } from "../agent-contract.js";
import { createAgentPlanner } from "../agent-runner.js";
import { ReplayMismatchError } from "../errors.js";
import {
  deterministicUuid,
  eventKey,
  nowIso,
  type ThreadEvent,
} from "../events.js";
import { tool } from "../tool-contract.js";

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

await testDuplicatePrevention();
await testDecodeFailure();
await testReplayMismatch();
await testEmitPayloadMismatch();

console.log("Replay authoring tests passed");

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
      await ctx.emit("final", {
        type: "agent.finding.produced",
        payload: {
          findingId: ctx.uuid("final"),
          severity: "warning",
          summary: "new message",
          evidence: [{ source: "test", summary: "evidence" }],
        },
      });
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
