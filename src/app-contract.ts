import type { AnyAgentContract } from "./agent-contract.js";
import type { ThreadArtifactStore } from "./artifacts.js";
import type { CredentialProvider } from "./credentials.js";
import type { AnyIntegrationContract } from "./integration-contract.js";
import type { ObservabilitySink } from "./observability.js";
import type { AnyToolContract } from "./tool-contract.js";

export type WeaveAppDefinition<
  Agents extends readonly AnyAgentContract[] = readonly AnyAgentContract[],
  Integrations extends readonly AnyIntegrationContract[] = readonly AnyIntegrationContract[],
> = {
  name?: string;
  agents: Agents;
  tools?: readonly AnyToolContract[];
  integrations?: Integrations;
  credentialProvider?: CredentialProvider;
  artifactStore?: ThreadArtifactStore;
  observability?: ObservabilitySink;
};

export function defineWeaveApp<
  const Agents extends readonly AnyAgentContract[],
  const Integrations extends readonly AnyIntegrationContract[] = readonly AnyIntegrationContract[],
>(definition: WeaveAppDefinition<Agents, Integrations>): WeaveAppDefinition<Agents, Integrations> {
  return definition;
}

export const weave = defineWeaveApp;

export function getAgent<Agents extends readonly AnyAgentContract[]>(
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
