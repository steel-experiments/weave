import type { MailboxAppDefinition } from "./app-contract.js";
import { getAgent } from "./app-contract.js";
import { RunnerDaemon, ToolWorkerDaemon } from "./daemons.js";
import type { MailboxService } from "./mailbox-service.js";
import type { PostgresMailboxEngine } from "./postgres-engine.js";
import { MailboxRunner } from "./runner.js";
import { ContractToolWorker } from "./tool-worker.js";

export type MailboxRuntimeOptions<Agents extends readonly { name: string }[] = readonly { name: string }[]> = {
  app: MailboxAppDefinition<any>;
  agentName: Agents[number]["name"] | string;
  engine: PostgresMailboxEngine;
  service: MailboxService;
  intervalMs?: number;
  runnerOwnerId?: string;
  toolWorkerId?: string;
};

export type MailboxRuntime = {
  runner: MailboxRunner;
  toolWorker: ContractToolWorker;
  runnerDaemon: RunnerDaemon;
  toolDaemon: ToolWorkerDaemon;
};

export function createMailboxRuntime(options: MailboxRuntimeOptions): MailboxRuntime {
  const activeAgent = getAgent(options.app, options.agentName as never);
  const runner = new MailboxRunner(
    options.engine,
    options.engine,
    activeAgent.planner,
    options.runnerOwnerId,
    options.app.observability,
  );
  const toolWorker = new ContractToolWorker(
    options.engine,
    activeAgent.tools,
    options.toolWorkerId,
    options.app.credentialProvider,
    options.app.observability,
    options.app.artifactStore,
  );

  return {
    runner,
    toolWorker,
    runnerDaemon: new RunnerDaemon(options.engine, runner, options.intervalMs),
    toolDaemon: new ToolWorkerDaemon(options.engine, toolWorker, options.intervalMs),
  };
}
