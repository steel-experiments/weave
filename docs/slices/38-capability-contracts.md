# Capability Contracts Slice

## Status

- Vertical: `weave-core`
- Status: `Shipped`
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

- [x] Capability contracts can be declared with schema-backed scope metadata.
- [x] Capability declarations can attach to the chosen public contract type.
- [x] Capability declarations are exported from the public authoring boundary.
- [x] Existing apps and examples continue to run without capabilities.
- [x] Docs state that this slice adds declaration only, not enforcement.
- [x] Follow-up enforcement work is captured in slice 39.
- [x] `npm test` passes.
- [x] `npm run typecheck` passes.

## Progress

- [x] Decide declaration attachment point.
- [x] Add contracts and helpers.
- [x] Add tests.
- [x] Update docs.
- [x] Run verification.

## Completion Notes

- Added `CapabilityContract`, `AnyCapabilityContract`, `capability(...)`, and `defineCapability(...)`.
- Chose tools as the V1 attachment point via optional `ToolContract.capabilities` because tools are the current side-effect boundary.
- Kept capability declarations inert: they do not change tool execution, credential resolution, gates, or runtime policy behavior.
- Exported capability helpers from the root package and added public boundary declarations.
- Added public API smoke coverage for `capability`, `defineCapability`, and tool/app composition.
- Added replay authoring coverage proving capability metadata does not affect tool planning.
- Updated `docs/declarative-api.md`, `docs/architecture.md`, `docs/glossary.md`, and `docs/migration/api-refactor.md`.
- Verified with `npm test` and `npm run typecheck`.
- Enforcement remains explicitly deferred to slice 39.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/declarative-api.md`
- [x] `docs/architecture.md`
- [x] `docs/glossary.md`
- [x] `docs/migration/api-refactor.md` if author guidance changes
