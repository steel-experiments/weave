import type { WeaveAppDefinition } from "./app-contract.js";
import { createAgentPlanner } from "./agent-runner.js";
import { RunnerDaemon, ToolWorkerDaemon } from "./daemons.js";
import type { ThreadService } from "./thread-service.js";
import type { PostgresThreadEngine } from "./postgres-engine.js";
import { ThreadRunner } from "./runner.js";
import { ContractToolWorker } from "./tool-worker.js";
import { collectIntegrationTools } from "./integration-contract.js";
import type { AgentPlanner } from "./runner.js";
import type { ThreadEvent } from "./events.js";
import type { AnyToolContract } from "./tool-contract.js";
import type { AnyAgentContract } from "./agent-contract.js";
import { WeaveError } from "./errors.js";

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
  const tools = collectRuntimeTools(options.app);
  const runner = new ThreadRunner(
    options.engine,
    options.engine,
    createRuntimeAgentPlanner(options.app, String(options.agentName), options.service),
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

export function createRuntimeAgentPlanner(
  app: WeaveAppDefinition<any>,
  defaultAgentName: string,
  service: ThreadService,
): AgentPlanner {
  const planners = new Map<string, AgentPlanner>();

  return {
    plan(threadId, events) {
      const agentName = threadAgentName(events) ?? defaultAgentName;
      let planner = planners.get(agentName);
      if (!planner) {
        const agent = findRuntimeAgent(app, agentName);
        planner = createAgentPlanner(agent, agentName, { service });
        planners.set(agentName, planner);
      }

      return planner.plan(threadId, events);
    },
  };
}

function findRuntimeAgent(app: WeaveAppDefinition<any>, agentName: string): AnyAgentContract {
  const agent = app.agents.find((candidate: AnyAgentContract) => candidate.name === agentName);
  if (!agent) {
    throw new WeaveError("AGENT_NOT_FOUND", `Agent not found in Weave app: ${agentName}`, { agentName });
  }

  return agent;
}

function threadAgentName(events: readonly ThreadEvent[]): string | undefined {
  const sessionStarted = events.find((event) => event.type === "session.started");
  return sessionStarted?.payload.agentName;
}

function collectRuntimeTools(app: WeaveAppDefinition<any>): readonly AnyToolContract[] {
  const tools = [
    ...(app.tools ?? []),
    ...app.agents.flatMap((agent: AnyAgentContract) => agent.tools ?? []),
    ...collectIntegrationTools(app.integrations),
  ];
  const seen = new Set<string>();
  return tools.filter((tool) => {
    if (seen.has(tool.name)) {
      return false;
    }
    seen.add(tool.name);
    return true;
  });
}
