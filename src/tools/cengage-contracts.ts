import { z } from 'zod';

export const CengageToolStatusSchema = z.enum([
  'ok',
  'auth_required',
  'needs_course_selection',
  'no_data',
  'error',
]);

export const CengageCacheMetaSchema = z.object({
  hit: z.boolean(),
  fetched_at: z.string(),
  expires_at: z.string(),
  stale: z.boolean().optional(),
});

export const CengageRetryGuidanceSchema = z.object({
  afterAuth: z.boolean(),
  authUrl: z.string().optional(),
  reason: z
    .enum([
      'session_missing',
      'session_stale',
      'login_required',
      'auth_required',
    ])
    .optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});

export const CengageLinkTypeSchema = z.enum([
  'eclass_lti',
  'webassign_course',
  'webassign_dashboard',
  'cengage_dashboard',
  'cengage_login',
  'other',
]);

export const CengageLinkSourceSchema = z.enum([
  'manual',
  'course_content',
  'section_text',
  'announcement',
  'item_details',
  'file_text',
  'unknown',
]);

export const CengageDiscoveredLinkSchema = z.object({
  rawUrl: z.string(),
  normalizedUrl: z.string(),
  linkType: CengageLinkTypeSchema,
  source: CengageLinkSourceSchema,
  sourceHint: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  sourceFile: z
    .object({
      fileName: z.string().optional(),
      fileUrl: z.string().optional(),
      fileType: z.enum(['pdf', 'docx', 'pptx', 'other']).optional(),
      blockIndex: z.number().int().min(0).optional(),
    })
    .optional(),
});

export const DiscoverCengageLinksInputSchema = z.object({
  text: z
    .string()
    .min(1)
    .describe(
      'Raw text or URL content to scan for Cengage/WebAssign links (manual paste or extracted eClass content).'
    ),
  source: CengageLinkSourceSchema.optional().describe(
    'Optional source category of the provided text.'
  ),
  courseId: z.string().optional(),
  sectionUrl: z.string().optional(),
  sourceFile: z
    .object({
      fileName: z.string().optional(),
      fileUrl: z.string().optional(),
      fileType: z.enum(['pdf', 'docx', 'pptx', 'other']).optional(),
      blockIndex: z.number().int().min(0).optional(),
    })
    .optional()
    .describe(
      'Optional metadata for links discovered from extracted file text.'
    ),
});

export const DiscoverCengageLinksResponseSchema = z.object({
  status: CengageToolStatusSchema,
  links: z.array(CengageDiscoveredLinkSchema),
  message: z.string().optional(),
  retry: CengageRetryGuidanceSchema.optional(),
  _cache: CengageCacheMetaSchema.optional(),
});

export const CengageCourseSummarySchema = z.object({
  courseId: z.string().optional(),
  courseKey: z.string().optional(),
  title: z.string(),
  launchUrl: z.string(),
  platform: z.enum(['webassign', 'cengage']).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const ListCengageCoursesInputSchema = z.object({
  entryUrl: z
    .string()
    .min(1)
    .describe('A Cengage/WebAssign dashboard, launch, or course URL to open.'),
  discoveredLink: CengageDiscoveredLinkSchema.optional().describe(
    'Optional link candidate output from discover_cengage_links.'
  ),
  courseQuery: z
    .string()
    .optional()
    .describe('Optional text query to pre-filter matching courses.'),
});

export const ListCengageCoursesResponseSchema = z.object({
  status: CengageToolStatusSchema,
  entryUrl: z.string().optional(),
  courses: z.array(CengageCourseSummarySchema),
  message: z.string().optional(),
  retry: CengageRetryGuidanceSchema.optional(),
  _cache: CengageCacheMetaSchema.optional(),
});

export const CengageAssignmentStatusSchema = z.enum([
  'pending',
  'submitted',
  'graded',
  'unknown',
]);

export const CengageAssignmentSchema = z.object({
  assignmentId: z.string().optional(),
  courseId: z.string().optional(),
  courseTitle: z.string().optional(),
  name: z.string(),
  dueDate: z.string().optional(),
  dueDateIso: z.string().optional(),
  status: CengageAssignmentStatusSchema,
  score: z.string().optional(),
  url: z.string().optional(),
  rawText: z.string().optional(),
});

export const GetCengageAssignmentsInputSchema = z
  .object({
    entryUrl: z
      .string()
      .optional()
      .describe(
        'Any Cengage/WebAssign URL (dashboard, LTI launch, direct course, or login).'
      ),
    ssoUrl: z
      .string()
      .optional()
      .describe(
        'Legacy alias for entryUrl used by existing get_cengage_assignments calls.'
      ),
    courseId: z
      .string()
      .optional()
      .describe('Optional explicit course id when multiple courses exist.'),
    courseKey: z
      .string()
      .optional()
      .describe('Optional explicit WebAssign course key when available.'),
    courseQuery: z
      .string()
      .optional()
      .describe(
        'Optional course name query when selecting among multiple courses.'
      ),
  })
  .refine((value) => !!(value.entryUrl || value.ssoUrl), {
    message: 'entryUrl or ssoUrl is required',
  });

export const GetCengageAssignmentsLegacyInputSchema = z.object({
  ssoUrl: z
    .string()
    .describe('Legacy LTI/SSO URL extracted from eClass or Cengage dashboard.'),
});

export const GetCengageAssignmentsResponseSchema = z.object({
  status: CengageToolStatusSchema,
  entryUrl: z.string().optional(),
  selectedCourse: CengageCourseSummarySchema.optional(),
  assignments: z.array(CengageAssignmentSchema),
  message: z.string().optional(),
  retry: CengageRetryGuidanceSchema.optional(),
  _cache: CengageCacheMetaSchema.optional(),
});

export type DiscoverCengageLinksInput = z.infer<
  typeof DiscoverCengageLinksInputSchema
>;
export type DiscoverCengageLinksResponse = z.infer<
  typeof DiscoverCengageLinksResponseSchema
>;

export type ListCengageCoursesInput = z.infer<
  typeof ListCengageCoursesInputSchema
>;
export type ListCengageCoursesResponse = z.infer<
  typeof ListCengageCoursesResponseSchema
>;

export type GetCengageAssignmentsInput = z.infer<
  typeof GetCengageAssignmentsInputSchema
>;
export type GetCengageAssignmentsResponse = z.infer<
  typeof GetCengageAssignmentsResponseSchema
>;
