# Capability Contracts Slice

## Status

- Vertical: `weave-core`
- Status: `Proposed`
- Last updated: `2026-06-02`
- Owner: `weave-core`

## Goal

Introduce explicit capability contracts that describe scoped permissions and resource access without enforcing full runtime policy yet.

## Non-goals

- Do not add full policy enforcement over every runtime action.
- Do not replace existing credential providers.
- Do not add ambient capabilities or hidden grants.
- Do not add external authorization integrations.
- Do not change tool execution semantics except to carry declared capability metadata where needed.
- Do not add Effect internals.

## User Outcome

As an app author, I can declare the capabilities an agent or tool may need so future policy enforcement has a typed, auditable contract to evaluate.

## Architecture Impact

- Adds `CapabilityContract` and `capability(...)` authoring helpers.
- Adds optional capability declarations to agents, tools, or app definitions depending on the final design.
- Clarifies the relationship between credentials and capabilities: credentials resolve secret material; capabilities describe authorized access intent.
- Prepares policy enforcement without changing runtime permission behavior in this slice.
- May update docs, glossary, and architecture vocabulary for capabilities.

## Proposed Public API Sketch

```ts
const githubRead = capability({
  name: "github.read",
  description: "Read GitHub issues and pull requests.",
  scopes: z.object({
    owner: z.string(),
    repo: z.string(),
  }),
});

const inspectIssue = tool({
  name: "github.issue.inspect",
  capabilities: [githubRead],
  // ...
});
```

Final syntax may change during implementation, but the slice should keep capability declarations inert and auditable.

## Implementation Plan

1. Decide where capability declarations live for V1: tools only, agents only, or both.
2. Add `CapabilityContract` and `defineCapability`/`capability` helpers.
3. Add optional capability fields to the chosen contract types.
4. Export the capability helpers from the root package.
5. Add type and smoke tests proving declarations compose with `weave(...)`.
6. Update docs to mark capabilities as declared metadata, not enforced runtime policy yet.
7. Add an example declaration in one deterministic example if it clarifies usage without changing runtime behavior.

## Test Plan

- Public API export smoke test includes `capability` and `defineCapability` if both are exported.
- Typecheck test proving tools or agents can declare capabilities.
- Runtime compatibility test proving capability metadata does not break existing tool execution.
- Docs review to avoid implying enforcement exists before slice 39.
- Run `npm test` and `npm run typecheck`.

## Acceptance Criteria

- [ ] Capability contracts can be declared with schema-backed scope metadata.
- [ ] Capability declarations can attach to the chosen public contract type.
- [ ] Capability declarations are exported from the public authoring boundary.
- [ ] Existing apps and examples continue to run without capabilities.
- [ ] Docs state that this slice adds declaration only, not enforcement.
- [ ] Follow-up enforcement work is captured in slice 39.
- [ ] `npm test` passes.
- [ ] `npm run typecheck` passes.

## Progress

- [ ] Decide declaration attachment point.
- [ ] Add contracts and helpers.
- [ ] Add tests.
- [ ] Update docs.
- [ ] Run verification.

## Completion Notes

Fill this in when shipped.

Include:

- final capability API shape
- declaration attachment point
- tests added
- docs updated
- commands run
- enforcement gaps left for slice 39

## Docs To Update On Completion

- [ ] this slice document
- [ ] `docs/slices/README.md`
- [ ] `docs/declarative-api.md`
- [ ] `docs/architecture.md`
- [ ] `docs/glossary.md`
- [ ] `docs/migration/api-refactor.md` if author guidance changes
