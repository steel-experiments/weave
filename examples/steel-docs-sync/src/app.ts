import { defineAgent, defineWeaveApp } from "weave";
import { DeterministicSteelDocsAgent } from "./agent.js";
import { steelTools } from "./tools.js";

export const steelDocsAgent = defineAgent({
  name: "steel-docs",
  description: "Deterministic Steel docs sync audit agent.",
  planner: new DeterministicSteelDocsAgent(),
  tools: steelTools,
});

export const steelDocsSyncApp = defineWeaveApp({
  name: "steel-docs-sync",
  agents: [steelDocsAgent],
});
