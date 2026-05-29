import { StaticCredentialProvider, defineAgent, defineWeaveApp } from "weave";
import { DeterministicSreAgent } from "./agent.js";
import { sreTools } from "./tools.js";

export const sreAgent = defineAgent({
  name: "sre",
  description: "Deterministic SRE agent for the north-star incident demo.",
  planner: new DeterministicSreAgent(),
  tools: sreTools,
});

export const sreDemoApp = defineWeaveApp({
  name: "sre-demo",
  agents: [sreAgent],
  credentialProvider: new StaticCredentialProvider(
    {
      "axiom.production": "mock-axiom-token",
      "grafana.production": "mock-grafana-token",
      "sentry.production": "mock-sentry-token",
      "deploy.production": "mock-deploy-token",
      "infra.production": "mock-delegated-remediation-token",
    },
    "mock-credential-store",
  ),
});
