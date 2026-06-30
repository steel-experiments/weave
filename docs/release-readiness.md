# Release Readiness

This document tracks the current open-source release state for Weave. It is intentionally conservative: the repository contains a working local proof of concept, but it is not ready to publish as an npm package yet.

## Current State

- Core runtime, Postgres storage, API server, auth gateway, policies, durable effects, and examples are implemented in TypeScript.
- `npm run typecheck` and `npm test` are the baseline local verification commands.
- A `tsc` build emits JavaScript and declarations to `dist/`; `exports` point at `dist`, `files` narrows the publish manifest, and the package is MIT-licensed. It remains `private: true` as a safety latch until the publish decision. Local development still resolves the `weave` subpaths to source via `tsconfig` path mapping, so no build is needed to run tests or examples.
- The root README documents the current local development workflow and current public API shape.

## Release Blockers

Done in publish prep:

- MIT license added in `LICENSE` and `package.json`.
- `tsc` build pipeline (`npm run build`, `tsconfig.build.json`) emits JS + `.d.ts` to `dist/`.
- `exports` point at the built `dist/` files; `files` narrows the publish manifest to `dist`, `README.md`, and `LICENSE`; `prepack` builds before pack/publish.
- CI (`.github/workflows/ci.yml`) runs `npm ci`, `npm run typecheck`, `npm run build`, `npm test` against a Postgres service, and `npm pack --dry-run`.
- Repository metadata (`repository`, `homepage`, `bugs`, `author`) added with the current `steel-experiments/weave` URL.
- Blade product-planning docs relocated to the Blade app (`apps/blade/docs/`); the north-star framing now treats Blade as the primary consumer rather than this repo's product.

Remaining before `npm publish`:

- Flip `private: true` to `false` (kept as a safety latch during prep).
- Confirm the npm package name. `weave` is unscoped and likely already taken on the public registry; a scope such as `@steel/weave` would change consumer imports — including the in-repo Blade app, which imports `weave` and `weave/postgres`. Finalize the public repository URL at the same time.
- Decide whether the kernel and runtime ship as one package with subpaths or as two separate npm packages. Current decision: one package with subpaths (see Packaging Decision below). The narrower-root question is resolved — the root `weave` export is now kernel-only.
- Add public project governance docs before launch: `CONTRIBUTING.md`, `SECURITY.md`, and a changelog or release notes policy.
- Keep Blade-specific product planning out of `docs/`.
- Revoke any API keys that have ever existed in local ignored `.env` files before the repository becomes public.

## Recommended Publish Shape

- `weave`: the kernel — durable thread, event, projection, timeline, and coordination contracts. No agent-authoring or replay code.
- `weave/runtime`: the runtime — authoring primitives (`agent`/`tool`/`weave`/`event`/`capability`/`policy`/`integration`), durable `ctx.*`, runners, daemons, and tool workers. Strict superset of the kernel.
- `weave/postgres`: Postgres storage engine, migrations, pool creation, `ThreadService`, artifact store, and observability store. Kernel-only.
- `weave/server`: HTTP API server helpers (runtime).
- `weave/testing`: deterministic test utilities (runtime).
- `weave/auth`: auth gateway, access rules, JWT helper, and identity adapter contract tests. Kernel-only.
- `weave/opencode`: hardened OpenCode CLI adapter (runtime).

## Packaging Decision

Weave will be published as an open-source product, with the kernel as the headline: a Postgres-native durable thread/record/coordination substrate a host can build on without adopting any replay or agent-authoring model. The replay/agent layer (`weave/runtime`) is the optional layer on top.

Decision: ship one npm package with the subpaths above, not separate `weave` and `weave-runtime` packages — for now. Rationale:

- The boundary that matters for consumers (kernel cannot depend on runtime) is already physical (`src/` vs `src/runtime/`) and statically enforced (`core-no-runtime`), so a single package does not blur it.
- The only kernel consumer today, Blade, imports `weave` and `weave/postgres` and never touches `weave/runtime`; subpaths already give it a clean kernel-only dependency.
- Splitting into separate packages adds versioning, lockfile, and release-coordination overhead with no consumer currently asking for independent runtime releases.
- The seam is mechanical to promote later: `src/runtime/` becomes its own package depending on the kernel, with no source moves. Promote when there is a real need for independent versioning, a runtime-only consumer, or a kernel that must stay frozen while the runtime churns.

Revisit this decision at the point a build pipeline and publish manifest are added (the next packaging blockers above).

## Documentation Status

- Public-facing start point: `README.md`.
- Product narrative: `docs/what-is-weave.md`.
- Current API reference and replay semantics: `docs/declarative-api.md`.
- Architecture and vocabulary: `docs/architecture.md` and `docs/glossary.md`.
- Migration guidance: `docs/migration/api-refactor.md`.
- Internal planning material remains in `docs/`, especially Blade and slice planning docs. Keep these clearly labeled or move non-public planning material before the first public release if the repository should read as product-first rather than roadmap-first.

## Verification Checklist

Run before opening the repository publicly:

```sh
npm ci
npm run typecheck
npm run build
npm test
npm pack --dry-run
```

Before the first publish, verify a sample consumer can import each documented package subpath from the packed tarball (`.`, `/runtime`, `/postgres`, `/server`, `/testing`, `/auth`, `/opencode`), and that types resolve.
