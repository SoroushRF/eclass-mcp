import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authServer from '../src/auth/server';
import { cache, getCacheKey } from '../src/cache/store';
import { scraper, SessionExpiredError } from '../src/scraper/eclass';
import { SISScraper } from '../src/scraper/sis';
import { listCourses } from '../src/tools/courses';
import { getExamSchedule, getClassTimetable } from '../src/tools/sis';

function parsePayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  cache.invalidate(getCacheKey('courses'));
});

afterEach(() => {
  cache.invalidate(getCacheKey('courses'));
  vi.restoreAllMocks();
});

describe('auth retry tool behavior', () => {
  it('list_courses retries once after eClass auth completes', async () => {
    const coursesSpy = vi
      .spyOn(scraper, 'getCourses')
      .mockRejectedValueOnce(new SessionExpiredError('expired'))
      .mockResolvedValueOnce([
        {
          id: '101',
          fullname: 'Test Course',
          shortname: 'TEST101',
          url: 'https://eclass.yorku.ca/course/view.php?id=101',
        },
      ] as any);
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForAuthSession').mockResolvedValue(true);

    const payload = parsePayload(await listCourses());

    expect(payload.courses).toHaveLength(1);
    expect(payload._cache.hit).toBe(false);
    expect(coursesSpy).toHaveBeenCalledTimes(2);
    expect(openAuthSpy).toHaveBeenCalledWith('eclass');
  });

  it('list_courses returns auth_required when eClass auth wait times out', async () => {
    vi.spyOn(scraper, 'getCourses').mockRejectedValue(
      new SessionExpiredError('expired')
    );
    const openAuthSpy = vi
      .spyOn(authServer, 'openAuthWindow')
      .mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForAuthSession').mockResolvedValue(false);
    vi.spyOn(authServer, 'getAuthUrl').mockReturnValue(
      'http://localhost:3000/auth'
    );

    const payload = parsePayload(await listCourses());

    expect(payload.status).toBe('auth_required');
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.retry?.authUrl).toBe('http://localhost:3000/auth');
    expect(openAuthSpy).toHaveBeenCalledTimes(1);
  });

  it('get_exam_schedule retries once after eClass/SIS auth completes', async () => {
    const examsSpy = vi
      .spyOn(SISScraper.prototype, 'scrapeExams')
      .mockRejectedValueOnce(new SessionExpiredError('expired'))
      .mockResolvedValueOnce([
        {
          courseCode: 'EECS 1010',
          section: 'A',
          courseTitle: 'Intro',
          date: '2026-04-20',
          startTime: '9:00 AM',
          durationMinutes: 180,
          campus: 'Keele',
          rooms: 'CLH A',
        },
      ]);
    vi.spyOn(authServer, 'openAuthWindow').mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForAuthSession').mockResolvedValue(true);

    const payload = parsePayload(await getExamSchedule());

    expect(payload.status).toBe('ok');
    expect(payload.exams).toHaveLength(1);
    expect(examsSpy).toHaveBeenCalledTimes(2);
  });

  it('get_class_timetable returns auth_required when auth wait times out', async () => {
    vi.spyOn(SISScraper.prototype, 'scrapeTimetable').mockRejectedValue(
      new SessionExpiredError('expired')
    );
    vi.spyOn(authServer, 'openAuthWindow').mockImplementation(() => undefined);
    vi.spyOn(authServer, 'waitForAuthSession').mockResolvedValue(false);
    vi.spyOn(authServer, 'getAuthUrl').mockReturnValue(
      'http://localhost:3000/auth'
    );

    const payload = parsePayload(await getClassTimetable());

    expect(payload.status).toBe('auth_required');
    expect(payload.code).toBe('SESSION_EXPIRED');
    expect(payload.retry?.authUrl).toBe('http://localhost:3000/auth');
  });
});
