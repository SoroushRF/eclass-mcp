import { z } from 'zod';
import { MACHINE_CODES } from '../errors/codes';

/** E12 machine codes — optional on payloads until each path sets `code`. */
export const MachineCodeSchema = z.enum(
  MACHINE_CODES as unknown as [string, ...string[]]
);

const optionalMachineCode = MachineCodeSchema.optional();

/** Matches `CacheMetadata` in cache/store — open for future fields. */
export const EclassCacheMetaSchema = z
  .object({
    hit: z.boolean(),
    fetched_at: z.string(),
    expires_at: z.string(),
    stale: z.boolean().optional(),
  })
  .passthrough();

/** Structured tool error (non-auth), e.g. SCRAPE_LAYOUT_CHANGED (E12). */
export const EclassToolErrorResponseSchema = z
  .object({
    status: z.literal('error'),
    message: z.string(),
    code: MachineCodeSchema,
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** Session / auth hint for eClass tools. */
export const EclassAuthRequiredSchema = z
  .object({
    status: z.literal('auth_required'),
    message: z.string(),
    code: optionalMachineCode,
    retry: z
      .object({
        afterAuth: z.boolean(),
        authUrl: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Most eClass JSON tool bodies: either auth JSON or any object carrying `_cache`
 * (from attachCacheMeta: spread, items, or value).
 */
export const EclassToolJsonPayloadSchema = z.union([
  EclassAuthRequiredSchema,
  z.object({ _cache: EclassCacheMetaSchema }).passthrough(),
]);

/** York SIS structured tool output (exam schedule). */
export const SisExamScheduleResponseSchema = z
  .object({
    status: z.enum(['ok', 'empty', 'auth_required', 'error']),
    message: z.string(),
    code: optionalMachineCode,
    exams: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** York SIS structured tool output (class timetable). */
export const SisTimetableResponseSchema = z
  .object({
    status: z.enum(['ok', 'empty', 'auth_required', 'error']),
    message: z.string(),
    code: optionalMachineCode,
    entries: z.array(z.unknown()).optional(),
  })
  .passthrough();

/** RMP search — machine data + human summary in one JSON object. */
export const RmpSearchToolResponseSchema = z
  .object({
    summary: z.string(),
    matches: z.array(z.unknown()),
    diagnostics: z.unknown().optional(),
    _cache: z.unknown().optional(),
  })
  .passthrough();

/** RMP professor details. */
export const RmpProfessorDetailsToolResponseSchema = z
  .object({
    summary: z.string(),
    professor: z.unknown(),
    recentReviews: z.array(z.unknown()),
    _cache: z.unknown().optional(),
  })
  .passthrough();

export const RmpProfessorNotFoundResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
    code: optionalMachineCode,
  })
  .passthrough();

export const ClearCacheToolResponseSchema = z
  .object({
    ok: z.boolean(),
    message: z.string(),
    code: optionalMachineCode,
    scope: z.string().optional(),
    clearedCount: z.number().optional(),
    isError: z.boolean().optional(),
  })
  .passthrough();

/** Pin tools: unified loose envelope (`ok` discriminant + passthrough). */
export const PinToolJsonPayloadSchema = z
  .object({
    ok: z.boolean(),
    code: optionalMachineCode,
  })
  .passthrough();

const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
});

const imageBlockSchema = z
  .object({
    type: z.literal('image'),
    data: z.string().optional(),
    mimeType: z.string().optional(),
  })
  .passthrough();

/** get_file_text MCP result: content array of text and/or image blocks. */
export const GetFileTextMcpResultSchema = z
  .object({
    content: z.array(z.union([textBlockSchema, imageBlockSchema])),
    isError: z.boolean().optional(),
  })
  .passthrough();

/**
 * Item / deadline metadata JSON in get_item_details (first text block when images/CSV).
 * Highly permissive — Moodle fields evolve.
 */
export const ItemDetailsMetaSchema = z.object({}).passthrough();
