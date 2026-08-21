import coursesFixture from './fixtures/eclass-api/ajax-courses.json';
import courseStateFixture from './fixtures/eclass-api/ajax-course-state.json';
import calendarFixture from './fixtures/eclass-api/ajax-calendar.json';
import { describe, expect, it } from 'vitest';
import {
  isMoodleCourseContentComplete,
  mapMoodleCalendarToAssignments,
  mapMoodleCalendarToDeadlineItems,
  mapMoodleCourseContent,
  mapMoodleCourses,
  mapMoodleCoursesToMap,
} from '../src/scraper/eclass/api/mappers';
import {
  MoodleAjaxResponseSchema,
  MoodleCalendarDataSchema,
  MoodleCourseFormatStateSchema,
  MoodleEnrolledCoursesDataSchema,
} from '../src/scraper/eclass/api/types';

const ORIGIN = 'https://eclass.yorku.ca';

describe('Moodle anti-corruption mappers', () => {
  it('maps enrolled Moodle records into the existing Course model', () => {
    const response = MoodleAjaxResponseSchema.parse(coursesFixture)[0];
    const data = MoodleEnrolledCoursesDataSchema.parse(response?.data);

    expect(mapMoodleCourses(data, ORIGIN)).toEqual([
      {
        id: '101',
        name: 'Sample Course A',
        url: 'https://eclass.yorku.ca/course/view.php?id=101',
      },
      {
        id: '202',
        name: 'Sample Course B',
        url: 'https://eclass.yorku.ca/course/view.php?id=202',
      },
    ]);
  });

  it('maps course-format sections/modules and discards off-origin URLs', () => {
    const response = MoodleAjaxResponseSchema.parse(courseStateFixture)[0];
    const state = MoodleCourseFormatStateSchema.parse(
      JSON.parse(response?.data as string)
    );
    state.cm[0]!.url = 'https://evil.example.invalid/steal';

    const content = mapMoodleCourseContent(state, 101, ORIGIN);

    expect(content.courseId).toBe('101');
    expect(content.sections).toEqual([
      {
        title: 'General',
        items: [
          {
            type: 'resource',
            name: 'Sample resource',
            url: 'https://eclass.yorku.ca/mod/resource/view.php?id=11',
          },
        ],
      },
    ]);
  });

  it('filters hidden sections/modules and reports incomplete lazy state', () => {
    const response = MoodleAjaxResponseSchema.parse(courseStateFixture)[0];
    const state = MoodleCourseFormatStateSchema.parse(
      JSON.parse(response?.data as string)
    );
    state.cm.push({
      id: 12,
      name: 'Hidden resource',
      visible: 0,
      sectionid: 1,
      modname: 'resource',
    });
    state.section.push({
      id: 2,
      section: 1,
      title: 'Hidden section',
      visible: false,
    });

    expect(mapMoodleCourseContent(state, 101, ORIGIN).sections).toHaveLength(1);
    expect(isMoodleCourseContentComplete(state)).toBe(true);
    expect(
      isMoodleCourseContentComplete({
        ...state,
        course: { id: state.course.id },
      })
    ).toBe(true);
    expect(
      isMoodleCourseContentComplete({
        ...state,
        course: { ...state.course, numsections: 3 },
      })
    ).toBe(false);
  });

  it('maps calendar events to assignment/deadline models with stable dates', () => {
    const response = MoodleAjaxResponseSchema.parse(calendarFixture)[0];
    const calendar = MoodleCalendarDataSchema.parse(response?.data);

    const assignments = mapMoodleCalendarToAssignments(calendar, ORIGIN);
    const deadlines = mapMoodleCalendarToDeadlineItems(calendar, ORIGIN);

    expect(assignments[0]).toMatchObject({
      id: '7001',
      name: 'Sample assignment',
      dueDate: '2026-05-28T20:26:40.000Z',
      courseId: '101',
      courseName: 'Sample Course A',
      url: 'https://eclass.yorku.ca/mod/assign/view.php?id=11',
    });
    expect(deadlines[0]?.type).toBe('assign');
    expect(deadlines[0]?.courseCode).toBeUndefined();
  });

  it('filters non-assignment calendar events like the Playwright deadline path', () => {
    const data = {
      events: [
        {
          name: 'General event',
          modulename: 'calendar',
          timestart: 1780000000,
          url: 'https://eclass.yorku.ca/calendar/view.php?view=day',
        },
      ],
    };

    expect(
      mapMoodleCalendarToAssignments(
        MoodleCalendarDataSchema.parse(data),
        ORIGIN
      )
    ).toEqual([]);
  });

  it('normalizes fallback fields, module classifications, and unassigned modules', () => {
    const state = MoodleCourseFormatStateSchema.parse({
      course: { id: 404 },
      section: [
        {
          id: 10,
          section: 0,
          title: '',
          rawtitle: '',
          cmlist: [{ id: 1 }, 2, 7],
        },
        {
          id: 11,
          number: 2,
          rawtitle: '  Week two  ',
          cmlist: [4],
        },
        {
          id: 12,
          title: '',
          cmlist: [5],
        },
        {
          id: 13,
          title: 'Hidden',
          visible: 0,
        },
      ],
      cm: [
        { id: 1, modname: 'assign', sectionid: 10 },
        { id: 2, name: 'Forum', modname: 'forum', sectionnumber: 0 },
        {
          id: 4,
          name: 'URL activity',
          plugin: 'url',
          sectionnumber: 2,
        },
        { id: 5, modname: 'folder', sectionid: 12 },
        {
          id: 7,
          name: 'Cengage link',
          modname: 'resource',
          sectionid: 10,
          url: 'https://cengage.example.invalid/tool/#fragment',
        },
        { id: 6, modname: 'quiz', name: undefined },
        { id: 9 },
        { id: 8, modname: 'resource', uservisible: 0 },
      ],
    });

    const content = mapMoodleCourseContent(state, 404, ORIGIN);

    expect(content.sections).toEqual([
      {
        title: 'General',
        items: [
          {
            type: 'assign',
            name: 'Activity 1',
            url: `${ORIGIN}/mod/assign/view.php?id=1`,
          },
          {
            type: 'announcement',
            name: 'Forum',
            url: `${ORIGIN}/mod/forum/view.php?id=2`,
          },
          {
            type: 'resource',
            name: 'Cengage link',
            url: `${ORIGIN}/mod/resource/view.php?id=7`,
          },
        ],
      },
      {
        title: 'Week two',
        items: [
          {
            type: 'url',
            name: 'URL activity',
            url: `${ORIGIN}/mod/url/view.php?id=4`,
          },
        ],
      },
      {
        title: 'Section 12',
        items: [
          {
            type: 'resource',
            name: 'Activity 5',
            url: `${ORIGIN}/mod/folder/view.php?id=5`,
          },
        ],
      },
      {
        title: 'Other',
        items: [
          {
            type: 'other',
            name: 'Activity 6',
            url: `${ORIGIN}/mod/quiz/view.php?id=6`,
          },
          {
            type: 'resource',
            name: 'Activity 9',
            url: `${ORIGIN}/mod/resource/view.php?id=9`,
          },
        ],
      },
    ]);
    expect(content.external_platforms).toEqual([
      {
        name: 'cengage',
        url: `${ORIGIN}/mod/resource/view.php?id=7`,
        signal: 'resource_activity',
      },
    ]);
  });

  it('uses course and calendar fallback values safely', () => {
    const courses = mapMoodleCourses(
      {
        courses: [
          { id: 303, shortname: '  BIO 303  ', idnumber: 'ID-303' },
          { id: '404', fullname: '   ', idnumber: 'ID-404' },
        ],
      },
      ORIGIN
    );

    expect(courses).toEqual([
      {
        id: '303',
        name: 'BIO 303',
        courseCode: 'BIO303',
        url: `${ORIGIN}/course/view.php?id=303`,
      },
      {
        id: '404',
        name: 'Course 404',
        courseCode: 'ID-404',
        url: `${ORIGIN}/course/view.php?id=404`,
      },
    ]);

    const calendar = MoodleCalendarDataSchema.parse({
      events: [
        {
          eventid: 'event-1',
          name: '  ',
          timesort: -1,
          modulename: 'quiz',
          course: { id: 303, shortname: 'BIO 303' },
          action: { url: 'https://outside.example.invalid/item' },
        },
        {
          name: 'Quiz with invalid date',
          timestart: Number.MAX_SAFE_INTEGER,
          modulename: 'quiz',
          course: { id: 303 },
        },
        {
          name: 'Assignment without module metadata',
          url: `${ORIGIN}/mod/assign/view.php?id=77`,
        },
      ],
    });

    expect(mapMoodleCalendarToAssignments(calendar, ORIGIN)).toEqual([
      {
        id: 'event-1',
        name: 'Untitled deadline',
        dueDate: '',
        status: 'Upcoming',
        courseId: '303',
        courseName: 'BIO 303',
        courseCode: 'BIO303',
        url: `${ORIGIN}/mod/quiz/view.php?id=event-1`,
      },
      {
        id: '303:Quiz with invalid date:9007199254740991',
        name: 'Quiz with invalid date',
        dueDate: '',
        status: 'Upcoming',
        courseId: '303',
        url: `${ORIGIN}/mod/quiz/view.php?id=`,
      },
      {
        id: ':Assignment without module metadata:',
        name: 'Assignment without module metadata',
        dueDate: '',
        status: 'Upcoming',
        courseId: '',
        url: `${ORIGIN}/mod/assign/view.php?id=77`,
      },
    ]);
  });

  it('rejects unsafe API origins and exposes course maps', () => {
    expect(() =>
      mapMoodleCourses({ courses: [] }, 'http://eclass.yorku.ca')
    ).toThrow(/HTTPS origin/);
    expect(() =>
      mapMoodleCourses({ courses: [] }, 'https://user:pass@eclass.yorku.ca')
    ).toThrow(/HTTPS origin/);

    const mapped = mapMoodleCoursesToMap(
      { courses: [{ id: 101, fullname: 'Sample Course' }] },
      ORIGIN
    );
    expect(mapped.get('101')).toMatchObject({
      id: '101',
      name: 'Sample Course',
    });

    const malformedUrlState = MoodleCourseFormatStateSchema.parse({
      course: { id: 101 },
      section: [{ id: 1, section: 0, cmlist: [1] }],
      cm: [{ id: 1, url: 'http://[bad' }],
    });
    expect(
      mapMoodleCourseContent(malformedUrlState, 101, ORIGIN).sections[0]
        ?.items[0]?.url
    ).toBe(`${ORIGIN}/mod/resource/view.php?id=1`);

    const duplicatePlatformState = MoodleCourseFormatStateSchema.parse({
      course: { id: 101 },
      section: [{ id: 1, section: 0, cmlist: [1, 2] }],
      cm: [
        {
          id: 1,
          name: 'Cengage',
          modname: 'resource',
          sectionid: 1,
          url: `${ORIGIN}/mod/resource/view.php?id=shared`,
        },
        {
          id: 2,
          name: 'Cengage',
          modname: 'resource',
          sectionid: 1,
          url: `${ORIGIN}/mod/resource/view.php?id=shared`,
        },
      ],
    });
    expect(
      mapMoodleCourseContent(duplicatePlatformState, 101, ORIGIN)
        .external_platforms
    ).toHaveLength(1);
  });
});
