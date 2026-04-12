import { describe, it, expect } from 'vitest';
import { MACHINE_CODES, isMachineCode } from '../src/errors/codes';
import { sessionExpiredPayload, toErrorPayload } from '../src/errors/tool-error';
import {
  EclassAuthRequiredSchema,
  MachineCodeSchema,
  PinToolJsonPayloadSchema,
  SisExamScheduleResponseSchema,
} from '../src/tools/eclass-contracts';

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
    expect(PinToolJsonPayloadSchema.safeParse({ ok: true, pinId: 'x' }).success).toBe(
      true
    );
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
});
