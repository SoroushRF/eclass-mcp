# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Handled lazy-loaded dashboard race conditions in the `courses` scraper.
- Fixed announcement duplication and startup authentication window behavior.
- Addressed `no-useless-assignment` CI lint rule violation.
- Fixed MCP payload envelope sizes and navigation/file/section logic.

## [1.0.0-beta.1] - 2026-03-27

### Added

- **RateMyProfessors (RMP) Engine**: Integrated rating tags extraction and professor details lookup (T17/T18).
- **SIS Expansion**: Shipped Student Information System exam schedule and class timetable tools.
- **Smart Cache System**: Implemented T26 smart caching with freshness envelopes and scoped clearing architecture.
- Added RMP diagnostics and stricter typing controls for CI pipelines.
- Engine versioning and release policy tracking mechanisms.

### Changed

- Refactored internal architecture for caching CI and lint fixes.
- Updated restrictive package licensing constraints.
- Consolidated session errors to improve auth launch reliability.
- Set package `main` entry point to `dist/index.js`.

### Fixed

- Claude authentication behavior flows and RMP data outputs.
- Style and import optimizations alongside debug log cleanup (ignore policy).

## [0.9.0-core] - 2026-03-23

### Added

- **Governance**: Added `PROJECT_MASTER.md` as the canonical planning source.
- Included `SECURITY.md`, `CONTRIBUTING.md`, and `CODE_OF_CONDUCT.md`.
- **Multimodal capabilities**: Added vision image blocks extraction for item details (with safety payload caps).
- Added inline CSV support with size limits.
- **Quality Gates**: Shipped robust CI with linting, testing, vitest hooks, formatting, and unit tests (cache/session/pptx).
- Implemented cache version bumps to automatically force cache refresh following breaking scraper changes.

### Changed

- Overhauled and modernized the `announcements` tool logic.
- Modernized universal course structure extraction specifically for Moodle 4 (side-drawer + fallback modes).
- Expanded assignment feedback extraction metrics.
- Updated scripts to retain only CI setup routines + smoke testing logic.
- Restructured `get_file_text` tool, making `courseId` optional and improving hint descriptions.

### Removed

- Cleaned up obsolete root debug outputs and scattered legacy planning documentation.

## [0.1.0] - 2026-03-19

### Added

- **Core MCP Server Base**: Launched initial server architecture supporting foundational Playwright caching, sessions, and eClass auth sequences.
- **Scraper Implementations**: Rolled out implementations for tasks 1-6 covering basic assignments, files, and grades.
- **Smart PDF Intelligence Pipeline**: Built per-page metadata analysis, text extraction, downscaled canvas image rendering, and mixed-content cache paths with safety thresholds.
- **Deadlines Tooling**: Integrated Moodle 4 structure selectors for assignments and calendar windows using an index-based month strategy.

### Fixed

- Addressed `EPERM` issues natively on Windows by resolving absolute cache/session paths.
- Resized environment `.env` paths for Docker container compatibility with Claude Desktop.
- Resolved tricky JS-rendered HTML wrapper issues during native file downloads on Moodle via Playwright fallbacks.
- Corrected WAF cookie/token proxy acquisition paths inside the baseline auth flow.
