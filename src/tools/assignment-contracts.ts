import { z } from 'zod';
import { MACHINE_CODES } from '../errors/codes';
import { CengageCourseSummarySchema } from './cengage-contracts';

const optionalMachineCode = z
  .enum(MACHINE_CODES as unknown as [string, ...string[]])
  .optional();

export const GetAssignmentsInputSchema = z.object({
  courseId: z
    .string()
    .optional()
    .describe('Optional eClass course id, preferred when known.'),
  courseCode: z
    .string()
    .optional()
    .describe('Optional course code such as MATH1014 or MATH 1014.'),
  courseQuery: z
    .string()
    .optional()
    .describe('Optional fuzzy course title/name query.'),
  scope: z
    .enum(['upcoming', 'month', 'range'])
    .optional()
    .describe('Assignment scope (default upcoming).'),
  month: z.number().int().min(1).max(12).optional(),
  year: z.number().int().min(2000).max(2100).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  includeDetails: z.boolean().optional(),
  maxDetails: z.number().int().min(0).max(25).optional(),
  includeExternal: z
    .enum(['auto', 'always', 'never'])
    .optional()
    .describe(
      'Controls Cengage/WebAssign checks. Default auto checks when eClass is empty, index says linked, or Cengage auth is already available.'
    ),
  refreshPlatformIndex: z.boolean().optional(),
  platformSelection: z
    .object({
      cengage: z
        .object({
          courseId: z.string().optional(),
          courseKey: z.string().optional(),
          courseQuery: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export const NormalizedAssignmentSchema = z
  .object({
    platform: z.enum(['eclass', 'webassign', 'cengage']),
    sourceTool: z.enum(['get_deadlines', 'get_cengage_assignments']),
    id: z.string().optional(),
    assignmentId: z.string().optional(),
    name: z.string(),
    dueDate: z.string().optional(),
    dueDateIso: z.string().optional(),
    status: z.string().optional(),
    score: z.string().optional(),
    courseId: z.string().optional(),
    courseCode: z.string().optional(),
    courseName: z.string().optional(),
    courseTitle: z.string().optional(),
    url: z.string().optional(),
    type: z.enum(['assign', 'quiz', 'other']).optional(),
    rawText: z.string().optional(),
    dateParseStatus: z.enum(['ok', 'unknown']).optional(),
  })
  .passthrough();

export const AssignmentResolverResponseSchema = z
  .object({
    status: z.enum([
      'ok',
      'partial',
      'needs_external_auth',
      'needs_course_selection',
      'needs_course_activation',
      'no_data',
      'error',
    ]),
    code: optionalMachineCode,
    course: z
      .object({
        id: z.string(),
        name: z.string(),
        courseCode: z.string().optional(),
        url: z.string().optional(),
      })
      .optional(),
    courseCandidates: z.array(z.unknown()).optional(),
    assignments: z.array(NormalizedAssignmentSchema),
    sources: z.object({
      eclass: z.object({
        checked: z.boolean(),
        status: z.string(),
        assignmentCount: z.number().int().min(0),
      }),
      cengage: z.object({
        checked: z.boolean(),
        status: z.string(),
        assignmentCount: z.number().int().min(0),
        selectedCourse: CengageCourseSummarySchema.optional(),
        candidates: z.array(CengageCourseSummarySchema).optional(),
        authUrl: z.string().optional(),
      }),
    }),
    platformIndex: z.object({
      hit: z.boolean(),
      recordId: z.string().optional(),
      mappingStatus: z.string().optional(),
      updated: z.boolean().optional(),
    }),
    message: z.string().optional(),
    retry: z
      .object({
        afterAuth: z.boolean().optional(),
        authUrl: z.string().optional(),
        reason: z.string().optional(),
        input: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    nextActions: z.array(z.string()).optional(),
  })
  .passthrough();

export type GetAssignmentsInput = z.infer<typeof GetAssignmentsInputSchema>;
export type AssignmentResolverResponse = z.infer<
  typeof AssignmentResolverResponseSchema
>;
