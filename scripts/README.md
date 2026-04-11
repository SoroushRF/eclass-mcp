# Scripts (minimal)

Only **setup** and a few **smoke tests** stay in the repo. One-off debug probes were removed to keep GitHub lean; recreate locally if needed (see `docs/PROJECT_MASTER.md` T26 / tool roadmaps).

| File | Purpose |
|------|---------|
| `setup.mjs` | Invoked by `npm run setup` — build + Claude Desktop config merge |
| `setup-claude.sh` | Writes/merges `eclass` into `claude_desktop_config.json` |
| `tsconfig.json` | TypeScript for `ts-node` when running tests below |
| `test-scraper.ts` | Smoke-test core scraper (`getCourses`, etc.) |
| `test-deadlines.ts` | Live deadline scrape |
| `test-month-view.ts` | Month-scoped deadlines |
| `test-item-details.ts` | Single assignment/quiz URL details |
| `test-pdf-parser.ts` | Local PDF file → parser (no eClass) |
| `debug-file-url.ts` | Trace download/parsing for one `fileUrl` |
| `inspect-cengage-dashboard.ts` | Dump authenticated Cengage/WebAssign page HTML, screenshot, state, and candidate links |

```bash
npm run build
npx ts-node -P scripts/tsconfig.json scripts/test-scraper.ts
npx ts-node scripts/test-deadlines.ts
npx ts-node -P scripts/tsconfig.json scripts/inspect-cengage-dashboard.ts
```

Large dumps go under `scripts/output/` (gitignored).
