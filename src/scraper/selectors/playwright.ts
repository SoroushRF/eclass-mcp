import fs from 'fs';
import path from 'path';
import type { Locator, Page } from 'playwright';
import { getLogger } from '../../logging/context';
import { ScrapeLayoutError } from '../scrape-errors';
import {
  getSelectorGroup,
  type SelectorCandidate,
  type SelectorGroup,
  type SelectorGroupId,
} from './registry';

const DATA_ROOT = path.resolve(__dirname, '../../../.eclass-mcp');
const SNAPSHOT_ENV = 'ECLASS_MCP_SELECTOR_DEBUG_SNAPSHOTS';
const SNAPSHOT_MAX_CHARS = 1_000_000;

export interface SelectorMatch {
  groupId: SelectorGroupId;
  pageType: string;
  candidateId: string;
  selector: string;
  matchCount: number;
  locator: Locator;
}

export interface SelectorFailureContext {
  [key: string]: unknown;
  pageType: string;
  groupId: SelectorGroupId;
  required: boolean;
  triedSelectors: string[];
  selectorCounts?: Record<string, number>;
  url?: string;
  title?: string;
  snapshotPath?: string;
}

export interface SelectorLookupOptions {
  required?: boolean;
  timeoutMs?: number;
  pageType?: string;
  message?: string;
  snapshotName?: string;
  includeSnapshot?: boolean;
}

function isSnapshotEnabled(): boolean {
  const value = process.env[SNAPSHOT_ENV];
  return value === '1' || value?.toLowerCase() === 'true';
}

function safeFilePart(value: string): string {
  return value
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

async function collectPlaywrightSelectorCounts(
  page: Page,
  candidates: readonly SelectorCandidate[]
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const candidate of candidates) {
    const maybePage = page as Page & {
      locator?: Page['locator'];
    };
    counts[candidate.selector] =
      typeof maybePage.locator === 'function'
        ? await maybePage
            .locator(candidate.selector)
            .count()
            .catch(() => 0)
        : 0;
  }
  return counts;
}

async function writeSelectorDebugSnapshot(
  page: Page,
  group: SelectorGroup,
  context: SelectorFailureContext
): Promise<string | undefined> {
  if (!isSnapshotEnabled()) return undefined;

  try {
    const debugDir = path.join(DATA_ROOT, 'debug', 'selectors');
    fs.mkdirSync(debugDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `${stamp}-${safeFilePart(group.id)}`;
    const htmlPath = path.join(debugDir, `${base}.html`);
    const jsonPath = path.join(debugDir, `${base}.json`);
    const html = await page.content();
    fs.writeFileSync(htmlPath, html.slice(0, SNAPSHOT_MAX_CHARS), {
      mode: 0o600,
    });
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          ...context,
          truncated: html.length > SNAPSHOT_MAX_CHARS,
        },
        null,
        2
      ),
      { mode: 0o600 }
    );
    getLogger().debug({
      event: 'selector_debug_snapshot',
      groupId: group.id,
      pageType: group.pageType,
      snapshotPath: htmlPath,
      metadataPath: jsonPath,
    });
    return htmlPath;
  } catch (error) {
    getLogger().warn({
      event: 'selector_debug_snapshot_failed',
      groupId: group.id,
      pageType: group.pageType,
      err: error,
    });
    return undefined;
  }
}

function logSelectorMatch(match: SelectorMatch, url?: string): void {
  getLogger().debug({
    event: 'selector_match',
    pageType: match.pageType,
    groupId: match.groupId,
    candidateId: match.candidateId,
    selector: match.selector,
    matchCount: match.matchCount,
    url,
  });
}

export function logDomSelectorMatch(params: {
  pageType: string;
  groupId: SelectorGroupId;
  candidateId: string;
  selector: string;
  matchCount: number;
  url?: string;
}): void {
  getLogger().debug({
    event: 'selector_match',
    pageType: params.pageType,
    groupId: params.groupId,
    candidateId: params.candidateId,
    selector: params.selector,
    matchCount: params.matchCount,
    url: params.url,
  });
}

async function buildSelectorFailure(
  page: Page,
  group: SelectorGroup,
  options: SelectorLookupOptions
): Promise<ScrapeLayoutError> {
  const pageType = options.pageType || group.pageType;
  const required = options.required ?? group.required;
  const selectorCounts = await collectPlaywrightSelectorCounts(
    page,
    group.candidates
  );
  const context: SelectorFailureContext = {
    pageType,
    groupId: group.id,
    required,
    triedSelectors: group.candidates.map((candidate) => candidate.selector),
    selectorCounts,
    url: typeof page.url === 'function' ? page.url() : undefined,
    title:
      typeof page.title === 'function'
        ? await page.title().catch(() => undefined)
        : undefined,
  };
  const snapshotPath =
    options.includeSnapshot === false
      ? undefined
      : await writeSelectorDebugSnapshot(page, group, context);
  const finalContext: SelectorFailureContext = snapshotPath
    ? { ...context, snapshotPath }
    : context;

  getLogger().warn({
    event: 'selector_failure',
    ...finalContext,
  });

  return new ScrapeLayoutError(
    options.message ||
      `Page layout changed: no selectors matched for ${group.id}.`,
    finalContext
  );
}

async function findFirst(
  page: Page,
  groupId: SelectorGroupId,
  options: SelectorLookupOptions,
  predicate: (locator: Locator) => Promise<boolean>
): Promise<SelectorMatch | null> {
  const group = getSelectorGroup(groupId);
  for (const candidate of group.candidates) {
    const locator = page.locator(candidate.selector).first();
    const count = await page
      .locator(candidate.selector)
      .count()
      .catch(() => 0);
    if (count === 0) continue;
    if (!(await predicate(locator))) continue;

    const match: SelectorMatch = {
      groupId,
      pageType: options.pageType || group.pageType,
      candidateId: candidate.id,
      selector: candidate.selector,
      matchCount: count,
      locator,
    };
    logSelectorMatch(
      match,
      typeof page.url === 'function' ? page.url() : undefined
    );
    return match;
  }

  if (options.required ?? group.required) {
    throw await buildSelectorFailure(page, group, options);
  }
  return null;
}

export async function findFirstAttached(
  page: Page,
  groupId: SelectorGroupId,
  options: SelectorLookupOptions = {}
): Promise<SelectorMatch | null> {
  return findFirst(page, groupId, options, async () => true);
}

export async function findFirstVisible(
  page: Page,
  groupId: SelectorGroupId,
  options: SelectorLookupOptions = {}
): Promise<SelectorMatch | null> {
  return findFirst(page, groupId, options, (locator) =>
    locator.isVisible().catch(() => false)
  );
}

export async function waitForAnySelector(
  page: Page,
  groupId: SelectorGroupId,
  options: SelectorLookupOptions = {}
): Promise<SelectorMatch | null> {
  const group = getSelectorGroup(groupId);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    const match = await findFirstAttached(page, groupId, {
      ...options,
      required: false,
    });
    if (match) return match;
    await page.waitForTimeout(250).catch(() => undefined);
  }

  if (options.required ?? group.required) {
    throw await buildSelectorFailure(page, group, options);
  }
  return null;
}

export async function throwSelectorLayoutChanged(
  page: Page,
  groupId: SelectorGroupId,
  options: SelectorLookupOptions = {}
): Promise<never> {
  const group = getSelectorGroup(groupId);
  throw await buildSelectorFailure(page, group, {
    ...options,
    required: true,
  });
}
