import { z } from 'zod';

export const MoodleAjaxCallSchema = z
  .object({
    index: z.number().int().nonnegative(),
    methodname: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
  })
  .strict();

export type MoodleAjaxCall = z.infer<typeof MoodleAjaxCallSchema>;

export const MoodleAjaxResponseEntrySchema = z
  .object({
    error: z.boolean(),
    data: z.unknown().optional(),
    exception: z.string().optional(),
    errorcode: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export type MoodleAjaxResponseEntry = z.infer<
  typeof MoodleAjaxResponseEntrySchema
>;

export const MoodleAjaxResponseSchema = z.array(MoodleAjaxResponseEntrySchema);

export type MoodleAjaxResponse = z.infer<typeof MoodleAjaxResponseSchema>;

export const MoodleCourseRecordSchema = z
  .object({
    id: z.union([z.number().int(), z.string().min(1)]),
    fullname: z.string().optional(),
    shortname: z.string().optional(),
    idnumber: z.string().optional(),
    visible: z.union([z.boolean(), z.number()]).optional(),
    startdate: z.number().optional(),
    enddate: z.number().optional(),
  })
  .passthrough();

export type MoodleCourseRecord = z.infer<typeof MoodleCourseRecordSchema>;

export const MoodleEnrolledCoursesDataSchema = z
  .object({
    courses: z.array(MoodleCourseRecordSchema),
    nextoffset: z.number().int().optional(),
  })
  .passthrough();

export type MoodleEnrolledCoursesData = z.infer<
  typeof MoodleEnrolledCoursesDataSchema
>;

export const MoodleCourseFormatCourseSchema = z
  .object({
    id: z.union([z.number().int(), z.string().min(1)]),
    numsections: z.number().int().nonnegative().optional(),
    sectionlist: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const MoodleCourseFormatSectionSchema = z
  .object({
    id: z.union([z.number().int(), z.string().min(1)]).optional(),
    section: z.number().int().nonnegative().optional(),
    number: z.number().int().nonnegative().optional(),
    title: z.string().optional(),
    rawtitle: z.string().optional(),
    visible: z.union([z.boolean(), z.number()]).optional(),
    uservisible: z.union([z.boolean(), z.number()]).optional(),
    cmlist: z.array(z.unknown()).optional(),
  })
  .passthrough();

export type MoodleCourseFormatSection = z.infer<
  typeof MoodleCourseFormatSectionSchema
>;

export const MoodleCourseModuleSchema = z
  .object({
    id: z.union([z.number().int(), z.string().min(1)]),
    name: z.string().optional(),
    visible: z.union([z.boolean(), z.number()]).optional(),
    uservisible: z.union([z.boolean(), z.number()]).optional(),
    stealth: z.union([z.boolean(), z.number()]).optional(),
    sectionid: z.union([z.number(), z.string()]).optional(),
    sectionnumber: z.union([z.number(), z.string()]).optional(),
    modname: z.string().optional(),
    module: z.union([z.number(), z.string()]).optional(),
    plugin: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

export type MoodleCourseModule = z.infer<typeof MoodleCourseModuleSchema>;

export const MoodleCourseFormatStateSchema = z
  .object({
    course: MoodleCourseFormatCourseSchema,
    section: z.array(MoodleCourseFormatSectionSchema).default([]),
    cm: z.array(MoodleCourseModuleSchema).default([]),
  })
  .passthrough();

export type MoodleCourseFormatState = z.infer<
  typeof MoodleCourseFormatStateSchema
>;

export const MoodleCalendarEventSchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional(),
    eventid: z.union([z.number(), z.string()]).optional(),
    name: z.string().optional(),
    timesort: z.number().optional(),
    timestart: z.number().optional(),
    timeduration: z.number().optional(),
    modulename: z.string().optional(),
    activityname: z.string().optional(),
    url: z.string().optional(),
    action: z
      .object({
        url: z.string().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    course: z
      .object({
        id: z.union([z.number(), z.string()]).optional(),
        fullname: z.string().optional(),
        shortname: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type MoodleCalendarEvent = z.infer<typeof MoodleCalendarEventSchema>;

export const MoodleCalendarDataSchema = z
  .object({
    events: z.array(MoodleCalendarEventSchema).default([]),
  })
  .passthrough();

export type MoodleCalendarData = z.infer<typeof MoodleCalendarDataSchema>;

export const MoodleRestSiteInfoSchema = z
  .object({
    sitename: z.string().optional(),
    username: z.string().optional(),
    userid: z.union([z.number(), z.string()]).optional(),
    functions: z.array(z.object({ name: z.string() }).passthrough()).optional(),
  })
  .passthrough();

export type MoodleRestSiteInfo = z.infer<typeof MoodleRestSiteInfoSchema>;

export const MoodleRestErrorEnvelopeSchema = z
  .object({
    exception: z.string().optional(),
    errorcode: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

export type MoodleRestErrorEnvelope = z.infer<
  typeof MoodleRestErrorEnvelopeSchema
>;

/**
 * A file listed in a module's `contents` (resource, folder, page files).
 * Fields are nullable: URL modules send `sortorder: null`.
 */
export const MoodleRestModuleContentSchema = z
  .object({
    type: z.string().nullable().optional(),
    filename: z.string().nullable().optional(),
    fileurl: z.string().nullable().optional(),
    filesize: z.number().nullable().optional(),
    mimetype: z.string().nullable().optional(),
    sortorder: z.number().nullable().optional(),
  })
  .passthrough();

export const MoodleRestCourseModuleSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string().optional(),
    modname: z.string().optional(),
    url: z.string().optional(),
    visible: z.union([z.boolean(), z.number()]).optional(),
    uservisible: z.union([z.boolean(), z.number()]).optional(),
    /** Formatted HTML for modules shown inline, such as labels. */
    description: z.string().optional(),
    contents: z.array(MoodleRestModuleContentSchema).optional(),
  })
  .passthrough();

export const MoodleRestCourseSectionSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string().optional(),
    section: z.number().optional(),
    /** Formatted section summary HTML. */
    summary: z.string().optional(),
    hidden: z.union([z.boolean(), z.number()]).optional(),
    visible: z.union([z.boolean(), z.number()]).optional(),
    uservisible: z.union([z.boolean(), z.number()]).optional(),
    modules: z.array(MoodleRestCourseModuleSchema).default([]),
  })
  .passthrough();

export const MoodleRestCourseContentsSchema = z.array(
  MoodleRestCourseSectionSchema
);

export type MoodleRestCourseContents = z.infer<
  typeof MoodleRestCourseContentsSchema
>;

/** `core_course_get_contents` options such as `cmid` or `sectionnumber`. */
export interface MoodleRestCourseContentsOption {
  name: string;
  value: string | number;
}

export const MoodleRestCourseModuleInfoSchema = z
  .object({
    cm: z
      .object({
        id: z.union([z.number(), z.string()]),
        course: z.union([z.number(), z.string()]),
        modname: z.string(),
        instance: z.union([z.number(), z.string()]),
        name: z.string().optional(),
        sectionnum: z.number().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type MoodleRestCourseModuleInfo = z.infer<
  typeof MoodleRestCourseModuleInfoSchema
>['cm'];

const MoodleId = z.union([z.number(), z.string()]);
const MoodleFlag = z.union([z.boolean(), z.number()]);

/** A stored file as external functions return it (intro files, submissions). */
export const MoodleRestFileSchema = z
  .object({
    filename: z.string().optional(),
    filepath: z.string().optional(),
    fileurl: z.string().optional(),
    filesize: z.number().optional(),
    mimetype: z.string().optional(),
  })
  .passthrough();

export type MoodleRestFile = z.infer<typeof MoodleRestFileSchema>;

export const MoodleRestAssignmentSchema = z
  .object({
    id: MoodleId,
    cmid: MoodleId,
    course: MoodleId.optional(),
    name: z.string().optional(),
    duedate: z.number().optional(),
    cutoffdate: z.number().optional(),
    allowsubmissionsfromdate: z.number().optional(),
    intro: z.string().optional(),
    introfiles: z.array(MoodleRestFileSchema).optional(),
    introattachments: z.array(MoodleRestFileSchema).optional(),
    /** Plugin settings, e.g. assignsubmission/file/maxfilesubmissions. */
    configs: z
      .array(
        z
          .object({
            plugin: z.string(),
            subtype: z.string(),
            name: z.string(),
            value: z.union([z.string(), z.number()]),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export type MoodleRestAssignment = z.infer<typeof MoodleRestAssignmentSchema>;

export const MoodleRestAssignmentsDataSchema = z
  .object({
    courses: z
      .array(
        z
          .object({
            id: MoodleId,
            fullname: z.string().optional(),
            shortname: z.string().optional(),
            assignments: z.array(MoodleRestAssignmentSchema).default([]),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough();

export type MoodleRestAssignmentsData = z.infer<
  typeof MoodleRestAssignmentsDataSchema
>;

/** A submission or feedback plugin: its files and editor text. */
export const MoodleRestAssignPluginSchema = z
  .object({
    type: z.string(),
    name: z.string().optional(),
    fileareas: z
      .array(
        z
          .object({
            area: z.string().optional(),
            files: z.array(MoodleRestFileSchema).optional(),
          })
          .passthrough()
      )
      .optional(),
    editorfields: z
      .array(
        z
          .object({
            name: z.string().optional(),
            text: z.string().optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

export type MoodleRestAssignPlugin = z.infer<
  typeof MoodleRestAssignPluginSchema
>;

const MoodleRestSubmissionRecordSchema = z
  .object({
    status: z.string().optional(),
    timemodified: z.number().optional(),
    plugins: z.array(MoodleRestAssignPluginSchema).optional(),
  })
  .passthrough();

export const MoodleRestSubmissionStatusSchema = z
  .object({
    lastattempt: z
      .object({
        submission: MoodleRestSubmissionRecordSchema.optional(),
        teamsubmission: MoodleRestSubmissionRecordSchema.optional(),
        gradingstatus: z.string().optional(),
        /** Per-student extension (Unix seconds); 0 or absent means none. */
        extensionduedate: z.number().nullable().optional(),
        submissionsenabled: MoodleFlag.optional(),
        locked: MoodleFlag.optional(),
        graded: MoodleFlag.optional(),
        canedit: MoodleFlag.optional(),
        cansubmit: MoodleFlag.optional(),
      })
      .passthrough()
      .optional(),
    feedback: z
      .object({
        gradefordisplay: z.string().optional(),
        plugins: z.array(MoodleRestAssignPluginSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type MoodleRestSubmissionStatus = z.infer<
  typeof MoodleRestSubmissionStatusSchema
>;

export const MoodleRestQuizSchema = z
  .object({
    id: MoodleId,
    coursemodule: MoodleId,
    course: MoodleId.optional(),
    name: z.string().optional(),
    intro: z.string().optional(),
    introfiles: z.array(MoodleRestFileSchema).optional(),
    timeopen: z.number().optional(),
    timeclose: z.number().optional(),
    /** Seconds; 0 means no limit. */
    timelimit: z.number().optional(),
    /** Attempts allowed; 0 means unlimited. */
    attempts: z.number().optional(),
    grade: z.number().optional(),
    decimalpoints: z.number().optional(),
    hasfeedback: MoodleFlag.optional(),
  })
  .passthrough();

export type MoodleRestQuiz = z.infer<typeof MoodleRestQuizSchema>;

export const MoodleRestQuizzesDataSchema = z
  .object({ quizzes: z.array(MoodleRestQuizSchema).default([]) })
  .passthrough();

export type MoodleRestQuizzesData = z.infer<typeof MoodleRestQuizzesDataSchema>;

export const MoodleRestQuizBestGradeSchema = z
  .object({
    hasgrade: z.boolean(),
    grade: z.number().nullable().optional(),
  })
  .passthrough();

export type MoodleRestQuizBestGrade = z.infer<
  typeof MoodleRestQuizBestGradeSchema
>;

export const MoodleRestQuizAttemptsSchema = z
  .object({
    attempts: z
      .array(
        z
          .object({
            id: MoodleId,
            state: z.string().optional(),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough();

export type MoodleRestQuizAttempts = z.infer<
  typeof MoodleRestQuizAttemptsSchema
>;

export const MoodleRestQuizFeedbackSchema = z
  .object({ feedbacktext: z.string().optional() })
  .passthrough();

export type MoodleRestQuizFeedback = z.infer<
  typeof MoodleRestQuizFeedbackSchema
>;

/** `mod_forum_get_forums_by_courses` returns a bare array. */
export const MoodleRestForumsDataSchema = z.array(
  z
    .object({
      id: MoodleId,
      course: MoodleId,
      type: z.string().optional(),
      name: z.string().optional(),
    })
    .passthrough()
);

export type MoodleRestForumsData = z.infer<typeof MoodleRestForumsDataSchema>;

export const MoodleRestForumDiscussionsSchema = z
  .object({
    discussions: z
      .array(
        z
          .object({
            id: MoodleId,
            discussion: MoodleId,
            name: z.string().optional(),
            subject: z.string().optional(),
            message: z.string().optional(),
            created: z.number().optional(),
            timemodified: z.number().optional(),
            userfullname: z.string().optional(),
            pinned: MoodleFlag.optional(),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough();

export type MoodleRestForumDiscussions = z.infer<
  typeof MoodleRestForumDiscussionsSchema
>;

export const MoodleRestGradeItemSchema = z
  .object({
    id: MoodleId.optional(),
    itemname: z.string().nullable().optional(),
    itemtype: z.string().optional(),
    itemmodule: z.string().nullable().optional(),
    gradeformatted: z.string().optional(),
    rangeformatted: z.string().optional(),
    percentageformatted: z.string().optional(),
    feedback: z.string().optional(),
    gradeishidden: MoodleFlag.optional(),
  })
  .passthrough();

export const MoodleRestGradeItemsDataSchema = z
  .object({
    usergrades: z
      .array(
        z
          .object({
            courseid: MoodleId,
            gradeitems: z.array(MoodleRestGradeItemSchema).default([]),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough();

export type MoodleRestGradeItemsData = z.infer<
  typeof MoodleRestGradeItemsDataSchema
>;

export const MoodleRestOverviewGradesSchema = z
  .object({
    grades: z
      .array(
        z
          .object({
            courseid: MoodleId,
            grade: z.string().optional(),
            // Declared PARAM_RAW, but York returns a number for some courses.
            rawgrade: z.union([z.string(), z.number()]).nullable().optional(),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough();

export type MoodleRestOverviewGrades = z.infer<
  typeof MoodleRestOverviewGradesSchema
>;

export const MoodleRestUserCoursesSchema = z.array(
  z
    .object({
      id: MoodleId,
      shortname: z.string().optional(),
      fullname: z.string().optional(),
      idnumber: z.string().optional(),
      visible: MoodleFlag.optional(),
      hidden: MoodleFlag.optional(),
    })
    .passthrough()
);

export type MoodleRestUserCourses = z.infer<typeof MoodleRestUserCoursesSchema>;

export type MoodleWireValue = unknown;
