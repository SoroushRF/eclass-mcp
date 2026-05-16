# ADR 0002: Encrypted Local Session Storage

## Status

Accepted.

## Context

Browser cookies and storage state allow access to student-specific academic data. Plaintext session persistence would make accidental disclosure through backups, sync folders, or local inspection too easy.

## Decision

Store eClass/SIS and Cengage/WebAssign session artifacts in encrypted local files using the user-provided `ECLASS_MCP_SESSION_SECRET`. Reject legacy plaintext session files instead of silently accepting weaker storage.

## Consequences

- Users must set a strong session secret before authenticating.
- `npm run doctor` can identify missing, weak, stale, or undecryptable session state.
- Secure deletion remains best-effort on consumer filesystems, so logout removes auth files but cannot guarantee physical erasure on SSDs, sync folders, journals, or backups.
