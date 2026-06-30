import assert from "node:assert/strict";
import { z } from "zod";
import type { AppendOptions, AppendResult, CreateThreadOptions, FollowCursor, ReadOptions, ThreadEngine } from "../contracts.js";
import { deterministicUuid, eventKey, nowIso, ThreadProjectionSchema, type ThreadEvent, type ThreadProjection } from "../events.js";
import { ContractToolWorker } from "../runtime/tool-worker.js";
import { tool } from "../runtime/tool-contract.js";

class MemoryThreadEngine implements ThreadEngine {
  private readonly threads = new Set<string>();

  constructor(private readonly events: ThreadEvent[] = []) {
    for (const event of events) {
      this.threads.add(event.threadId);
    }
    this.events = events.map((event, index) => ({ ...event, seq: event.seq ?? index }) as ThreadEvent);
  }

  async createThread(threadId: string, _options: CreateThreadOptions = {}): Promise<void> {
    this.threads.add(threadId);
  }

  async append(events: ThreadEvent[], _options: AppendOptions = {}): Promise<AppendResult> {
    const firstSeq = this.events.length;
    for (const event of events) {
      this.threads.add(event.threadId);
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

  async getTail(threadId: string): Promise<{ tailSeq: number; updatedAt: string }> {
    const events = await this.read(threadId);
    return { tailSeq: events.length, updatedAt: nowIso() };
  }

  async getProjection(threadId: string): Promise<ThreadProjection | null> {
    if (!this.threads.has(threadId)) {
      return null;
    }
    const events = await this.read(threadId);
    return ThreadProjectionSchema.parse({
      threadId,
      status: events.some((event) => event.type === "tool.failed") ? "failed" : "waiting",
      tailSeq: events.length,
      activeLeaseOwnerId: null,
      pendingGateIds: [],
      parentThreadId: null,
      rootThreadId: threadId,
      parentScopeKey: null,
      parentStepKey: null,
      updatedAt: nowIso(),
    });
  }
}

const threadId = "tool-worker-progress";
const release = deferred<void>();
const longTool = tool({
  name: "test.longTool",
  description: "Emits progress before completing.",
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
  async run(ctx) {
    await ctx.progress({ percent: 10, message: "started long work" });
    await release.promise;
    return { ok: true as const };
  },
});
const engine = new MemoryThreadEngine([
  {
    eventId: deterministicUuid("session", threadId),
    threadId,
    type: "session.started",
    occurredAt: nowIso(),
    actor: { type: "system", id: "test" },
    payload: { source: "test", agentName: "test-agent" },
  },
  {
    eventId: eventKey(threadId, "tool.requested", "long"),
    threadId,
    type: "tool.requested",
    occurredAt: nowIso(),
    scopeKey: "agent:test-agent",
    stepKey: "long",
    actor: { type: "agent", id: "test-agent" },
    payload: {
      toolCallId: deterministicUuid("tool-call", threadId, "long"),
      toolName: longTool.name,
      args: {},
      scopeKey: "agent:test-agent",
      stepKey: "long",
    },
  },
]);
const worker = new ContractToolWorker(engine, [longTool], "progress-worker");

assert.equal((await worker.processOnce(threadId)).eventType, "tool.started");
const running = worker.processOnce(threadId);
await waitForEvent(engine, threadId, "tool.progress");
let events = await engine.read(threadId);
assert.equal(events.some((event) => event.type === "tool.progress"), true);
assert.equal(events.some((event) => event.type === "tool.completed"), false);

release.resolve();
assert.equal((await running).eventType, "tool.completed");
events = await engine.read(threadId);
assert.equal(events.some((event) => event.type === "tool.completed"), true);

console.log("Tool worker progress tests passed");

async function waitForEvent(engine: MemoryThreadEngine, threadId: string, type: ThreadEvent["type"]): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const events = await engine.read(threadId);
    if (events.some((event) => event.type === type)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${type}`);
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
