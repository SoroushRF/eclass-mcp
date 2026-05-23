# prepare_assignment_submission

`prepare_assignment_submission` is the T37 read-only preflight tool for future assignment submission writes. It does not upload files, save drafts, submit forms, or mutate eClass, Moodle, Cengage, or WebAssign state.

## Purpose

The tool resolves the intended assignment target, gathers stable facts the user can confirm, and signs those facts into a `preflightRef`. Future mutating tools must require that reference plus `confirm: true`, rerun resolution immediately before writing, recompute the target hash, and fail if the platform state changed.

## Inputs

- eClass/Moodle selectors: `assignmentUrl`, `assignmentId`, `courseId`, `courseCode`, `courseQuery`, `assignmentQuery`.
- Cengage/WebAssign selectors: `entryUrl`, `ssoUrl`, `courseId`, `courseKey`, `courseQuery`, `assignmentUrl`, `assignmentId`, `assignmentQuery`.
- Platform control: `platform` can be `auto`, `eclass`, or `cengage`.
- Intended local files: `intendedFiles` binds local file names, sizes, MIME guesses, and SHA-256 hashes into the preflight facts. URL paths are rejected by schema.

## Output

Responses use `status: "ok" | "ambiguous" | "blocked" | "error"`.

- `ok`: one target was resolved and the response includes `targetHash`, `preflightRef`, and `expiresAt`.
- `ambiguous`: multiple courses or assignments matched; use the returned `candidates` to retry with a more exact selector.
- `blocked`: the target was found, but a safe future write cannot proceed, such as finalized submission state, unreadable intended file, missing Moodle upload slot, or unsupported external-platform upload.
- `error`: validation, auth, upstream, secure-storage, or layout failures mapped to structured JSON.

## Platform Behavior

For eClass/Moodle, the tool opens the assignment page fresh, checks the final URL boundary, extracts course and assignment facts, submission/grading state, current files, visible due/cutoff dates, available submission actions, and safe read-only upload-slot metadata.

For Cengage/WebAssign, the tool resolves the selected course and assignment using the existing Cengage selection behavior and active-course verification. It returns due/status/score facts and a signed `preflightRef`, but sets `writeSupport: "unsupported_external_platform"` because T37 does not design or enable WebAssign mutation.
