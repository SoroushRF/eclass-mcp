import fs from 'fs';
import path from 'path';
import type { MobileCredential } from '../../session';
import { isMoodleApiError } from './errors';
import { MOODLE_REST_ROUTING_FUNCTIONS } from './rest';
import { MoodleRestSiteInfoSchema } from './types';

/**
 * Account-owner diagnostic for the mobile token path (ADR 0011, Phase 2).
 *
 * The report deliberately carries only shapes: yes/no flags, lengths,
 * Moodle release/version strings, and public function names. It never holds
 * token values, user ids, usernames, site names, or emails.
 */
export interface MobileProbeReport {
  minted: boolean;
  mintError?: string;
  tokenLength?: number;
  tokenIsHex32?: boolean;
  privateTokenPresent?: boolean;
  release?: string;
  version?: string;
  functionCount?: number;
  routing?: Record<string, boolean>;
  restError?: string;
}

export interface MobileProbeDependencies {
  launch: () => Promise<MobileCredential>;
  getSiteInfo: () => Promise<unknown>;
}

export interface MobileProbeResult {
  report: MobileProbeReport;
  /** Sorted public function names; written locally, never printed. */
  functionNames: string[];
}

function errorLabel(error: unknown): string {
  if (isMoodleApiError(error)) {
    return error.upstreamCode
      ? `${error.category}:${error.upstreamCode}`
      : error.category;
  }
  if (error instanceof Error && error.name) return error.name;
  return 'unknown';
}

function safeVersionString(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value)
    .replace(/[^A-Za-z0-9 .:+()_-]/g, '')
    .slice(0, 60);
  return text || undefined;
}

export async function runMobileProbe(
  deps: MobileProbeDependencies
): Promise<MobileProbeResult> {
  let credential: MobileCredential;
  try {
    credential = await deps.launch();
  } catch (error) {
    return {
      report: { minted: false, mintError: errorLabel(error) },
      functionNames: [],
    };
  }

  const report: MobileProbeReport = {
    minted: true,
    tokenLength: credential.token.length,
    tokenIsHex32: /^[a-f0-9]{32}$/i.test(credential.token),
    privateTokenPresent: !!credential.privateToken,
  };

  let raw: unknown;
  try {
    raw = await deps.getSiteInfo();
  } catch (error) {
    report.restError = errorLabel(error);
    return { report, functionNames: [] };
  }

  const parsed = MoodleRestSiteInfoSchema.safeParse(raw);
  if (!parsed.success) {
    report.restError = 'malformed_response';
    return { report, functionNames: [] };
  }

  const record = parsed.data as Record<string, unknown>;
  const functionNames = [
    ...new Set(
      (parsed.data.functions ?? [])
        .map((fn) => fn.name.trim())
        .filter((name) => /^[a-z][a-z0-9_]*$/.test(name))
    ),
  ].sort();
  const available = new Set(functionNames);

  report.release = safeVersionString(record.release);
  report.version = safeVersionString(record.version);
  report.functionCount = functionNames.length;
  report.routing = Object.fromEntries(
    MOODLE_REST_ROUTING_FUNCTIONS.map((name) => [name, available.has(name)])
  );
  return { report, functionNames };
}

export function formatMobileProbeReport(report: MobileProbeReport): string {
  const lines = [
    `minted: ${report.minted ? 'yes' : 'no'}`,
    ...(report.mintError ? [`mint error: ${report.mintError}`] : []),
  ];
  if (report.minted) {
    lines.push(
      `token length: ${report.tokenLength}`,
      `token shape is 32 hex: ${report.tokenIsHex32 ? 'yes' : 'no'}`,
      `private token present: ${report.privateTokenPresent ? 'yes' : 'no'}`
    );
  }
  if (report.restError) lines.push(`REST error: ${report.restError}`);
  if (report.functionCount !== undefined) {
    lines.push(
      `release: ${report.release ?? 'n/a'}`,
      `version: ${report.version ?? 'n/a'}`,
      `function count: ${report.functionCount}`,
      'routing functions:'
    );
    for (const [name, present] of Object.entries(report.routing ?? {})) {
      lines.push(`  ${present ? 'yes' : 'no '}  ${name}`);
    }
  }
  return lines.join('\n');
}

export function writeMobileFunctionList(
  filePath: string,
  functionNames: readonly string[]
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ functions: functionNames }, null, 2)}\n`,
    'utf8'
  );
}
