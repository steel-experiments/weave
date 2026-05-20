import type { PostgresMailboxEngine } from "./postgres-engine.js";
import { MailboxRunner } from "./runner.js";
import { MockAsyncToolWorker } from "./mock-tool-worker.js";

type ToolWorker = {
  processOnce(mailboxId: string): Promise<{ acted: boolean; eventType?: string }>;
};

export class RunnerDaemon {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly ownerId = `runner-inbox-${process.pid}`;

  constructor(
    private readonly engine: PostgresMailboxEngine,
    private readonly runner: MailboxRunner,
    private readonly intervalMs = 100,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const items = await this.engine.claimInbox("runner", this.ownerId, 20, 10_000);
      const byMailbox = groupByMailbox(items);

      for (const [mailboxId, mailboxItems] of byMailbox) {
        await this.runner.runOnce(mailboxId);
        await this.engine.completeInbox(
          mailboxItems.map((item) => item.id),
          this.ownerId,
        );
      }
    } finally {
      this.running = false;
    }
  }
}

export class ToolWorkerDaemon {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly ownerId = `tool-inbox-${process.pid}`;

  constructor(
    private readonly engine: PostgresMailboxEngine,
    private readonly worker: ToolWorker = new MockAsyncToolWorker(engine),
    private readonly intervalMs = 100,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const items = await this.engine.claimInbox("mock-tool-worker", this.ownerId, 20, 30_000);
      const byMailbox = groupByMailbox(items);

      for (const [mailboxId, mailboxItems] of byMailbox) {
        while (true) {
          const result = await this.worker.processOnce(mailboxId);
          if (!result.acted || result.eventType === "tool.completed" || result.eventType === "tool.failed") {
            break;
          }
          await sleep(25);
        }

        await this.engine.completeInbox(
          mailboxItems.map((item) => item.id),
          this.ownerId,
        );
      }
    } finally {
      this.running = false;
    }
  }
}

type MailboxWorkItem = { id: number; mailboxId: string };

function groupByMailbox<T extends MailboxWorkItem>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    const existing = grouped.get(item.mailboxId);
    if (existing) {
      existing.push(item);
      continue;
    }

    grouped.set(item.mailboxId, [item]);
  }

  return grouped;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
