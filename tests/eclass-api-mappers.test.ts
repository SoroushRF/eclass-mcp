import coursesFixture from './fixtures/eclass-api/ajax-courses.json';
import courseStateFixture from './fixtures/eclass-api/ajax-course-state.json';
import calendarFixture from './fixtures/eclass-api/ajax-calendar.json';
import { describe, expect, it } from 'vitest';
import {
  mapMoodleCalendarToAssignments,
  mapMoodleCalendarToDeadlineItems,
  mapMoodleCourseContent,
  mapMoodleCourses,
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
});
