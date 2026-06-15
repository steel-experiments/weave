import { weave, type ThreadArtifactStore } from "weave";
import { createBladeReviewAgent } from "./agent.js";
import { createBladeReviewTools, createFakeBladeGitHubClient, type BladeGitHubClient } from "./tools.js";

export type BladeAppOptions = {
  githubClient?: BladeGitHubClient;
  artifactStore?: ThreadArtifactStore;
};

export function createBladeApp(options: BladeAppOptions = {}) {
  const tools = createBladeReviewTools(options.githubClient ?? createFakeBladeGitHubClient());
  const reviewAgent = createBladeReviewAgent(tools);
  return weave({
    name: "blade",
    agents: [reviewAgent],
    tools: tools.all,
    artifactStore: options.artifactStore,
  });
}

export const bladeApp = createBladeApp();
