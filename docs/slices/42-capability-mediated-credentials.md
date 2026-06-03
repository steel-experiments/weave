# Capability Mediated Credentials Slice

## Status

- Vertical: `weave-core`
- Status: `Planned`
- Last updated: `2026-06-03`
- Owner: `weave-core`

## Goal

Turn capabilities from inspectable metadata into the public control-plane interface for scoped credential requests.

This slice should build on the stabilized policy replay semantics from slice 41.

## Non-goals

- Do not start this before slice 41 ships.
- Do not replace the existing `CredentialProvider` interface wholesale.
- Do not add external authorization integrations.
- Do not add policy aggregation or redaction.
- Do not enforce policies over every runtime action.
- Do not require app authors to import Effect.

## User Outcome

As an app author, I can declare scoped capability requests for a tool so credentials are resolved through an auditable policy-aware control-plane boundary instead of ad hoc string credential names.

## Architecture Impact

- Evolves capability contracts from static metadata to requestable scoped access.
- Connects capability requests to credential resolution.
- Gives policies a stronger structured object to evaluate than raw credential names.
- May add capability request events if durable audit evidence requires them.
- Keeps `CredentialProvider` as the low-level secret material resolver.

## Proposed Public API Sketch

```ts
const githubRepoWrite = capability({
  name: "github.repo.write",
  params: z.object({
    owner: z.string(),
    repo: z.string(),
  }),
  scope(params) {
    return {
      provider: "github",
      resource: `${params.owner}/${params.repo}`,
      permissions: ["contents:write", "pull_requests:write"],
    };
  },
});

const createPullRequest = tool({
  name: "github.pr.create",
  capabilities(input) {
    return [githubRepoWrite.request({ owner: input.owner, repo: input.repo })];
  },
  // ...
});
```

Final syntax may change during implementation, but capability-mediated credentials should remain explicit and replay-safe.

## Implementation Plan

1. Review slice 41 policy replay and request hash semantics.
2. Decide whether capability requests are declared on tools only or also requested through `ctx.capability`.
3. Add capability parameter schemas and request objects.
4. Map capability requests to credential resolution input.
5. Ensure capability request parameters participate in policy request hashing.
6. Add durable audit events only if existing credential/policy events are insufficient.
7. Preserve raw `credentials(...)` compatibility where needed.
8. Update docs and examples.

## Test Plan

- Capability request schema validation.
- Tool capability request participates in policy request context.
- Capability request params affect request hash and replay mismatch behavior.
- Credential provider receives mapped credential resolution input.
- Missing capability-mediated credential records the same terminal failure semantics as current credentials.
- Existing `credentials(...)` tools remain compatible.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] Capability contracts can produce scoped capability requests.
- [ ] Tool contracts can declare capability requests derived from input.
- [ ] Capability requests participate in policy evaluation and replay hashing.
- [ ] Capability-mediated credentials resolve through existing credential provider boundaries.
- [ ] Existing credential behavior remains compatible.
- [ ] Docs explain capabilities versus credentials.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Finalize capability request API.
- [ ] Implement request objects and validation.
- [ ] Integrate with policy context and request hashing.
- [ ] Integrate with credential resolution.
- [ ] Add tests.
- [ ] Update docs.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md`
- [ ] `docs/architecture.md`
- [ ] `docs/glossary.md`
- [ ] `docs/migration/api-refactor.md` if author guidance changes
