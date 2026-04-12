import { describe, it, expect } from 'vitest';
import {
  ScrapeLayoutError,
  UpstreamError,
  upstreamErrorFromHttpStatus,
  upstreamErrorFromUnknown,
} from '../src/scraper/eclass';
import { ValidationError } from '../src/errors/validation-error';
import { getDeadlines, getItemDetails } from '../src/tools/deadlines';
import { SessionExpiredError } from '../src/scraper/session';
import { MACHINE_CODES, isMachineCode } from '../src/errors/codes';
import {
  sessionExpiredPayload,
  toErrorPayload,
} from '../src/errors/tool-error';
import { ListCengageCoursesResponseSchema } from '../src/tools/cengage-contracts';
import {
  EclassAuthRequiredSchema,
  EclassToolErrorResponseSchema,
  MachineCodeSchema,
  PinToolJsonPayloadSchema,
  SisExamScheduleResponseSchema,
} from '../src/tools/eclass-contracts';

describe('E12 Phase 1 — SessionExpiredError', () => {
  it('exposes code SESSION_EXPIRED on the class', () => {
    const err = new SessionExpiredError('test');
    expect(err.code).toBe('SESSION_EXPIRED');
  });
});

describe('E12 Phase 2 — ScrapeLayoutError', () => {
  it('exposes code SCRAPE_LAYOUT_CHANGED', () => {
    const err = new ScrapeLayoutError('layout', { page: 'x' });
    expect(err.code).toBe('SCRAPE_LAYOUT_CHANGED');
    const payload = toErrorPayload('SCRAPE_LAYOUT_CHANGED', err.message, {
      details: err.context,
    });
    expect(EclassToolErrorResponseSchema.safeParse(payload).success).toBe(true);
  });
});

describe('E12 Phase 3 — UpstreamError', () => {
  it('maps HTTP status to RATE_LIMITED for 429', () => {
    const err = upstreamErrorFromHttpStatus(429, 'too many');
    expect(err.code).toBe('RATE_LIMITED');
    expect(err.httpStatus).toBe(429);
    const payload = toErrorPayload(err.code, err.message, {
      details: { httpStatus: err.httpStatus },
    });
    expect(EclassToolErrorResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('maps HTTP 408/504 to TIMEOUT', () => {
    expect(upstreamErrorFromHttpStatus(408, 'x').code).toBe('TIMEOUT');
    expect(upstreamErrorFromHttpStatus(504, 'y').code).toBe('TIMEOUT');
    expect(upstreamErrorFromHttpStatus(500, 'z').code).toBe('UPSTREAM_ERROR');
  });

  it('upstreamErrorFromUnknown maps TimeoutError to TIMEOUT', () => {
    const te = new Error('waiting failed');
    te.name = 'TimeoutError';
    const mapped = upstreamErrorFromUnknown(te);
    expect(mapped.code).toBe('TIMEOUT');
  });

  it('UpstreamError validates as tool error payload', () => {
    const err = new UpstreamError('UPSTREAM_ERROR', 'net fail', 502);
    const payload = toErrorPayload(err.code, err.message, {
      details: { httpStatus: err.httpStatus },
    });
    expect(EclassToolErrorResponseSchema.safeParse(payload).success).toBe(true);
  });
});

describe('E12 Phase 4 — VALIDATION_FAILED', () => {
  it('ValidationError exposes code VALIDATION_FAILED', () => {
    const err = new ValidationError('bad', { field: 'url' });
    expect(err.code).toBe('VALIDATION_FAILED');
    const payload = toErrorPayload('VALIDATION_FAILED', err.message, {
      details: err.details,
    });
    expect(EclassToolErrorResponseSchema.safeParse(payload).success).toBe(true);
  });

  it('getDeadlines (scope=range) returns structured error without from/to', async () => {
    const result = await getDeadlines({ scope: 'range' });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('error');
    expect(parsed.code).toBe('VALIDATION_FAILED');
    expect(parsed.message).toMatch(/from and to/i);
    expect(Array.isArray(parsed.details?.missing)).toBe(true);
  });

  it('getItemDetails returns structured error when url is missing', async () => {
    const result = await getItemDetails({} as { url: string });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe('error');
    expect(parsed.code).toBe('VALIDATION_FAILED');
    expect(parsed.details?.field).toBe('url');
  });
});

describe('E12 Phase 0 — machine codes', () => {
  it('MACHINE_CODES is stable and isMachineCode works', () => {
    expect(MACHINE_CODES).toContain('SESSION_EXPIRED');
    expect(isMachineCode('SESSION_EXPIRED')).toBe(true);
    expect(isMachineCode('NOT_A_CODE')).toBe(false);
  });

  it('MachineCodeSchema accepts known codes only', () => {
    expect(MachineCodeSchema.safeParse('SESSION_EXPIRED').success).toBe(true);
    expect(MachineCodeSchema.safeParse('UNKNOWN').success).toBe(false);
  });
});

describe('E12 Phase 0 — tool-error helpers', () => {
  it('sessionExpiredPayload includes code SESSION_EXPIRED', () => {
    const p = sessionExpiredPayload('expired', {
      afterAuth: true,
      authUrl: 'http://localhost:3000/auth',
    });
    expect(p.code).toBe('SESSION_EXPIRED');
    expect(p.status).toBe('auth_required');
    expect(EclassAuthRequiredSchema.safeParse(p).success).toBe(true);
  });

  it('toErrorPayload builds structured error', () => {
    const p = toErrorPayload('VALIDATION_FAILED', 'bad args');
    expect(p.code).toBe('VALIDATION_FAILED');
    expect(p.status).toBe('error');
  });
});

describe('E12 Phase 0 — schemas accept optional code', () => {
  it('PinToolJsonPayloadSchema accepts ok without code', () => {
    expect(
      PinToolJsonPayloadSchema.safeParse({ ok: true, pinId: 'x' }).success
    ).toBe(true);
  });

  it('SisExamScheduleResponseSchema accepts code on error shape', () => {
    expect(
      SisExamScheduleResponseSchema.safeParse({
        status: 'error',
        message: 'x',
        code: 'UPSTREAM_ERROR',
      }).success
    ).toBe(true);
  });

  it('Sis auth_required with SESSION_EXPIRED validates', () => {
    expect(
      SisExamScheduleResponseSchema.safeParse({
        status: 'auth_required',
        code: 'SESSION_EXPIRED',
        message: 'expired',
      }).success
    ).toBe(true);
  });

  it('Cengage list courses auth payload with code validates', () => {
    expect(
      ListCengageCoursesResponseSchema.safeParse({
        status: 'auth_required',
        code: 'SESSION_EXPIRED',
        entryUrl: undefined,
        courses: [],
        message: 'auth',
      }).success
    ).toBe(true);
  });

  it('Pin session_expired shape with code validates', () => {
    expect(
      PinToolJsonPayloadSchema.safeParse({
        ok: false,
        reason: 'session_expired',
        code: 'SESSION_EXPIRED',
        message: 'x',
      }).success
    ).toBe(true);
  });
});
