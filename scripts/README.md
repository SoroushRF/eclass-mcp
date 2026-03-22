# Development scripts

Runnable helpers for debugging scrapers and parsers against a **real** eClass session. They are not part of the MCP server.

**Prerequisites:** `npm run build` (or `ts-node` paths as below), valid `.eclass-mcp/session.json`, and `npx playwright install chromium` on the machine.

| Script | Purpose |
|--------|---------|
| `test-scraper.ts` | Smoke-test core scraper methods |
| `test-deadlines.ts` / `test-month-view.ts` | Deadline flows |
| `test-item-details.ts` | Assignment/quiz detail pages |
| `test-section-text.ts` | Section text + tabs |
| `test-announcements.ts` | Announcements |
| `test-pdf-read.ts` / `test-pdf-parser.ts` | PDF pipeline |
| `debug-*.ts`, `discover-*.ts` | One-off selector or layout probes |
| `check-course-id.ts` | Resolve or verify course IDs |
| `setup.mjs`, `setup-claude.sh` | Claude Desktop MCP registration |

Run examples:

```bash
npx ts-node scripts/test-deadlines.ts
npx ts-node -P scripts/tsconfig.json scripts/test-scraper.ts
```

Write large HTML/JSON/text dumps under `scripts/output/` (gitignored), not next to source files.

Cross-cutting plans and history: [`docs/PROJECT_MASTER.md`](../docs/PROJECT_MASTER.md).
