import type { ThreadEngine, ThreadLeaseStore } from "./contracts.js";
import { eventKey, nowIso, type ThreadEvent } from "./events.js";
import { WeaveError } from "./errors.js";
import { DeterministicMockAgent } from "./mock-agent.js";
import {
  NoopObservabilitySink,
  elapsedMs,
  newSpanId,
  newTraceId,
  safeEmitLog,
  safeEmitSpan,
  type ObservabilitySink,
} from "./observability.js";
import type { MaybePromise } from "./types.js";

export type RunnerStepResult = {
  acted: boolean;
  appendedEvents: number;
  reason?: string;
};

export type AgentPlan = {
  resumeReason: "new-prompt" | "tool-completed" | "gate-resolved" | "child-spawned";
  events: ThreadEvent[];
};

export type AgentPlanner = {
  plan(threadId: string, events: ThreadEvent[]): MaybePromise<AgentPlan | null>;
};

export class ThreadRunner {
  constructor(
    private readonly engine: ThreadEngine,
    private readonly leases: ThreadLeaseStore,
    private readonly agent: AgentPlanner = new DeterministicMockAgent(),
    private readonly ownerId = `runner-${process.pid}`,
    private readonly observability: ObservabilitySink = new NoopObservabilitySink(),
  ) {}

  async runOnce(threadId: string): Promise<RunnerStepResult> {
    const context = { traceId: newTraceId(), spanId: newSpanId(), threadId };
    const startedAt = new Date();
    const lease = await this.leases.acquireLease(threadId, this.ownerId, 10_000);
    if (!lease) {
      await safeEmitLog(this.observability, {
        ...context,
        timestamp: nowIso(),
        level: "debug",
        message: "Runner lease unavailable",
        attributes: { ownerId: this.ownerId },
      });
      await this.emitRunnerSpan(context, startedAt, "ok", { acted: false, reason: "lease-unavailable" });
      return { acted: false, appendedEvents: 0, reason: "lease-unavailable" };
    }

    try {
      const history = await this.engine.read(threadId);
      const planStartedAt = new Date();
      let plan: AgentPlan | null;
      try {
        plan = await this.agent.plan(threadId, history);
        await safeEmitSpan(this.observability, {
          ...context,
          spanId: newSpanId(),
          parentSpanId: context.spanId,
          name: "agent.plan",
          kind: "internal",
          status: "ok",
          startedAt: planStartedAt.toISOString(),
          endedAt: nowIso(),
          durationMs: elapsedMs(planStartedAt),
          attributes: { eventCount: history.length, planned: plan !== null, resumeReason: plan?.resumeReason },
        });
      } catch (error) {
        await safeEmitSpan(this.observability, {
          ...context,
          spanId: newSpanId(),
          parentSpanId: context.spanId,
          name: "agent.plan",
          kind: "internal",
          status: "error",
          startedAt: planStartedAt.toISOString(),
          endedAt: nowIso(),
          durationMs: elapsedMs(planStartedAt),
          attributes: { eventCount: history.length, error: errorMessage(error) },
        });
        const failed = agentFailedEvent(threadId, history, this.ownerId, error);
        await this.engine.append([failed]);
        await safeEmitLog(this.observability, {
          ...context,
          timestamp: nowIso(),
          level: "error",
          message: "Agent failed",
          attributes: { errorCode: failed.payload.errorCode, error: failed.payload.message },
        });
        await this.emitRunnerSpan(context, startedAt, "ok", {
          acted: true,
          reason: "agent-failed",
          appendedEvents: 1,
        });
        return { acted: true, appendedEvents: 1, reason: "agent-failed" };
      }
      if (!plan) {
        await safeEmitLog(this.observability, {
          ...context,
          timestamp: nowIso(),
          level: "debug",
          message: "Runner found no plan",
          attributes: { eventCount: history.length },
        });
        await this.emitRunnerSpan(context, startedAt, "ok", { acted: false, reason: "no-plan", eventCount: history.length });
        return { acted: false, appendedEvents: 0, reason: "no-plan" };
      }

      const causationId = newestEvent(history)?.eventId;
      const runnerResumed: ThreadEvent = {
        eventId: eventKey(threadId, "runner.resumed", `${plan.resumeReason}:${causationId ?? history.length}`),
        threadId,
        type: "runner.resumed",
        occurredAt: nowIso(),
        correlationId: newestEvent(history)?.correlationId,
        causationId,
        actor: { type: "system", id: this.ownerId },
        payload: { reason: plan.resumeReason },
      };

      await this.engine.append([runnerResumed, ...plan.events]);
      await safeEmitLog(this.observability, {
        ...context,
        timestamp: nowIso(),
        level: "info",
        message: "Runner appended plan events",
        attributes: { resumeReason: plan.resumeReason, appendedEvents: plan.events.length + 1 },
      });
      await this.emitRunnerSpan(context, startedAt, "ok", {
        acted: true,
        resumeReason: plan.resumeReason,
        appendedEvents: plan.events.length + 1,
      });
      return { acted: true, appendedEvents: plan.events.length + 1, reason: plan.resumeReason };
    } catch (error) {
      await safeEmitLog(this.observability, {
        ...context,
        timestamp: nowIso(),
        level: "error",
        message: "Runner failed",
        attributes: { error: errorMessage(error) },
      });
      await this.emitRunnerSpan(context, startedAt, "error", { error: errorMessage(error) });
      throw error;
    } finally {
      await this.leases.releaseLease(threadId, lease.token);
    }
  }

  private async emitRunnerSpan(
    context: { traceId: string; spanId: string; threadId: string },
    startedAt: Date,
    status: "ok" | "error",
    attributes: Record<string, unknown>,
  ): Promise<void> {
    await safeEmitSpan(this.observability, {
      ...context,
      name: "runner.runOnce",
      kind: "internal",
      status,
      startedAt: startedAt.toISOString(),
      endedAt: nowIso(),
      durationMs: elapsedMs(startedAt),
      attributes,
    });
  }
}

function newestEvent(events: ThreadEvent[]): ThreadEvent | undefined {
  return events.at(-1);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  return error instanceof WeaveError ? error.code : "AGENT_FAILED";
}

function agentFailedEvent(
  threadId: string,
  history: ThreadEvent[],
  ownerId: string,
  error: unknown,
): Extract<ThreadEvent, { type: "agent.failed" }> {
  const cause = newestEvent(history);
  const code = errorCode(error);
  return {
    eventId: eventKey(threadId, "agent.failed", `${code}:${cause?.eventId ?? history.length}`),
    threadId,
    type: "agent.failed",
    occurredAt: nowIso(),
    correlationId: cause?.correlationId,
    causationId: cause?.eventId,
    actor: { type: "system", id: ownerId },
    payload: {
      errorCode: code,
      message: errorMessage(error),
    },
  };
}
