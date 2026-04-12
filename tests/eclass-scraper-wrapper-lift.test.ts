import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructedSession: null as any,
  session: {
    close: vi.fn(async () => undefined),
  },
  getCourses: vi.fn(async () => [{ id: '101', name: 'MATH 1010' }]),
  getCourseContent: vi.fn(async () => ({ courseId: '101', sections: [] })),
  getDeadlines: vi.fn(async () => [{ id: 'd1' }]),
  getMonthDeadlines: vi.fn(async () => [{ id: 'm1', type: 'assign' }]),
  getAllAssignmentDeadlines: vi.fn(async () => [{ id: 'a1', type: 'assign' }]),
  getItemDetails: vi.fn(async () => ({ kind: 'assign', url: 'u' })),
  getAssignmentDetails: vi.fn(async () => ({ kind: 'assign', url: 'u' })),
  getQuizDetails: vi.fn(async () => ({ kind: 'quiz', url: 'u' })),
  getGrades: vi.fn(async () => [{ courseId: '101', itemName: 'Final' }]),
  getAnnouncements: vi.fn(async () => [{ id: 'n1' }]),
  downloadFile: vi.fn(async () => ({ filename: 'f.pdf' })),
  getSectionText: vi.fn(async () => ({ url: 'u', title: 'Section', tabs: [] })),
}));

vi.mock('../src/scraper/eclass/browser-session', () => ({
  EClassBrowserSession: class MockEClassBrowserSession {
    close = mocks.session.close;

    constructor() {
      mocks.constructedSession = this;
    }
  },
}));

vi.mock('../src/scraper/eclass/courses', () => ({
  getCourses: mocks.getCourses,
  getCourseContent: mocks.getCourseContent,
}));

vi.mock('../src/scraper/eclass/deadlines', () => ({
  getDeadlines: mocks.getDeadlines,
  getMonthDeadlines: mocks.getMonthDeadlines,
  getAllAssignmentDeadlines: mocks.getAllAssignmentDeadlines,
}));

vi.mock('../src/scraper/eclass/item-details', () => ({
  getItemDetails: mocks.getItemDetails,
  getAssignmentDetails: mocks.getAssignmentDetails,
  getQuizDetails: mocks.getQuizDetails,
}));

vi.mock('../src/scraper/eclass/grades', () => ({
  getGrades: mocks.getGrades,
}));

vi.mock('../src/scraper/eclass/announcements', () => ({
  getAnnouncements: mocks.getAnnouncements,
}));

vi.mock('../src/scraper/eclass/files', () => ({
  downloadFile: mocks.downloadFile,
}));

vi.mock('../src/scraper/eclass/sections', () => ({
  getSectionText: mocks.getSectionText,
}));

import { EClassScraper } from '../src/scraper/eclass/EClassScraper';

describe('EClassScraper wrapper delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates all methods to module-level scraper functions', async () => {
    const scraper = new EClassScraper();
    const delegatedSession = mocks.constructedSession;

    await scraper.getCourses();
    await scraper.getCourseContent('101');
    await scraper.getDeadlines('101');
    await scraper.getMonthDeadlines(3, 2026, '101');
    await scraper.getAllAssignmentDeadlines('101');
    await scraper.getItemDetails(
      'https://eclass.yorku.ca/mod/assign/view.php?id=1'
    );
    await scraper.getAssignmentDetails(
      'https://eclass.yorku.ca/mod/assign/view.php?id=1'
    );
    await scraper.getQuizDetails(
      'https://eclass.yorku.ca/mod/quiz/view.php?id=2'
    );
    await scraper.getGrades('101');
    await scraper.getAnnouncements('101');
    await scraper.downloadFile(
      'https://eclass.yorku.ca/pluginfile.php/1/doc.pdf'
    );
    await scraper.getSectionText(
      'https://eclass.yorku.ca/mod/page/view.php?id=3'
    );

    expect(mocks.getCourses).toHaveBeenCalledWith(delegatedSession);
    expect(mocks.getCourseContent).toHaveBeenCalledWith(
      delegatedSession,
      '101'
    );
    expect(mocks.getDeadlines).toHaveBeenCalledWith(delegatedSession, '101');
    expect(mocks.getMonthDeadlines).toHaveBeenCalledWith(
      delegatedSession,
      3,
      2026,
      '101'
    );
    expect(mocks.getAllAssignmentDeadlines).toHaveBeenCalledWith(
      delegatedSession,
      '101'
    );
    expect(mocks.getItemDetails).toHaveBeenCalledWith(
      delegatedSession,
      'https://eclass.yorku.ca/mod/assign/view.php?id=1'
    );
    expect(mocks.getAssignmentDetails).toHaveBeenCalledWith(
      delegatedSession,
      'https://eclass.yorku.ca/mod/assign/view.php?id=1'
    );
    expect(mocks.getQuizDetails).toHaveBeenCalledWith(
      delegatedSession,
      'https://eclass.yorku.ca/mod/quiz/view.php?id=2'
    );
    expect(mocks.getGrades).toHaveBeenCalledWith(delegatedSession, '101');
    expect(mocks.getAnnouncements).toHaveBeenCalledWith(
      delegatedSession,
      '101',
      10
    );
    expect(mocks.downloadFile).toHaveBeenCalledWith(
      delegatedSession,
      'https://eclass.yorku.ca/pluginfile.php/1/doc.pdf'
    );
    expect(mocks.getSectionText).toHaveBeenCalledWith(
      delegatedSession,
      'https://eclass.yorku.ca/mod/page/view.php?id=3'
    );
  });

  it('passes explicit announcement limit and closes browser session', async () => {
    const scraper = new EClassScraper();

    await scraper.getAnnouncements(undefined, 25);
    await scraper.close();

    expect(mocks.getAnnouncements).toHaveBeenCalledWith(
      mocks.session,
      undefined,
      25
    );
    expect(mocks.session.close).toHaveBeenCalledTimes(1);
  });
});
