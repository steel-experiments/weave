import type { MailboxEngine, MailboxLeaseStore } from "./contracts.js";
import { eventKey, nowIso, type MailboxEvent } from "./events.js";
import { DeterministicMockAgent } from "./mock-agent.js";

export type RunnerStepResult = {
  acted: boolean;
  appendedEvents: number;
  reason?: string;
};

export type AgentPlan = {
  resumeReason: "new-prompt" | "tool-completed" | "gate-resolved";
  events: MailboxEvent[];
};

export type AgentPlanner = {
  plan(mailboxId: string, events: MailboxEvent[]): AgentPlan | null;
};

export class MailboxRunner {
  constructor(
    private readonly engine: MailboxEngine,
    private readonly leases: MailboxLeaseStore,
    private readonly agent: AgentPlanner = new DeterministicMockAgent(),
    private readonly ownerId = `runner-${process.pid}`,
  ) {}

  async runOnce(mailboxId: string): Promise<RunnerStepResult> {
    const lease = await this.leases.acquireLease(mailboxId, this.ownerId, 10_000);
    if (!lease) {
      return { acted: false, appendedEvents: 0, reason: "lease-unavailable" };
    }

    try {
      const history = await this.engine.read(mailboxId);
      const plan = this.agent.plan(mailboxId, history);
      if (!plan) {
        return { acted: false, appendedEvents: 0, reason: "no-plan" };
      }

      const causationId = newestEvent(history)?.eventId;
      const runnerResumed: MailboxEvent = {
        eventId: eventKey(mailboxId, "runner.resumed", `${plan.resumeReason}:${causationId ?? history.length}`),
        mailboxId,
        type: "runner.resumed",
        occurredAt: nowIso(),
        correlationId: newestEvent(history)?.correlationId,
        causationId,
        actor: { type: "system", id: this.ownerId },
        payload: { reason: plan.resumeReason },
      };

      await this.engine.append([runnerResumed, ...plan.events]);
      return { acted: true, appendedEvents: plan.events.length + 1, reason: plan.resumeReason };
    } finally {
      await this.leases.releaseLease(mailboxId, lease.token);
    }
  }
}

function newestEvent(events: MailboxEvent[]): MailboxEvent | undefined {
  return events.at(-1);
}
