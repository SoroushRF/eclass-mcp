import { describe, it, expect } from 'vitest';
import { SessionExpiredError } from '../src/scraper/session';
import { MACHINE_CODES, isMachineCode } from '../src/errors/codes';
import {
  sessionExpiredPayload,
  toErrorPayload,
} from '../src/errors/tool-error';
import { ListCengageCoursesResponseSchema } from '../src/tools/cengage-contracts';
import {
  EclassAuthRequiredSchema,
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
