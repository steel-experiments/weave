import type { AgentPlanner } from "./runner.js";
import type { AnyToolContract } from "./tool-contract.js";

export type AgentContract<
  Name extends string = string,
  Tools extends readonly AnyToolContract[] = readonly AnyToolContract[],
> = {
  name: Name;
  description?: string;
  planner: AgentPlanner;
  tools: Tools;
};

export function defineAgent<
  const Name extends string,
  const Tools extends readonly AnyToolContract[],
>(contract: AgentContract<Name, Tools>): AgentContract<Name, Tools> {
  return contract;
}

export type AgentToolName<Agent extends AgentContract> = Agent["tools"][number]["name"];
