import type { AgentContract } from "./agent-contract.js";
import type { CredentialProvider } from "./credentials.js";
import type { ObservabilitySink } from "./observability.js";

export type MailboxAppDefinition<Agents extends readonly AgentContract[] = readonly AgentContract[]> = {
  name?: string;
  agents: Agents;
  credentialProvider?: CredentialProvider;
  observability?: ObservabilitySink;
};

export function defineMailboxApp<const Agents extends readonly AgentContract[]>(
  definition: MailboxAppDefinition<Agents>,
): MailboxAppDefinition<Agents> {
  return definition;
}

export function getAgent<Agents extends readonly AgentContract[]>(
  app: MailboxAppDefinition<Agents>,
  name: Agents[number]["name"],
): Agents[number] {
  const agent = app.agents.find((candidate) => candidate.name === name);
  if (!agent) {
    throw new Error(`Agent not found in mailbox app: ${name}`);
  }
  return agent;
}

// Hallmark: intentionally no defineMailbox() yet. A mailbox is runtime session state until we have a concrete authoring need.
