import type { PostgresThreadEngine } from "./postgres-engine.js";
import { ThreadRunner } from "./runner.js";
import { MockAsyncToolWorker } from "./mock-tool-worker.js";
import type { InboxConsumer } from "./contracts.js";

type ToolWorker = {
  processOnce(threadId: string): Promise<{ acted: boolean; eventType?: string; errorCode?: string; errorMessage?: string }>;
};

export class RunnerDaemon {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly ownerId = `runner-inbox-${process.pid}`;

  constructor(
    private readonly engine: PostgresThreadEngine,
    private readonly runner: ThreadRunner,
    private readonly intervalMs = 100,
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    while (this.running) {
      await sleep(10);
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const items = await this.engine.claimInbox("runner", this.ownerId, 20, 10_000);
      const byThread = groupByThread(items);

      for (const [threadId, threadItems] of byThread) {
        await this.runner.runOnce(threadId);
        await this.engine.completeInbox(
          threadItems.map((item) => item.id),
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
    private readonly engine: PostgresThreadEngine,
    private readonly worker: ToolWorker = new MockAsyncToolWorker(engine),
    private readonly intervalMs = 100,
    private readonly consumer: InboxConsumer = "tool-worker",
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    while (this.running) {
      await sleep(10);
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    try {
      const items = await this.engine.claimInbox(this.consumer, this.ownerId, 20, 30_000);
      const byThread = groupByThread(items);

      for (const [threadId, threadItems] of byThread) {
        let lastResult: Awaited<ReturnType<ToolWorker["processOnce"]>> = { acted: false };
        while (true) {
          const result = await this.worker.processOnce(threadId);
          lastResult = result;
          if (!result.acted || result.eventType === "tool.completed" || result.eventType === "tool.failed") {
            break;
          }
          await sleep(25);
        }

        if (lastResult.eventType === "tool.failed") {
          await this.engine.deadLetterInbox(
            threadItems.map((item) => item.id),
            this.ownerId,
            lastResult.errorCode,
            lastResult.errorMessage,
          );
        } else {
          await this.engine.completeInbox(
            threadItems.map((item) => item.id),
            this.ownerId,
          );
        }
      }
    } finally {
      this.running = false;
    }
  }
}

type ThreadWorkItem = { id: number; threadId: string };

function groupByThread<T extends ThreadWorkItem>(items: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const item of items) {
    const existing = grouped.get(item.threadId);
    if (existing) {
      existing.push(item);
      continue;
    }

    grouped.set(item.threadId, [item]);
  }

  return grouped;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
