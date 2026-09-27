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
2. **Branch** from the default branch (`master`) with a short descriptive name (e.g. `fix/deadlines-month-range`). Stacked feature work may branch from its parent feature branch; rebase onto the parent when it changes and push with `--force-with-lease`. Never force-push `master`.
3. **Implement** in small, atomic commits. Every commit should build, lint, and pass tests on its own:
   - `npm run build` passes
   - `npm run lint` passes (`--max-warnings 0`)
   - `npm run format:check` passes
   - `npm test` passes
4. **Describe** the PR using the [pull request template](.github/pull_request_template.md): summary, motivation, changes, security considerations, how you verified it (manual steps for scraper changes are OK), docs updated, and follow-ups.
5. **CI** must be green on GitHub (install, build, lint, test) before merge. Prefer rebase-merge or a merge commit so atomic history survives; squash only fixup noise.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/), matching the existing history:

```text
type(scope): imperative summary (72 characters or fewer)

Body explaining why the change is needed.

Refs: #123
```

- **Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`. Add `!` and a `BREAKING CHANGE:` footer when tool behavior changes incompatibly.
- **Scopes** name the area touched, for example `api`, `auth`, `tools`, `files`, `security`, `logging`, `docs`, `adr`, `github`.
- Tests land in the same commit as the behavior they cover.

## Documentation rule

Docs are part of the definition of done. A change is not complete until its docs are updated in the same commit, or in a `docs(...)` commit in the same PR:

- Keep `README.md`, `docs/tools/*`, `docs/operational-limits.md`, `SECURITY.md`, `CHANGELOG.md` (Unreleased), and the [ADR index](docs/adr/README.md) consistent with the code on the branch.
- Record live observations about eClass behavior in the relevant findings log under [`docs/investigations/`](docs/investigations/) with the date, the method, and the result **shape** only. Mark each claim **Observed**, **Source**, or **Assumed**.
- Never record tokens, private tokens, QR keys, `sesskey`, cookies, `Location` values, numeric user ids, student numbers, or emails. Record lengths, field names, counts, status codes, and error codes instead.
- Use a neutral, factual tone; do not present speculation as fact.

## End-to-end (Claude Desktop) checks

Manual E2E is **not** required for every small PR, but for **host-visible** or **tool-behavior** changes, run the checklist in [`docs/t11-e2e-handbook.md`](docs/t11-e2e-handbook.md) when practical and record outcomes in [`docs/e2e-run-log.md`](docs/e2e-run-log.md).

## Code style

- Match existing patterns in `src/` (TypeScript, error handling, tool modules).
- Run `npm run lint:fix` for auto-fixable ESLint issues.
- Prefer extending existing helpers over duplicating scraper logic.

## Community

Be respectful and constructive. See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
