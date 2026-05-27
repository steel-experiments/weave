import { defineAgent, defineMailboxApp } from "@agent-mailbox/core";
import { DeterministicSteelDocsAgent } from "./agent.js";
import { steelTools } from "./tools.js";

export const steelDocsAgent = defineAgent({
  name: "steel-docs",
  description: "Deterministic Steel docs sync audit agent.",
  planner: new DeterministicSteelDocsAgent(),
  tools: steelTools,
});

export const steelDocsSyncApp = defineMailboxApp({
  name: "steel-docs-sync",
  agents: [steelDocsAgent],
});
