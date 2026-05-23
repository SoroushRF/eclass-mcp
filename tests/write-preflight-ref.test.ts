import { afterEach, describe, expect, it } from 'vitest';
import { SecureSessionStorageError } from '../src/security/secure-session-store';
import {
  AssignmentSubmissionPreflightInputSchema,
  AssignmentSubmissionPreflightResponseSchema,
  AssignmentSubmissionWriteInputBaseSchema,
  WriteConfirmationSchema,
} from '../src/tools/write-contracts';
import {
  WritePreflightRefError,
  computePreflightTargetHash,
  createPreflightRef,
  verifyPreflightRef,
} from '../src/tools/write-preflight-ref';

const originalSessionSecret = process.env.ECLASS_MCP_SESSION_SECRET;
const testSecret = 'x'.repeat(32);

function setSecret(value = testSecret) {
  process.env.ECLASS_MCP_SESSION_SECRET = value;
}

function restoreSecret() {
  if (originalSessionSecret === undefined) {
    delete process.env.ECLASS_MCP_SESSION_SECRET;
  } else {
    process.env.ECLASS_MCP_SESSION_SECRET = originalSessionSecret;
  }
}

afterEach(() => {
  restoreSecret();
});

describe('write preflight reference signing', () => {
  it('creates and verifies a valid preflight reference', () => {
    setSecret();
    const now = new Date('2026-05-15T12:00:00.000Z');
    const { ref, payload } = createPreflightRef({
      now,
      nonce: 'fixed-nonce',
      targetFacts: {
        course: { id: '101', code: 'MATH1014' },
        assignment: {
          url: 'https://eclass.yorku.ca/mod/assign/view.php?id=55',
          title: 'Lab 1',
          dueDate: '2026-05-20',
          submissionState: 'Draft',
        },
      },
    });

    const verified = verifyPreflightRef(ref, {
      now: new Date('2026-05-15T12:05:00.000Z'),
    });

    expect(verified).toEqual(payload);
    expect(verified.tool).toBe('prepare_assignment_submission');
    expect(verified.targetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects a tampered reference without accepting the payload', () => {
    setSecret();
    const { ref } = createPreflightRef({
      targetFacts: { assignment: { title: 'Original' } },
    });
    const parts = ref.split('.');
    const signature = parts[2];
    const replacement = signature.startsWith('A') ? 'B' : 'A';
    parts[2] = `${replacement}${signature.slice(1)}`;
    const tampered = parts.join('.');

    expect(() => verifyPreflightRef(tampered)).toThrow(WritePreflightRefError);
    try {
      verifyPreflightRef(tampered);
    } catch (error) {
      expect((error as WritePreflightRefError).code).toBe(
        'WRITE_PREFLIGHT_REQUIRED'
      );
    }
  });

  it('rejects expired references with WRITE_PREFLIGHT_EXPIRED', () => {
    setSecret();
    const { ref } = createPreflightRef({
      now: new Date('2026-05-15T12:00:00.000Z'),
      ttlMs: 1000,
      targetFacts: { assignment: { title: 'Timed quiz' } },
    });

    expect(() =>
      verifyPreflightRef(ref, {
        now: new Date('2026-05-15T12:00:01.001Z'),
      })
    ).toThrow(WritePreflightRefError);

    try {
      verifyPreflightRef(ref, {
        now: new Date('2026-05-15T12:00:01.001Z'),
      });
    } catch (error) {
      expect((error as WritePreflightRefError).code).toBe(
        'WRITE_PREFLIGHT_EXPIRED'
      );
    }
  });

  it('requires ECLASS_MCP_SESSION_SECRET and rejects weak secrets', () => {
    delete process.env.ECLASS_MCP_SESSION_SECRET;
    expect(() =>
      createPreflightRef({ targetFacts: { assignment: { title: 'A' } } })
    ).toThrow(SecureSessionStorageError);

    process.env.ECLASS_MCP_SESSION_SECRET = 'too-short';
    expect(() =>
      createPreflightRef({ targetFacts: { assignment: { title: 'A' } } })
    ).toThrow(SecureSessionStorageError);
  });

  it('fails verification when the local secret changes', () => {
    setSecret('a'.repeat(32));
    const { ref } = createPreflightRef({
      targetFacts: { assignment: { title: 'Secret-bound' } },
    });

    setSecret('b'.repeat(32));
    expect(() => verifyPreflightRef(ref)).toThrow(WritePreflightRefError);
  });
});

describe('write preflight target hashing and contracts', () => {
  it('hashes equivalent normalized target facts identically', () => {
    const left = computePreflightTargetHash({
      assignment: {
        title: 'Lab 1',
        dueDate: '2026-05-20',
        submissionState: 'Draft',
      },
      course: { code: 'MATH1014', id: '101' },
    });
    const right = computePreflightTargetHash({
      course: { id: '101', code: 'MATH1014', ignored: undefined },
      assignment: {
        submissionState: 'Draft',
        dueDate: '2026-05-20',
        title: 'Lab 1',
      },
    });

    expect(right).toBe(left);
  });

  it('changes target hash when important platform or file facts change', () => {
    const base = {
      course: { id: '101', code: 'MATH1014' },
      assignment: {
        title: 'Lab 1',
        dueDate: '2026-05-20',
        submissionState: 'Draft',
      },
      intendedFiles: [{ name: 'answer.pdf', sizeBytes: 10 }],
    };

    expect(
      computePreflightTargetHash({
        ...base,
        assignment: { ...base.assignment, dueDate: '2026-05-21' },
      })
    ).not.toBe(computePreflightTargetHash(base));

    expect(
      computePreflightTargetHash({
        ...base,
        intendedFiles: [{ name: 'answer.pdf', sizeBytes: 11 }],
      })
    ).not.toBe(computePreflightTargetHash(base));
  });

  it('requires literal confirm true for write inputs', () => {
    expect(WriteConfirmationSchema.safeParse({ confirm: true }).success).toBe(
      true
    );
    expect(WriteConfirmationSchema.safeParse({ confirm: false }).success).toBe(
      false
    );
    expect(
      AssignmentSubmissionWriteInputBaseSchema.safeParse({
        preflightRef: 'preflight.payload.signature',
        confirm: true,
      }).success
    ).toBe(true);
    expect(
      AssignmentSubmissionWriteInputBaseSchema.safeParse({
        preflightRef: 'preflight.payload.signature',
        confirm: false,
      }).success
    ).toBe(false);
  });

  it('accepts local intended file paths but rejects URL uploads', () => {
    expect(
      AssignmentSubmissionPreflightInputSchema.safeParse({
        platform: 'eclass',
        assignmentUrl: 'https://eclass.yorku.ca/mod/assign/view.php?id=55',
        intendedFiles: [{ path: 'C:\\tmp\\answer.pdf' }],
      }).success
    ).toBe(true);
    expect(
      AssignmentSubmissionPreflightInputSchema.safeParse({
        platform: 'cengage',
        entryUrl: 'https://www.cengage.com/dashboard/home',
        courseKey: 'WA-123',
        assignmentQuery: 'Homework 1',
      }).success
    ).toBe(true);
    expect(
      AssignmentSubmissionPreflightInputSchema.safeParse({
        intendedFiles: [{ path: 'https://example.com/answer.pdf' }],
      }).success
    ).toBe(false);
  });

  it('requires preflightRef and targetHash on ok preflight responses', () => {
    expect(
      AssignmentSubmissionPreflightResponseSchema.safeParse({
        status: 'ok',
        platform: 'cengage',
        writeSupport: 'unsupported_external_platform',
        submissionMode: 'external',
        assignment: {
          url: 'https://eclass.yorku.ca/mod/assign/view.php?id=55',
          title: 'Lab 1',
        },
        warnings: ['Cengage/WebAssign is read-only for now.'],
        targetHash: 'abc',
        preflightRef: 'preflight.payload.signature',
      }).success
    ).toBe(true);

    expect(
      AssignmentSubmissionPreflightResponseSchema.safeParse({
        status: 'ok',
        assignment: {
          url: 'https://eclass.yorku.ca/mod/assign/view.php?id=55',
          title: 'Lab 1',
        },
      }).success
    ).toBe(false);
  });
});
