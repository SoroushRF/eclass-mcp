# ADR 0004: Selector Registry And Drift Diagnostics

## Status

Accepted.

## Context

eClass, SIS, and external assignment platforms can change DOM structure without notice. Scraper failures are easier to diagnose when selectors, fallback behavior, and drift evidence are explicit instead of scattered through page scripts.

## Decision

Keep scraper selectors and related diagnostics in typed registry-style modules where practical. Surface layout drift through structured errors and opt-in debug artifacts rather than silently returning partial or misleading data.

## Consequences

- Scraper changes can be reviewed against named selectors and fixtures.
- Debug snapshots are useful for maintenance but are plaintext local artifacts and must stay opt-in.
- More platforms can be added without treating every DOM query as one-off hidden logic.
