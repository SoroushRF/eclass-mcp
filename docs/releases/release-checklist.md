# Release Checklist

This checklist is the canonical release flow for the engine line.

## Prepare

1. Confirm the intended version in `package.json`, `package-lock.json`, README, `CHANGELOG.md`, and `docs/PROJECT_MASTER.md`.
2. Confirm `CHANGELOG.md` has a dated release section and an empty `Unreleased` section.
3. Confirm `docs/releases/<version>.md` matches the changelog section closely enough to paste into GitHub Releases.
4. Confirm `docs/releases/<version>-commit-audit.md` covers the reachable history reviewed for the release.

## Verify

Run:

```powershell
npm.cmd run test
npm.cmd run test:coverage
npm.cmd run typecheck
npm.cmd run typecheck:tests
npm.cmd run lint
npm.cmd run format:check
npm.cmd run build
git diff --check
```

Then confirm:

```powershell
git status --short
git tag --list v1.0.0-beta.2
git log --oneline --decorate --max-count=10
```

Expected:

- Worktree is clean.
- The release tag does not already exist.
- Latest commit is the release-prep commit.

## Optional Manual E2E Evidence

Manual host validation is optional for routine internal hardening commits, but it is recommended before public release notes or recruiter-facing demos.

Run:

```powershell
npm.cmd run doctor
npm.cmd run e2e:template
npm.cmd run e2e:template -- --phase "v1.0.0-beta.2 Manual E2E"
```

Then, when credentials and the host apps are available:

1. Build the tested commit with `npm.cmd run build`.
2. Run the Inspector smoke pass from `docs/t11-e2e-handbook.md`.
3. Run the Claude Desktop prompt matrix for user-facing rows.
4. Record redacted evidence in `docs/e2e-run-log.md`.
5. Keep T41/T42 Cengage/WebAssign activation rows marked "Not re-run" unless they were actually exercised.

Do not treat the generated template as live evidence. It is only the run scaffold.

## Commit

Commit release prep separately from feature, hardening, or test work:

```powershell
git add -- CHANGELOG.md README.md package.json package-lock.json docs/PROJECT_MASTER.md docs/releases
git commit -m "chore(release): prepare v1.0.0-beta.2"
```

## Tag And Push

Only after explicit confirmation:

```powershell
git tag -a v1.0.0-beta.2 -m "v1.0.0-beta.2"
git push origin master --follow-tags
```

If the current branch is not `master`, replace `master` with:

```powershell
git branch --show-current
```

## Publish GitHub Release

1. Open a GitHub Release for tag `v1.0.0-beta.2`.
2. Use `v1.0.0-beta.2` as the release title.
3. Paste `docs/releases/1.0.0-beta.2.md` as the release body.
4. Verify the upgrade notes and known limitations remain present.

## Historical Tag Policy

The repo currently has historical local tags `v0.9.0-core` and `v0.9.0-alpha`. `1.0.0-beta.1` exists as a documented release section but has no local tag. Do not retroactively invent old tags unless explicitly deciding to repair public release history. `v1.0.0-beta.2` starts the clean beta tagging discipline.
