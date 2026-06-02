import type { WeaveAppDefinition } from "./app-contract.js";
import { getAgent } from "./app-contract.js";
import { createAgentPlanner } from "./agent-runner.js";
import { RunnerDaemon, ToolWorkerDaemon } from "./daemons.js";
import type { ThreadService } from "./thread-service.js";
import type { PostgresThreadEngine } from "./postgres-engine.js";
import { ThreadRunner } from "./runner.js";
import { ContractToolWorker } from "./tool-worker.js";
import { collectIntegrationTools } from "./integration-contract.js";

export type WeaveRuntimeOptions<Agents extends readonly { name: string }[] = readonly { name: string }[]> = {
  app: WeaveAppDefinition<any>;
  agentName: Agents[number]["name"] | string;
  engine: PostgresThreadEngine;
  service: ThreadService;
  intervalMs?: number;
  runnerOwnerId?: string;
  toolWorkerId?: string;
};

export type WeaveRuntime = {
  runner: ThreadRunner;
  toolWorker: ContractToolWorker;
  runnerDaemon: RunnerDaemon;
  toolDaemon: ToolWorkerDaemon;
};

export function createWeaveRuntime(options: WeaveRuntimeOptions): WeaveRuntime {
  const activeAgent = getAgent(options.app, options.agentName as never);
  const tools = [
    ...(options.app.tools ?? []),
    ...(activeAgent.tools ?? []),
    ...collectIntegrationTools(options.app.integrations),
  ];
  const runner = new ThreadRunner(
    options.engine,
    options.engine,
    createAgentPlanner(activeAgent, String(options.agentName), { service: options.service }),
    options.runnerOwnerId,
    options.app.observability,
  );
  const toolWorker = new ContractToolWorker(
    options.engine,
    tools,
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
