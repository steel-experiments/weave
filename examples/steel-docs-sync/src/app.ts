import { weave } from "weave/runtime";
import { steelDocsAgent } from "./agent.js";

export const steelDocsSyncApp = weave({
  name: "steel-docs-sync",
  agents: [steelDocsAgent],
});
