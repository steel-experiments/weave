import type { PostgresThreadEngine } from "./postgres-engine.js";
import { ThreadRunner } from "./runner.js";
import { MockAsyncToolWorker } from "./mock-tool-worker.js";
import type { InboxConsumer } from "./contracts.js";

type ToolWorker = {
  processOnce(threadId: string): Promise<{ acted: boolean; eventType?: string; errorCode?: string; errorMessage?: string }>;
};

const RUNNER_CLAIM_TTL_MS = 10_000;
const TOOL_CLAIM_TTL_MS = 30_000;

export class RunnerDaemon {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly ownerId = `runner-inbox-${process.pid}`;

  constructor(
    private readonly engine: PostgresThreadEngine,
    private readonly runner: ThreadRunner,
    private readonly intervalMs = 100,
    private readonly maxRunsPerThread = 20,
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
      const items = await this.engine.claimInbox("runner", this.ownerId, 20, RUNNER_CLAIM_TTL_MS);
      const stopHeartbeat = startHeartbeat(
        this.engine,
        items.map((item) => item.id),
        this.ownerId,
        RUNNER_CLAIM_TTL_MS,
      );
      try {
        const byThread = groupByThread(items);

        for (const [threadId, threadItems] of byThread) {
          await runThreadUntilIdle(this.runner, threadId, this.maxRunsPerThread);
          await wakeParentIfTerminal(this.engine, this.runner, threadId, this.maxRunsPerThread);
          await this.engine.completeInbox(
            threadItems.map((item) => item.id),
            this.ownerId,
          );
        }
      } finally {
        stopHeartbeat();
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
    private readonly parentRunner?: ThreadRunner,
    private readonly maxParentRuns = 20,
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
      const items = await this.engine.claimInbox(this.consumer, this.ownerId, 20, TOOL_CLAIM_TTL_MS);
      const stopHeartbeat = startHeartbeat(
        this.engine,
        items.map((item) => item.id),
        this.ownerId,
        TOOL_CLAIM_TTL_MS,
      );
      try {
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
            if (this.parentRunner) {
              await wakeParentIfTerminal(this.engine, this.parentRunner, threadId, this.maxParentRuns);
            }
            await this.engine.deadLetterInbox(
              threadItems.map((item) => item.id),
              this.ownerId,
              lastResult.errorCode,
              lastResult.errorMessage,
            );
          } else {
            if (this.parentRunner) {
              await wakeParentIfTerminal(this.engine, this.parentRunner, threadId, this.maxParentRuns);
            }
            await this.engine.completeInbox(
              threadItems.map((item) => item.id),
              this.ownerId,
            );
          }
        }
      } finally {
        stopHeartbeat();
      }
    } finally {
      this.running = false;
    }
  }
}

async function runThreadUntilIdle(runner: ThreadRunner, threadId: string, maxRuns: number): Promise<void> {
  for (let count = 0; count < maxRuns; count += 1) {
    const result = await runner.runOnce(threadId);
    if (!result.acted) {
      return;
    }
  }
}

async function wakeParentIfTerminal(
  engine: PostgresThreadEngine,
  runner: ThreadRunner,
  threadId: string,
  maxRuns: number,
): Promise<void> {
  const projection = await engine.getProjection(threadId);
  if (!projection?.parentThreadId || (projection.status !== "completed" && projection.status !== "failed")) {
    return;
  }

  await runThreadUntilIdle(runner, projection.parentThreadId, maxRuns);
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

function startHeartbeat(
  engine: PostgresThreadEngine,
  ids: number[],
  ownerId: string,
  ttlMs: number,
): () => void {
  if (ids.length === 0) {
    return () => {};
  }

  const period = Math.max(1_000, Math.floor(ttlMs / 3));
  const timer = setInterval(() => {
    void engine.heartbeatInbox(ids, ownerId, ttlMs).catch(() => {});
  }, period);

  return () => clearInterval(timer);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
