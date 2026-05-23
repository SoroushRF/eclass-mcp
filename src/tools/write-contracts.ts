import { z } from 'zod';
import { MACHINE_CODES } from '../errors/codes';

const optionalMachineCode = z
  .enum(MACHINE_CODES as unknown as [string, ...string[]])
  .optional();

const LocalFilePathSchema = z
  .string()
  .min(1)
  .refine((value) => !/^https?:\/\//i.test(value), {
    message: 'Upload files must be local filesystem paths, not URLs.',
  });

export const PreflightReferenceSchema = z
  .string()
  .min(1)
  .describe('Opaque signed reference returned by a prepare/preflight tool.');

export const WriteConfirmationSchema = z.object({
  confirm: z
    .literal(true)
    .describe('Must be true for any tool that mutates a remote platform.'),
});

export const IntendedUploadFileInputSchema = z
  .object({
    path: LocalFilePathSchema.describe('Local filesystem path to upload.'),
    displayName: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    mimeType: z.string().optional(),
    sha256: z.string().optional(),
  })
  .passthrough();

export const AssignmentSubmissionPreflightInputSchema = z.object({
  platform: z.enum(['auto', 'eclass', 'cengage']).optional(),
  assignmentUrl: z
    .string()
    .url()
    .optional()
    .describe('Preferred exact eClass assignment URL.'),
  entryUrl: z
    .string()
    .url()
    .optional()
    .describe('Optional Cengage/WebAssign dashboard, LTI, or course URL.'),
  ssoUrl: z
    .string()
    .url()
    .optional()
    .describe('Legacy alias for entryUrl for Cengage/WebAssign flows.'),
  courseId: z.string().optional(),
  courseKey: z.string().optional(),
  courseCode: z.string().optional(),
  courseQuery: z.string().optional(),
  assignmentId: z.string().optional(),
  assignmentQuery: z.string().optional(),
  intendedFiles: z.array(IntendedUploadFileInputSchema).optional(),
});

export const WriteCourseIdentitySchema = z
  .object({
    id: z.string().optional(),
    courseId: z.string().optional(),
    courseCode: z.string().optional(),
    name: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

export const WriteAssignmentIdentitySchema = z
  .object({
    id: z.string().optional(),
    cmId: z.string().optional(),
    url: z.string(),
    title: z.string(),
    dueDate: z.string().optional(),
    dueDateIso: z.string().optional(),
    submissionState: z.string().optional(),
  })
  .passthrough();

export const UploadSlotSchema = z
  .object({
    kind: z.enum(['file', 'online_text', 'unknown']).optional(),
    id: z.string().optional(),
    label: z.string().optional(),
    required: z.boolean().optional(),
    accepts: z.array(z.string()).optional(),
    maxBytes: z.number().int().nonnegative().optional(),
    maxFiles: z.number().int().nonnegative().optional(),
    canUpload: z.boolean().optional(),
    currentFiles: z
      .array(
        z
          .object({
            name: z.string(),
            sizeBytes: z.number().int().nonnegative().optional(),
            mimeType: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export const IntendedUploadFileSummarySchema = z
  .object({
    name: z.string(),
    path: LocalFilePathSchema.optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    mimeType: z.string().optional(),
    sha256: z.string().optional(),
  })
  .passthrough();

export const AssignmentSubmissionPreflightResponseSchema = z
  .object({
    status: z.enum(['ok', 'ambiguous', 'blocked', 'error']),
    code: optionalMachineCode,
    message: z.string().optional(),
    platform: z.enum(['eclass', 'cengage']).optional(),
    writeSupport: z
      .enum([
        'supported',
        'unsupported_external_platform',
        'unsupported_assignment_state',
        'unknown',
      ])
      .optional(),
    submissionMode: z
      .enum(['file_upload', 'online_text', 'mixed', 'none', 'external'])
      .optional(),
    course: WriteCourseIdentitySchema.optional(),
    assignment: WriteAssignmentIdentitySchema.optional(),
    uploadSlots: z.array(UploadSlotSchema).optional(),
    intendedFiles: z.array(IntendedUploadFileSummarySchema).optional(),
    warnings: z.array(z.string()).optional(),
    blockers: z.array(z.string()).optional(),
    candidates: z.array(z.unknown()).optional(),
    retry: z.record(z.string(), z.unknown()).optional(),
    nextActions: z.array(z.string()).optional(),
    targetHash: z.string().optional(),
    preflightRef: PreflightReferenceSchema.optional(),
    expiresAt: z.string().optional(),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.status === 'ok' && !value.preflightRef) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['preflightRef'],
        message: 'status=ok preflight responses must include preflightRef.',
      });
    }
    if (value.status === 'ok' && !value.targetHash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['targetHash'],
        message: 'status=ok preflight responses must include targetHash.',
      });
    }
  });

export const AssignmentSubmissionWriteInputBaseSchema =
  WriteConfirmationSchema.extend({
    preflightRef: PreflightReferenceSchema,
  }).passthrough();

export type AssignmentSubmissionPreflightInput = z.infer<
  typeof AssignmentSubmissionPreflightInputSchema
>;
export type AssignmentSubmissionPreflightResponse = z.infer<
  typeof AssignmentSubmissionPreflightResponseSchema
>;
export type AssignmentSubmissionWriteInputBase = z.infer<
  typeof AssignmentSubmissionWriteInputBaseSchema
>;
