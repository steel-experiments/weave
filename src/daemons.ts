import type { PostgresMailboxEngine } from "./postgres-engine.js";
import { MailboxRunner } from "./runner.js";
import { MockAsyncToolWorker } from "./mock-tool-worker.js";

export class RunnerDaemon {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

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
      const mailboxIds = await this.engine.listRunnerCandidateMailboxIds(20);
      for (const mailboxId of mailboxIds) {
        await this.runner.runOnce(mailboxId);
      }
    } finally {
      this.running = false;
    }
  }
}

export class ToolWorkerDaemon {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly engine: PostgresMailboxEngine,
    private readonly worker: MockAsyncToolWorker,
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
      const mailboxIds = await this.engine.listToolCandidateMailboxIds(20);
      for (const mailboxId of mailboxIds) {
        await this.worker.processOnce(mailboxId);
      }
    } finally {
      this.running = false;
    }
  }
}
