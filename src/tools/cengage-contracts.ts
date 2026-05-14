import { z } from 'zod';
import { MACHINE_CODES } from '../errors/codes';

const CengageOptionalMachineCode = z
  .enum(MACHINE_CODES as unknown as [string, ...string[]])
  .optional();

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
  code: CengageOptionalMachineCode,
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
  code: CengageOptionalMachineCode,
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
  code: CengageOptionalMachineCode,
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

export const CengageAssignmentPromptSectionSchema = z.object({
  title: z.string().optional(),
  text: z.string(),
  truncated: z.boolean().optional(),
});

export const CengageAssignmentCompletenessLevelSchema = z.enum([
  'complete',
  'partial',
  'truncated',
]);

export const CengageAssignmentInteractiveAssetKindSchema = z.enum([
  'iframe',
  'iframe_graph',
  'math_widget',
  'simulation_widget',
  'embed',
  'object',
  'canvas',
  'svg',
  'unknown_widget',
]);

export const CengageAssignmentInteractiveAssetSchema = z.object({
  kind: CengageAssignmentInteractiveAssetKindSchema,
  tagName: z.string(),
  sourceUrl: z.string().optional(),
  id: z.string().optional(),
  classes: z.array(z.string()).optional(),
  title: z.string().optional(),
  ariaLabel: z.string().optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  unsupported: z.boolean().optional(),
});

export const CengageAssignmentMediaAssetKindSchema = z.enum([
  'image',
  'video',
  'audio',
  'canvas',
  'svg',
]);

export const CengageAssignmentMediaAssetSchema = z.object({
  kind: CengageAssignmentMediaAssetKindSchema,
  tagName: z.string(),
  sourceUrl: z.string().optional(),
  altText: z.string().optional(),
  title: z.string().optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
});

export const CengageAssignmentMediaClassificationSchema = z.enum([
  'text',
  'image',
]);

export const CengageAssignmentRenderedMediaAssetSchema = z.object({
  kind: z.literal('question_region_png'),
  mimeType: z.literal('image/png'),
  data: z.string(),
  byteSize: z.number().int().min(0),
  captureDpi: z.number().int().min(72),
});

export const CengageAssignmentRenderedMediaSummarySchema = z.object({
  processedQuestionCount: z.number().int().min(0),
  renderedImageCount: z.number().int().min(0),
  skippedImageCount: z.number().int().min(0),
  maxRenderedImages: z.number().int().min(1),
  maxCaptureUnits: z.number().int().min(1),
  maxCapturePerQuestion: z.number().int().min(1),
  maxPayloadBytes: z.number().int().min(1),
  captureDpi: z.number().int().min(72),
  minTextForSafeText: z.number().int().min(1),
  truncatedCaptureUnits: z.boolean().optional(),
});

export const CengageAssignmentExtractionOverviewSchema = z.object({
  mode: z.literal('text_with_rendered_media_fallback'),
  startNote: z.string(),
  endNote: z.string(),
  truncated: z.boolean(),
});

export const CengageAssignmentQuestionSchema = z.object({
  questionNumber: z.number().int().min(1),
  questionId: z.string().optional(),
  prompt: z.string(),
  promptSections: z.array(CengageAssignmentPromptSectionSchema).optional(),
  hasMediaCarriers: z.boolean().optional(),
  mediaClassification: CengageAssignmentMediaClassificationSchema.optional(),
  interactiveAssets: z
    .array(CengageAssignmentInteractiveAssetSchema)
    .optional(),
  mediaAssets: z.array(CengageAssignmentMediaAssetSchema).optional(),
  renderedMedia: z.array(CengageAssignmentRenderedMediaAssetSchema).optional(),
  renderedMediaWarning: z.string().optional(),
  extractionWarnings: z.array(z.string()).optional(),
  completenessLevel: CengageAssignmentCompletenessLevelSchema.optional(),
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
  extractionWarnings: z.array(z.string()).optional(),
  completenessLevel: CengageAssignmentCompletenessLevelSchema.optional(),
  extractionOverview: CengageAssignmentExtractionOverviewSchema.optional(),
  renderedMediaSummary: CengageAssignmentRenderedMediaSummarySchema.optional(),
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
  ssoUrl: z.string().optional().describe('Legacy alias for entryUrl.'),
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
  includeAssetInventory: z
    .boolean()
    .optional()
    .describe(
      'If true (default), include additive per-question interactiveAssets/mediaAssets inventory metadata.'
    ),
  includeRenderedMedia: z
    .boolean()
    .optional()
    .describe(
      'If true (default), run PDF-parity rendered-media capture on image-classified question regions with strict caps and text fallback.'
    ),
  maxRenderedImages: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Max rendered question-region images (default 20).'),
  maxCaptureUnits: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('Max capture-eligible question regions processed (default 50).'),
  maxCapturePerQuestion: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe(
      'Max rendered captures per question region (default 1, additive safety knob).'
    ),
  maxInteractiveAssets: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe(
      'Max interactiveAssets inventory records captured per question (default 10).'
    ),
  maxMediaAssets: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe(
      'Max mediaAssets inventory records captured per question (default 10).'
    ),
  maxMediaPayloadBytes: z
    .number()
    .int()
    .min(10000)
    .max(800 * 1024)
    .optional()
    .describe(
      'Max encoded media payload budget for rendered captures (default 800KB).'
    ),
  minTextForSafeText: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .optional()
    .describe(
      'Prompt text-length threshold used by parity classifier; if media exists and text is below this threshold, question is image-classified (default 250).'
    ),
  captureDpi: z
    .number()
    .int()
    .min(72)
    .max(200)
    .optional()
    .describe(
      'Capture DPI metadata target for rendered question-region images (default 100).'
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
  code: CengageOptionalMachineCode,
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
