# Release Readiness

This document tracks the current open-source release state for Weave. It is intentionally conservative: the repository contains a working local proof of concept, but it is not ready to publish as an npm package yet.

## Current State

- Core runtime, Postgres storage, API server, auth gateway, policies, durable effects, and examples are implemented in TypeScript.
- `npm run typecheck` and `npm test` are the baseline local verification commands.
- The package is private and exports TypeScript source for local workspace use.
- The root README documents the current local development workflow and current public API shape.

## Release Blockers

- Choose and add an open-source license in `LICENSE` and `package.json`.
- Add repository metadata once the public repository URL is final: `repository`, `homepage`, `bugs`, and maintainer ownership.
- Add a real build pipeline that emits JavaScript and declaration files to `dist`.
- Point `exports` at built files instead of `src/*.ts` before publishing.
- Finalize the publish manifest after the build pipeline exists so npm packages contain built files, public docs, and any examples intentionally shipped to consumers.
- Decide whether the root `weave` export remains broad for compatibility or becomes a narrower authoring-only surface.
- Add CI for `npm ci`, `npm run typecheck`, `npm test`, and `npm pack --dry-run`.
- Add public project governance docs before launch: `CONTRIBUTING.md`, `SECURITY.md`, and a changelog or release notes policy.
- Revoke any API keys that have ever existed in local ignored `.env` files before the repository becomes public.

## Recommended Publish Shape

- `weave`: stable authoring primitives and compatibility exports.
- `weave/runtime`: runtime services, runners, daemons, workers, credentials, and observability helpers.
- `weave/postgres`: Postgres storage engine, migrations, pool creation, artifact store, and observability store.
- `weave/server`: HTTP API server helpers.
- `weave/testing`: deterministic test utilities.
- `weave/auth`: auth gateway, access rules, JWT helper, and identity adapter contract tests.

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
npm test
npm pack --dry-run
```

After a build pipeline exists, include the build command in the checklist and verify a sample consumer can import each documented package subpath from the packed tarball.
