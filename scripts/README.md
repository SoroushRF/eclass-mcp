# Scripts (minimal)

Only **setup** and a few **smoke tests** stay in the active scripts root. One-off probes are archived under `scripts/archive/` to keep the main workflow lean.

| File                           | Purpose                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `doctor.mjs`                   | Read-only environment health check invoked by `npm run doctor`                          |
| `e2e-template.mjs`             | Read-only manual E2E/release run template generator invoked by `npm run e2e:template`   |
| `setup.mjs`                    | Invoked by `npm run setup` - safe Claude Desktop config merge, dry-run, backup, restore |
| `setup-claude.sh`              | Writes/merges `eclass` into `claude_desktop_config.json`                                |
| `tsconfig.json`                | TypeScript for `ts-node` when running tests below                                       |
| `test-scraper.ts`              | Smoke-test core scraper (`getCourses`, etc.)                                            |
| `test-deadlines.ts`            | Live deadline scrape                                                                    |
| `test-month-view.ts`           | Month-scoped deadlines                                                                  |
| `test-item-details.ts`         | Single assignment/quiz URL details                                                      |
| `test-pdf-parser.ts`           | Local PDF file -> parser (no eClass)                                                    |
| `debug-file-url.ts`            | Trace download/parsing for one `fileUrl`                                                |
| `inspect-cengage-dashboard.ts` | Dump authenticated Cengage/WebAssign page HTML, screenshot, state, and candidate links  |

```bash
npm run build
npm run doctor
npm run e2e:template
npm run e2e:template -- --phase "Task 10 Harness Smoke"
npm run setup -- --dry-run
npm run setup
npm run setup -- --list-backups
npm run setup -- --restore latest
npx ts-node -P scripts/tsconfig.json scripts/test-scraper.ts
npx ts-node scripts/test-deadlines.ts
npx ts-node -P scripts/tsconfig.json scripts/inspect-cengage-dashboard.ts
```

Large dumps go under `scripts/output/` (gitignored).

`setup.mjs` also accepts the advanced/test-only `ECLASS_MCP_CLAUDE_CONFIG_PATH` environment override to target a temporary Claude config path during setup, backup, and restore validation.

## Safety notes

- `doctor.mjs` and `e2e-template.mjs` are read-only by default.
- `e2e-template.mjs` prints Markdown to stdout unless `--append --output <path>` is provided.
- The live scraper smoke scripts require valid local credentials/session state and may open browsers or call upstream services.
- `inspect-cengage-dashboard.ts` may write authenticated page dumps under `scripts/output/`; keep those files out of commits.

## Archived probes

The following one-off probes were moved to `scripts/archive/` and are not part of the normal workflow:

- `dump-raw-text.ts`
- `extract-assignments.ts`
- `find-dates.ts`
- `parse-cengage.ts`
- `parse-webassign.ts`
- `inspect-cengage.ts`
- `inspect-cengage-auth.ts`
- `inspect-rmp.ts`
- `inspect-sis.ts`
- `inspect-webassign.ts`
- `test-rmp-fetch.ts`
- `test-sis-scraper.ts`
