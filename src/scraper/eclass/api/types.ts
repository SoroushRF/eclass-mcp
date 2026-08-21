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

export const MoodleRestCourseModuleSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string().optional(),
    modname: z.string().optional(),
    url: z.string().optional(),
    visible: z.union([z.boolean(), z.number()]).optional(),
    uservisible: z.union([z.boolean(), z.number()]).optional(),
  })
  .passthrough();

export const MoodleRestCourseSectionSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    name: z.string().optional(),
    section: z.number().optional(),
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

export const MoodleRestAssignmentsDataSchema = z
  .object({
    courses: z.array(z.unknown()).default([]),
  })
  .passthrough();

export const MoodleRestForumsDataSchema = z
  .object({
    forums: z.array(z.unknown()).default([]),
  })
  .passthrough();

export const MoodleRestGradeItemsDataSchema = z
  .object({
    usergrades: z.array(z.unknown()).default([]),
  })
  .passthrough();

export type MoodleWireValue = unknown;
