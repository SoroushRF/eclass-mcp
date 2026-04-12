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
    .optional()
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

export const GetCengageAssignmentsInputSchema = z.object({
  entryUrl: z
    .string()
    .optional()
    .describe(
      'Optional Cengage/WebAssign URL (dashboard, LTI launch, direct course, or login). If omitted, the tool attempts dashboard-first mode from saved session state.'
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
  allCourses: z
    .boolean()
    .optional()
    .describe(
      'If true, aggregate bounded assignment summaries across dashboard courses instead of selecting a single course.'
    ),
  maxCourses: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe(
      'Optional cap for all-courses aggregation mode (default 5, max 10).'
    ),
  maxAssignmentsPerCourse: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe(
      'Optional per-course assignment cap for all-courses aggregation mode (default 10, max 25).'
    ),
});

export const CengageAggregatedCourseSummarySchema =
  CengageCourseSummarySchema.extend({
    status: z.enum(['ok', 'no_data', 'error']),
    assignmentCount: z.number().int().min(0),
    returnedAssignments: z.number().int().min(0),
    truncatedAssignments: z.boolean().optional(),
    message: z.string().optional(),
  });

export const CengageAssignmentsAggregationSchema = z.object({
  mode: z.literal('all_courses'),
  coursesConsidered: z.number().int().min(0),
  coursesProcessed: z.number().int().min(0),
  coursesReturned: z.number().int().min(0),
  truncatedCourses: z.boolean(),
  truncatedAssignments: z.boolean(),
  warnings: z.array(z.string()).optional(),
});

export const GetCengageAssignmentsResponseSchema = z.object({
  status: CengageToolStatusSchema,
  entryUrl: z.string().optional(),
  selectedCourse: CengageCourseSummarySchema.optional(),
  allCourses: z.array(CengageAggregatedCourseSummarySchema).optional(),
  aggregation: CengageAssignmentsAggregationSchema.optional(),
  assignments: z.array(CengageAssignmentSchema),
  message: z.string().optional(),
  retry: CengageRetryGuidanceSchema.optional(),
  _cache: CengageCacheMetaSchema.optional(),
});

export const CengageAssignmentQuestionResultSchema = z.enum([
  'correct',
  'incorrect',
  'partial',
  'ungraded',
  'unknown',
]);

export const CengageAssignmentResourceLinkSchema = z.object({
  label: z.string(),
  url: z.string(),
});

export const CengageAssignmentQuestionSchema = z.object({
  questionNumber: z.number().int().min(1),
  questionId: z.string().optional(),
  prompt: z.string(),
  promptTruncated: z.boolean().optional(),
  answer: z.string().optional(),
  answerTruncated: z.boolean().optional(),
  pointsEarned: z.number().optional(),
  pointsPossible: z.number().optional(),
  submissionsUsed: z.string().optional(),
  result: CengageAssignmentQuestionResultSchema.optional(),
  feedback: z.string().optional(),
  resourceLinks: z.array(CengageAssignmentResourceLinkSchema).optional(),
});

export const CengageAssignmentDetailsSchema = z.object({
  pageTitle: z.string().optional(),
  heading: z.string().optional(),
  questionCount: z.number().int().min(0),
  returnedQuestionCount: z.number().int().min(0),
  truncatedQuestions: z.boolean().optional(),
  questions: z.array(CengageAssignmentQuestionSchema),
});

export const CengageAssignmentSelectionSchema = z.object({
  assignmentId: z.string().optional(),
  name: z.string(),
  dueDate: z.string().optional(),
  dueDateIso: z.string().optional(),
  status: CengageAssignmentStatusSchema,
  score: z.string().optional(),
  url: z.string().optional(),
});

export const GetCengageAssignmentDetailsInputSchema = z.object({
  entryUrl: z
    .string()
    .optional()
    .describe(
      'Optional Cengage/WebAssign URL (dashboard, LTI launch, direct course, or login). If omitted, dashboard-first mode is used from saved session state.'
    ),
  ssoUrl: z
    .string()
    .optional()
    .describe('Legacy alias for entryUrl.'),
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
  assignmentUrl: z
    .string()
    .optional()
    .describe(
      'Optional assignment URL from get_cengage_assignments. Relative and absolute URLs are accepted.'
    ),
  assignmentId: z
    .string()
    .optional()
    .describe('Optional assignment id from get_cengage_assignments.'),
  assignmentQuery: z
    .string()
    .optional()
    .describe('Optional case-insensitive assignment name query.'),
  includeAnswers: z
    .boolean()
    .optional()
    .describe(
      'If true (default), include answer-area text and correctness hints per question.'
    ),
  includeResources: z
    .boolean()
    .optional()
    .describe(
      'If true (default), include per-question resource links (Read It, etc.).'
    ),
  maxQuestions: z
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .describe('Max number of questions to return (default 50).'),
  maxQuestionTextChars: z
    .number()
    .int()
    .min(200)
    .max(10000)
    .optional()
    .describe('Max characters per question prompt (default 2000).'),
  maxAnswerTextChars: z
    .number()
    .int()
    .min(100)
    .max(10000)
    .optional()
    .describe('Max characters per answer text (default 1200).'),
});

export const GetCengageAssignmentDetailsResponseSchema = z.object({
  status: CengageToolStatusSchema,
  entryUrl: z.string().optional(),
  selectedCourse: CengageCourseSummarySchema.optional(),
  selectedAssignment: CengageAssignmentSelectionSchema.optional(),
  availableAssignments: z.array(CengageAssignmentSelectionSchema).optional(),
  details: CengageAssignmentDetailsSchema.optional(),
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

export type GetCengageAssignmentDetailsInput = z.infer<
  typeof GetCengageAssignmentDetailsInputSchema
>;
export type GetCengageAssignmentDetailsResponse = z.infer<
  typeof GetCengageAssignmentDetailsResponseSchema
>;
