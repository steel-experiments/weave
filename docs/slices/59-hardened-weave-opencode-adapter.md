# Hardened Weave OpenCode Adapter

## Status

- Vertical: `weave-core`
- Status: `Shipped`
- Last updated: `2026-06-15`
- Owner: `weave-core`

## Goal

Add a reusable hardened OpenCode adapter under a dedicated package subpath such as `weave/opencode`, so apps can use OpenCode through Weave's capability, policy, tool, artifact, and workspace seams instead of shelling out directly.

## Non-goals

- Do not bake Weave Maintainer's slice/repair schemas into the core adapter.
- Do not expose an unbounded shell or file-system bridge by default.
- Do not assume one specific OpenCode provider configuration beyond the CLI contract this adapter supports.
- Do not make OpenCode a replacement for Weave's durable tool lifecycle.
- Do not ship provider-specific credentials inside the adapter.

## User Outcome

As a Weave app author, I can create an OpenCode-backed agent or tool with an explicit capability profile and typed output schema, while Weave controls which tools, filesystem paths, commands, network access, and credentials OpenCode may use.

## Architecture Impact

- Adds a public `weave/opencode` subpath for the default OpenCode adapter.
- Defines a framework-level `OpenCodePermissionProfile` that maps allowed OpenCode tools to Weave capability requests.
- Keeps app-specific prompts and output schemas supplied by the app.
- Provides a reusable fake-runner contract test suite for apps that extend the adapter.
- Updates `docs/agent-adapters.md` from "example-local" guidance to the supported adapter seam.

## Proposed Interface Shape

```ts
import { createOpenCodeCliAdapter, opencodePermissionProfile } from "weave/opencode";

const opencode = createOpenCodeCliAdapter({
  profile: opencodePermissionProfile({
    workspace: workspaceRef,
    tools: {
      readFiles: true,
      writeFiles: { allowedPaths: ["src/**", "docs/**"] },
      shell: { commands: ["npm test", "npm run typecheck"] },
      network: false,
      secrets: false,
      git: { allowCommit: false, allowBranchSwitch: false, allowPush: false },
    },
  }),
  output: z.object({ summary: z.string().min(1) }),
});
```

The exact names can change during implementation, but the interface must keep two seams clear:

- app authors provide prompt construction and output schemas
- Weave provides capability mediation, permission profile validation, command execution bounds, and post-run enforcement

## Implementation Plan

1. Add `src/opencode-entry.ts` and package export `./opencode`.
2. Add provider-neutral OpenCode adapter types: profile, CLI config, run input, run result, and runner context.
3. Add permission profile helpers that produce both OpenCode CLI flags and Weave capability requests.
4. Add command/env validation and default-deny env handling.
5. Add workspace-root and actual-diff enforcement utilities that do not depend on maintainer schemas.
6. Add `createOpenCodeCliAdapter(...)` for typed one-shot runs with bounded stdout/stderr, timeout, and schema-validated output.
7. Add extension seams so apps can add additional OpenCode-exposed tools only when each tool maps to explicit Weave capabilities.
8. Add public contract tests with fake OpenCode executables for success, denied permission, unsafe config, out-of-scope diff, invalid JSON, timeout, and max-output failure.
9. Update root public export smoke tests for `weave/opencode` without exporting these symbols from root `weave`.
10. Document how apps should combine `weave/opencode` with normal Weave tools, gates, credentials, artifacts, and workspace providers.

## Test Plan

- Public export smoke test imports `createOpenCodeCliAdapter` from `weave/opencode`.
- Unit tests validate permission profile defaults are deny-by-default.
- Unit tests validate declared capabilities match the selected permission profile.
- Unit tests validate custom tool extensions require explicit capability declarations.
- Fake executable integration tests cover valid output, invalid JSON, timeout, max output, permission denial, and unsafe env.
- Workspace integration test verifies actual changed files are enforced against allowed paths.
- Typecheck examples that consume the adapter through `weave/opencode`.
- Run `npm test`, `npm run typecheck`, and `git diff --check`.

## Acceptance Criteria

- [x] `weave/opencode` exists as a documented package subpath.
- [x] The adapter is generic and does not import Weave Maintainer modules.
- [x] Permission profiles are deny-by-default and map to Weave capabilities.
- [x] Apps can extend the exposed OpenCode tool surface only by declaring corresponding capabilities.
- [x] Actual workspace changes can be checked independently of model-reported summaries.
- [x] Environment and command configuration fail closed by default.
- [x] Tests prove unsafe profiles, out-of-scope changes, and permission requests are blocked.
- [x] Docs explain the security model and remaining host-level assumptions.

## Progress

- [x] Define `weave/opencode` public interface.
- [x] Implement permission profile and capability mapping.
- [x] Implement CLI adapter execution bounds.
- [x] Implement actual-diff enforcement utilities.
- [x] Add public export and fake executable tests.
- [x] Update adapter docs.

## Completion Notes

- Added `src/opencode-adapter.ts` with provider-neutral adapter types for `OpenCodePermissionProfile`, `OpenCodeCliConfig`, `OpenCodeRunInput`, `OpenCodeRunResult`, and `OpenCodeRunnerContext`.
- Added `src/opencode-entry.ts` and the `./opencode` package export. The root `weave` export intentionally does not re-export these symbols.
- Implemented `opencodePermissionProfile(...)` and `opencodeDenyAllPermissionProfile(...)`. Profiles default to no workspace writes, shell, network, secrets, Git commits, branch switching, or pushes, and require `--pure` OpenCode permission mode.
- Added built-in capability contracts and requests for `opencode.run`, workspace read/write, bounded shell, network, secrets, and Git authority. App-defined OpenCode-exposed tools are rejected unless they declare Weave capabilities.
- Implemented command, args, profile flag, env allowlist, workspace root, and unsafe config validation before process launch. Broad shell executables, unsafe OpenCode session/file/remote flags, and `--dangerously-skip-permissions` fail closed.
- Implemented bounded CLI execution with timeout, abort handling, stdout/stderr/combined output byte limits, sanitized child env, structured `OpenCodeAdapterError` codes, permission-request detection, and non-zero exit handling.
- Implemented `parseOpenCodeJsonOutput(...)` for strict JSON and OpenCode-style JSON event stream extraction, validated against the app-provided Zod schema.
- Implemented Git-backed actual changed-file capture before and after execution using `git status --porcelain=v1 -z --untracked-files=all`, with enforcement against profile/run `allowedPaths` independent of model-reported changed files.
- Added `src/tests/opencode-adapter.test.ts` covering default-deny profiles, capability mapping, extension capability requirements, fake executable success, invalid JSON, invalid schema, timeout, max output, unsafe env, unsafe args, unsafe command config, permission requests, permission denied output, out-of-scope actual diffs, non-Git workspaces, direct command execution, and the no-maintainer-import boundary.
- Updated `src/tests/public-api-exports.test.ts` to import `createOpenCodeCliAdapter` and `opencodePermissionProfile` from `weave/opencode`.
- Updated `docs/agent-adapters.md`, `docs/declarative-api.md`, `README.md`, and `docs/slices/README.md` for the new public package boundary and security model.
- Validation commands run and passed: `npm test`, `npm run typecheck`, `npm --workspace weave-maintainer run test`, `npm --workspace weave-maintainer run typecheck`, and `git diff --check`.
- Known gaps: this slice does not migrate Weave Maintainer to the reusable adapter; that remains slice 60. `weave/opencode` hardens process launch and post-run enforcement, but it is not an OS sandbox. Host-level trust still depends on the installed OpenCode binary honoring permission flags, the local OS/user account, filesystem permissions, symlink/host config exposure, and credentials available outside the sanitized process environment.

## Docs To Update On Completion

- [x] this slice document
- [x] `docs/slices/README.md`
- [x] `docs/agent-adapters.md`
- [x] `docs/declarative-api.md`
- [x] `README.md` if the adapter becomes a recommended app-authoring path
