# Authenticated Integration Ingress

## Status

- Vertical: `weave-core`
- Status: `Proposed`
- Last updated: `2026-06-03`
- Owner: `weave-core`

## Goal

Let integration ingress routes use the same auth gateway model as the HTTP API, starting with a Slack-shaped integration test path.

## User Outcome

As an integration author, I can authenticate a Slack user by stable Slack IDs, authorize `integration.trigger` and `thread.start`, and pass the resulting auth context into the thread.

## Non-goals

- Do not ship a production Slack package in core.
- Do not depend on the Slack SDK.
- Do not use Slack username, display name, or email as the primary access key.
- Do not add OAuth installation flows.
- Do not implement dashboard or CLI ingress.

## Slack-Shaped Flow

Use a test integration or example-local route that behaves like Slack ingress:

```txt
Slack event request
  -> verify external signature at integration boundary
  -> identity resolves workspace id + user id
  -> authorize integration.trigger for slack bot
  -> authorize thread.start for selected agent
  -> ThreadService.startSession(auth context)
  -> runtime policy handles later capabilities
```

The normalized principal should use stable provider subject data:

```ts
{
  id: "slack:T123:U123456",
  kind: "user",
  provider: "slack",
  providerSubject: "T123:U123456",
  aliases: [{ provider: "slack", type: "username", value: "dane" }],
}
```

## Architecture Impact

- Extends integration route creation context so integrations can opt into an app-level auth gateway.
- Adds or documents an integration-local identity provider pattern for Slack-shaped requests.
- Adds `integration.trigger` authorization with resource type `integration`.
- Proves two-stage authorization: can trigger the integration, then can start or run the requested Weave action.
- Keeps third-party provider details outside Weave core.

## Implementation Plan

1. Extend integration route context to include configured `auth` or an auth helper that can authenticate and authorize integration requests.
2. Add a Slack-shaped test integration that verifies a fake signature and resolves workspace id plus user id into a principal.
3. Add `integration.trigger` action support and policy helper coverage.
4. Authorize `integration.trigger` before starting a thread.
5. Authorize `thread.start` for the selected agent before starting a thread.
6. Pass the resulting auth context into `ThreadService.startSession(...)`.
7. Add a runtime capability denial test using the Slack principal from the integration-started thread.

## Test Plan

- Integration test anyone can trigger the fake Slack bot when policy allows `integration.trigger`.
- Integration test a Slack user can start an allowed agent.
- Integration test a Slack user is denied from starting a disallowed agent after trigger is allowed.
- Integration test Slack username aliases are persisted only as aliases, not as primary identity.
- Integration test the Slack-started thread later denies a disallowed capability through runtime policy.
- Unit test Slack provider subject includes workspace id plus user id.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] Integration route authors can access the configured auth gateway.
- [ ] `integration.trigger` is a supported Weave authorization action.
- [ ] A Slack-shaped ingress path uses stable workspace id plus user id as provider subject.
- [ ] Slack username/display name is never used as the primary access key.
- [ ] Trigger authorization and thread-start authorization are separate decisions.
- [ ] Auth context from integration ingress reaches runtime capability policy checks.

## Progress

- [ ] Integration auth route context.
- [ ] Slack-shaped test integration.
- [ ] `integration.trigger` action.
- [ ] Two-stage authorization tests.
- [ ] Runtime policy propagation test.
- [ ] Docs updates.

## Completion Notes

Fill this in when the slice ships.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/integrations.md`
- [ ] `docs/declarative-api.md`
- [ ] `docs/architecture.md`
