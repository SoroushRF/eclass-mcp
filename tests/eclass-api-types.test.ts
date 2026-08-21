import coursesFixture from './fixtures/eclass-api/ajax-courses.json';
import courseStateFixture from './fixtures/eclass-api/ajax-course-state.json';
import calendarFixture from './fixtures/eclass-api/ajax-calendar.json';
import errorFixture from './fixtures/eclass-api/ajax-errors.json';
import { describe, expect, it } from 'vitest';
import {
  MoodleAjaxCallSchema,
  MoodleAjaxResponseSchema,
  MoodleCalendarDataSchema,
  MoodleCourseFormatStateSchema,
  MoodleEnrolledCoursesDataSchema,
} from '../src/scraper/eclass/api/types';

describe('typed Moodle wire contracts', () => {
  it('validates the batched AJAX envelope and sanitized course fixture', () => {
    const calls = MoodleAjaxCallSchema.array().parse([
      {
        index: 0,
        methodname:
          'core_course_get_enrolled_courses_by_timeline_classification',
        args: { classification: 'all', limit: 0, offset: 0, sort: 'fullname' },
      },
    ]);
    const responses = MoodleAjaxResponseSchema.parse(coursesFixture);
    const data = MoodleEnrolledCoursesDataSchema.parse(responses[0]?.data);

    expect(calls[0]?.args).toMatchObject({ classification: 'all' });
    expect(data.courses).toHaveLength(2);
    expect(data.courses[0]?.id).toBe(101);
  });

  it('keeps course-format state stringified at the envelope boundary', () => {
    const responses = MoodleAjaxResponseSchema.parse(courseStateFixture);
    const stateString = responses[0]?.data;
    expect(typeof stateString).toBe('string');
    const state = MoodleCourseFormatStateSchema.parse(
      JSON.parse(stateString as string)
    );

    expect(state.course.numsections).toBe(2);
    expect(state.cm[0]?.plugin).toBe('mod_resource');
  });

  it('validates calendar events and error entries without accepting malformed data', () => {
    const calendarResponses = MoodleAjaxResponseSchema.parse(calendarFixture);
    const calendar = MoodleCalendarDataSchema.parse(calendarResponses[0]?.data);
    const errors = MoodleAjaxResponseSchema.parse(errorFixture);

    expect(calendar.events[0]?.course?.id).toBe(101);
    expect(errors[0]?.errorcode).toBe('servicenotavailable');
    expect(() =>
      MoodleEnrolledCoursesDataSchema.parse({ courses: [{ fullname: 'bad' }] })
    ).toThrow();
  });
});
