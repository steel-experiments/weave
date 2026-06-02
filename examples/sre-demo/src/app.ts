import { StaticCredentialProvider, weave } from "weave";
import { sreAgent } from "./agent.js";

export const sreDemoApp = weave({
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
