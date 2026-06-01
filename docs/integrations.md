# Integrations

Integrations are import-composed TypeScript modules that package external-system behavior for a Weave app.

The goal is that a Slack, Linear, GitHub, or email module can be developed outside core. An app imports the module, passes config, and adds the returned integration to `weave(...)`.

## Contract

An integration can contribute three things:

- ingress routes that turn external webhooks or OAuth callbacks into thread operations
- tools that agents can request through the normal tool worker path
- event handlers that react to thread events and call the external system

```ts
import { integration } from "weave";

export function createSlackIntegration(config: SlackIntegrationConfig) {
  return integration({
    name: "slack",
    tools: [postSlackMessageTool(config)],
    createRoutes: ({ service }) => [createSlackEventsRoute(service, config)],
    eventHandlers: [slackNotificationHandler(config)],
  });
}
```

## App Usage

```ts
import { agent, weave } from "weave";
import { createSlackIntegration } from "@acme/weave-slack";
import { supportRun } from "./agent.js";

const slack = createSlackIntegration({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  botTokenCredentialName: "slack-bot-token",
});

export const supportAgent = agent({
  name: "support-agent",
  async run(ctx, input) {
    return supportRun(ctx, input);
  },
  tools: [],
});

export const app = weave({
  name: "support",
  agents: [supportAgent],
  integrations: [slack],
});
```

Integration tools are made available to the app runtime alongside the active agent's own tools. Ingress routes are mounted by `createApiServer` when the app is passed in server options.

```ts
createApiServer(engine, service, { app });
createWeaveRuntime({ app, agentName: "support-agent", engine, service });
```

## Slack Adapter Shape

A Slack integration should own Slack-specific translation, not thread execution policy.

It should translate inbound Slack events into `service.startSession(...)` calls with stable idempotency keys such as `slack:event:<event_id>` or `slack:message:<channel>:<ts>`.

It should expose Slack side effects as normal tools, for example:

- `slack.post_message`
- `slack.update_message`
- `slack.add_reaction`

It should use Weave credentials rather than reading tokens inside the agent planner. The integration config can name the credential, while the tool declares the credential request.

## Boundary Rules

- Integrations should cross the thread boundary through explicit thread events and tools.
- Ingress routes should validate external signatures before starting or mutating threads.
- Tools should perform external side effects; agents should request them through durable `ctx.tool` calls.
- Integration modules should keep third-party SDK dependencies outside Weave core.
- App inclusion grants the integration's tools to the app runtime, so only include integrations that are allowed for that app's agents.

## Deferred Work

The contract includes event handlers as the outbound hook shape, but core still needs an integration dispatcher or inbox consumer before outbound event reactions run automatically in a daemon.
