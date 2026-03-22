# Contributing to eclass-mcp

Thanks for helping improve this project. Keep changes **focused**: one logical task per PR when possible.

## Before you open a PR

1. **Read the relevant docs** — Feature areas have roadmaps under [`docs/tools/`](docs/tools/). Cross-cutting plans live in [`docs/PROJECT_MASTER.md`](docs/PROJECT_MASTER.md).
2. **Do not commit secrets** — `.eclass-mcp/`, `.env`, and session data must stay **gitignored**. Never paste cookies or tokens into issues or PRs.
3. **Security issues** — Use [`SECURITY.md`](SECURITY.md) (private GitHub advisory or private maintainer contact), not a public issue.

## Local setup

```bash
npm ci
npm run build          # runs tsc (typecheck + emit)
npm run lint
npm test
```

Optional: `npx tsc --noEmit` matches what CI used to run separately; `npm run build` already typechecks.

Formatting for `src/` and `tests/`:

```bash
npm run format:check
npm run format         # fix with Prettier
```

## Pull request flow

1. **Fork** the repository (or use a branch if you have write access).
2. **Branch** from the default branch (`main` or `master`) with a short descriptive name (e.g. `fix/deadlines-month-range`).
3. **Implement** with small, reviewable commits if you like; ensure:
   - `npm run lint` passes (`--max-warnings 0`)
   - `npm test` passes
   - `npm run build` passes
4. **Describe** the PR: what changed, why, and how you verified it (manual steps for scraper changes are OK).
5. **CI** must be green on GitHub (install, build, lint, test) before merge.

## End-to-end (Claude Desktop) checks

Manual E2E is **not** required for every small PR, but for **host-visible** or **tool-behavior** changes, run the checklist in [`docs/t11-e2e-handbook.md`](docs/t11-e2e-handbook.md) when practical and record outcomes in [`docs/e2e-run-log.md`](docs/e2e-run-log.md).

## Code style

- Match existing patterns in `src/` (TypeScript, error handling, tool modules).
- Run `npm run lint:fix` for auto-fixable ESLint issues.
- Prefer extending existing helpers over duplicating scraper logic.

## Community

Be respectful and constructive. See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
