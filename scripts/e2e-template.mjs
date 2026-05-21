import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PHASE = 'Current Release Harness';

const PUBLIC_TOOLS = [
  'list_courses',
  'get_course_content',
  'get_section_text',
  'get_file_text',
  'get_assignments',
  'get_upcoming_deadlines',
  'get_deadlines',
  'get_item_details',
  'get_grades',
  'get_announcements',
  'get_exam_schedule',
  'get_class_timetable',
  'search_professors',
  'get_professor_details',
  'discover_cengage_links',
  'list_cengage_courses',
  'get_cengage_assignments',
  'get_cengage_assignment_details',
  'clear_cache',
  'cache_pin',
  'cache_unpin',
  'cache_list_pins',
  'cache_refresh_pin',
  'cache_delete_pinned',
  'cache_health',
];

function sanitizeInline(value) {
  return String(value ?? '')
    .replace(/[\r\n|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function git(args, fallback = 'unknown') {
  try {
    const output = childProcess.execFileSync('git', args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    return output.trim() || fallback;
  } catch {
    return fallback;
  }
}

function readPackageVersion() {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')
    );
    return typeof packageJson.version === 'string'
      ? packageJson.version
      : 'unknown';
  } catch {
    return 'unknown';
  }
}

function getWorktreeState() {
  return git(['status', '--short'], '') ? 'dirty' : 'clean';
}

function parseArgs(argv) {
  const options = {
    phase: DEFAULT_PHASE,
    outputPath: null,
    append: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--phase') {
      index += 1;
      if (!argv[index]) {
        throw new Error('--phase requires a value');
      }
      options.phase = argv[index];
    } else if (arg === '--output') {
      index += 1;
      if (!argv[index]) {
        throw new Error('--output requires a path');
      }
      options.outputPath = argv[index];
    } else if (arg === '--append') {
      options.append = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.outputPath && !options.append) {
    throw new Error('--output is only allowed with explicit --append');
  }

  return options;
}

function buildMetadata(phase) {
  return {
    phase: sanitizeInline(phase) || DEFAULT_PHASE,
    generatedAt: new Date().toISOString(),
    os: `${os.platform()} ${os.release()} (${os.arch()})`,
    node: process.version,
    packageVersion: readPackageVersion(),
    branch: sanitizeInline(git(['branch', '--show-current'])),
    commit: sanitizeInline(git(['rev-parse', '--short', 'HEAD'])),
    worktree: getWorktreeState(),
  };
}

function tableRow(values) {
  return `| ${values.map((value) => sanitizeInline(value)).join(' | ')} |`;
}

function generateTemplate(metadata) {
  const toolInventory = PUBLIC_TOOLS.map((tool) => `\`${tool}\``).join(', ');

  return `## Run Template - ${metadata.phase}

Generated blank template only. Fill this in only after a real manual Inspector or Claude Desktop pass; do not mark rows Pass without redacted evidence.

### Environment

| Field | Value |
| --- | --- |
${tableRow(['Generated at', metadata.generatedAt])}
${tableRow(['OS', metadata.os])}
${tableRow(['Node version', metadata.node])}
${tableRow(['Package version', metadata.packageVersion])}
${tableRow(['Git branch', metadata.branch])}
${tableRow(['Git commit', metadata.commit])}
${tableRow(['Worktree state', metadata.worktree])}
| Claude Desktop version |  |
| Inspector version |  |
| Cache state | cold / warm / unchanged |
| Session state | fresh / reused / expired / unavailable |
| Credential scope used | eClass / SIS / Cengage / RMP / none |

### Automated Preflight

| Command | Result | Notes |
| --- | --- | --- |
| \`npm.cmd run doctor\` |  | Read-only local environment check |
| \`npm.cmd run build\` |  | Required before Inspector or Claude Desktop host pass |
| \`npm.cmd run typecheck\` |  | Production TypeScript |
| \`npm.cmd run typecheck:tests\` |  | Test TypeScript |
| \`npm.cmd run lint\` |  | ESLint |
| \`npm.cmd run format:check\` |  | Prettier check |
| \`npm.cmd run test\` |  | Automated unit/protocol/fixture suite |
| \`npm.cmd run test:coverage\` |  | Coverage gate |
| \`npm.cmd pack --dry-run\` |  | Release packaging smoke |
| \`git diff --check\` |  | Whitespace check |

### Tool Surface Inventory

Expected public MCP tool count: 25.

${toolInventory}

### Inspector Smoke Matrix

Launch command:

\`\`\`powershell
npx.cmd @modelcontextprotocol/inspector node dist/index.js
\`\`\`

| # | Tool | Scope | Result | Evidence | Issue # | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| I-0 | tool discovery | no credential |  | Confirm exactly 25 tools, including \`cache_health\` |  | Record schema/listing drift here |
| I-1 | \`list_courses\` | eClass credential |  |  |  | Course list shape only, redact names |
| I-2 | \`get_course_content\` | eClass credential |  |  |  | Use one course ID from I-1 |
| I-3 | \`get_section_text\` | eClass credential |  |  |  | Safe eClass section URL only |
| I-4 | \`get_file_text\` | eClass credential |  |  |  | Safe eClass file URL only |
| I-5 | \`get_assignments\` | eClass plus optional Cengage |  |  |  | Default user-facing assignment/deadline path |
| I-6 | \`get_upcoming_deadlines\` | eClass credential |  |  |  | eClass-only regression row |
| I-7 | \`get_deadlines\` | eClass credential |  |  |  | eClass-only regression row |
| I-8 | \`get_item_details\` | eClass credential |  |  |  | Assignment/quiz/page details |
| I-9 | \`get_grades\` | eClass credential |  |  |  | Redact grade values in evidence |
| I-10 | \`get_announcements\` | eClass credential |  |  |  | Redact names and course context |
| I-11 | \`get_exam_schedule\` | SIS credential |  |  |  | Legitimate no-data is Skip, not Fail |
| I-12 | \`get_class_timetable\` | SIS credential |  |  |  | Legitimate no-data is Skip, not Fail |
| I-13 | \`search_professors\` | RMP upstream |  |  |  | Do not hammer upstream on failures |
| I-14 | \`get_professor_details\` | RMP upstream |  |  |  | Use one ID from I-13 when available |
| I-15 | \`discover_cengage_links\` | eClass/Cengage context |  |  |  | Discovery only, no credential evidence |
| I-16 | \`list_cengage_courses\` | Cengage credential |  |  |  | Direct dashboard link if available |
| I-17 | \`get_cengage_assignments\` | Cengage/WebAssign credential |  |  |  | Direct course URL or selected course |
| I-18 | \`get_cengage_assignment_details\` | Cengage/WebAssign credential |  |  |  | Active-course context must match |
| I-19 | \`cache_health\` | no credential |  |  |  | Read-only; no raw filenames, URLs, or absolute paths |

### Claude Desktop Matrix

| # | Prompt | Expected tool | Result | Evidence | Issue # | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| C-1 | What courses am I enrolled in? | \`list_courses\` |  |  |  | Redact course names if copied verbatim |
| C-2 | List sections and files for course <ID>. | \`get_course_content\` |  |  |  |  |
| C-3 | Open this section URL and summarize the text: <section URL>. | \`get_section_text\` |  |  |  |  |
| C-4 | Read this file: <fileUrl from content>. | \`get_file_text\` |  |  |  |  |
| C-5 | What is due in the next two weeks? | \`get_assignments\` |  |  |  | Cross-platform default |
| C-6 | Check assignments across eClass and Cengage/WebAssign for <course>. | \`get_assignments\` |  |  |  | Auth/activation guidance is acceptable |
| C-7 | Get full details for this assignment URL: <url>. | \`get_item_details\` |  |  |  |  |
| C-8 | What are my grades? | \`get_grades\` |  |  |  | Redact values |
| C-9 | Recent announcements for <course>. | \`get_announcements\` |  |  |  |  |
| C-10 | What are my upcoming exams? | \`get_exam_schedule\` |  |  |  | Skip if no current exam data |
| C-11 | What is my class schedule? | \`get_class_timetable\` |  |  |  | Skip if no current timetable data |
| C-12 | Search RateMyProfessors for professor <name>. | \`search_professors\` |  |  |  | Public data only |
| C-13 | Get professor details for ID <id>. | \`get_professor_details\` |  |  |  | Public data only |
| C-14 | Check local cache health. | \`cache_health\` |  |  |  | No credential, read-only |
| C-S | Force an expired eClass session, then ask for an eClass-only tool. | any eClass tool |  |  |  | Confirm re-auth guidance and recovery |

### Maturity Regression Rows

| # | Area | How to validate | Result | Evidence | Issue # | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| M-1 | Unsafe URL validation | Call \`get_file_text\`, \`get_section_text\`, or \`get_item_details\` with an eclass.yorku.ca.evil.test URL |  |  |  | Expect \`VALIDATION_FAILED\` without upstream navigation |
| M-2 | Cache health | Call \`cache_health\` in Inspector and Claude Desktop |  |  |  | Must be read-only and redacted |
| M-3 | RMP circuit breaker | Optional local mocked evidence only |  |  |  | Do not repeatedly hit live RMP to prove this |
| M-4 | Graceful shutdown | Stop Claude Desktop/Inspector or send SIGINT/SIGTERM |  |  |  | Observe no orphan auth server or browser process |
| M-5 | Trace correlation | Inspect stderr JSON logs during one tool call |  |  |  | Confirm \`requestId\`, \`traceId\`, \`spanId\`, and \`tool\` |
| M-6 | Cache mutation tools | Optional local-state run for \`clear_cache\` and pin tools |  |  |  | Excluded from default pass because they mutate local cache/pins |

### T41/T42 Manual Rows

Keep these rows as Not re-run until a real credentialed pass fills in redacted evidence.

| # | Prompt or tool input | Expected tool | Result | Evidence | Notes |
| --- | --- | --- | --- | --- | --- |
| T41-I1 | \`{ courseCode: "MATH1014", scope: "upcoming" }\` | \`get_assignments\` | Not re-run | N/A | Confirm \`sources\` and \`platformIndex\` fields |
| T41-I2 | \`{ courseCode: "MATH1014", includeExternal: "always" }\` | \`get_assignments\` | Not re-run | N/A | Confirm Cengage check, auth retry, or selected course |
| T41-I3 | Retry with \`platformSelection.cengage.courseKey\` after ambiguous candidates | \`get_assignments\` | Not re-run | N/A | Confirm platform mapping persists |
| T41-I4 | Course with no eClass deadline rows | \`get_deadlines\` | Not re-run | N/A | Confirm \`recommendedTool="get_assignments"\` |
| T41-C1 | What assignments do I have this week? | \`get_assignments\` | Not re-run | N/A | Claude should not stop at eClass-only deadlines |
| T41-C2 | Check MATH 1014 assignments across eClass and Cengage/WebAssign. | \`get_assignments\` | Not re-run | N/A | Missing Cengage auth should surface auth guidance |
| T42-I1 | \`{ entryUrl: "<direct WebAssign URL>", courseKey: "<expected courseKey>" }\` | \`get_cengage_assignments\` | Not re-run | N/A | Direct URL tried first; wrong active course returns \`needs_course_activation\` |
| T42-I2 | \`{ courseCode: "MATH1014", includeExternal: "always" }\` | \`get_assignments\` | Not re-run | N/A | Wrong active WebAssign course returns activation guidance |
| T42-I3 | \`{ courseKey: "<expected courseKey>", assignmentId: "<assignmentId>" }\` | \`get_cengage_assignment_details\` | Not re-run | N/A | Detail extraction verifies active course context |

### Optional Local-State Rows

| # | Tool | Result | Evidence | Notes |
| --- | --- | --- | --- | --- |
| O-1 | \`clear_cache\` |  |  | Optional; use a harmless scope and record cleared/skipped counts |
| O-2 | \`cache_pin\` |  |  | Optional; mutates pin registry |
| O-3 | \`cache_unpin\` |  |  | Optional; mutates pin registry |
| O-4 | \`cache_list_pins\` |  |  | Optional; read-only but depends on local pins |
| O-5 | \`cache_refresh_pin\` |  |  | Optional; may open auth or hit upstream |
| O-6 | \`cache_delete_pinned\` |  |  | Optional; deletes pinned local cache entry |

### Evidence And Redaction Rules

- Paste only short response-shape snippets, not full tool output.
- Redact names, student IDs, grades, course titles, assignment text, cookies, tokens, local usernames, local paths, cache filenames, and raw URLs containing secrets.
- A legitimate no-data response is Pass or Skip when the shape and next action are correct.
- Any Fail row needs an issue number before the run is considered complete.
- This template contains no live evidence until the Result and Evidence columns are filled by a human operator.

### Issues Filed

| Issue # | Row | Summary | Status |
| --- | --- | --- | --- |
|  |  |  |  |
`;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/e2e-template.mjs [options]

Options:
  --phase <label>       Customize the run heading.
  --append              Append the generated empty template to --output.
  --output <path>       Output file for append mode only.
  -h, --help            Show this help.

By default, the template is printed to stdout and no files are modified.
`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const template = generateTemplate(buildMetadata(options.phase));

  if (options.append && options.outputPath) {
    const outputPath = path.resolve(process.cwd(), options.outputPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.appendFileSync(outputPath, `${template}\n`, 'utf8');
    return;
  }

  process.stdout.write(template);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`e2e-template: ${message}\n`);
  process.exitCode = 1;
}
