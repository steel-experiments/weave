import { weave } from "weave";
import { steelDocsAgent } from "./agent.js";

export const steelDocsSyncApp = weave({
  name: "steel-docs-sync",
  agents: [steelDocsAgent],
});
