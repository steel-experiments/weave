import { defineWeaveApp } from "weave";
import { steelDocsAgent } from "./agent.js";

export const steelDocsSyncApp = defineWeaveApp({
  name: "steel-docs-sync",
  agents: [steelDocsAgent],
});
