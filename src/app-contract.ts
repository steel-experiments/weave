import type { AgentContract } from "./agent-contract.js";
import type { ThreadArtifactStore } from "./artifacts.js";
import type { CredentialProvider } from "./credentials.js";
import type { ObservabilitySink } from "./observability.js";

export type WeaveAppDefinition<Agents extends readonly AgentContract[] = readonly AgentContract[]> = {
  name?: string;
  agents: Agents;
  credentialProvider?: CredentialProvider;
  artifactStore?: ThreadArtifactStore;
  observability?: ObservabilitySink;
};

export function defineWeaveApp<const Agents extends readonly AgentContract[]>(
  definition: WeaveAppDefinition<Agents>,
): WeaveAppDefinition<Agents> {
  return definition;
}

export function getAgent<Agents extends readonly AgentContract[]>(
  app: WeaveAppDefinition<Agents>,
  name: Agents[number]["name"],
): Agents[number] {
  const agent = app.agents.find((candidate) => candidate.name === name);
  if (!agent) {
    throw new Error(`Agent not found in Weave app: ${name}`);
  }
  return agent;
}

// Hallmark: intentionally no defineThread() yet. A thread is runtime session state until we have a concrete authoring need.
