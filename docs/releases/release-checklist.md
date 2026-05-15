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
