export type SelectorGroupId =
  | 'eclass.dashboard.course_cards'
  | 'eclass.dashboard.course_links'
  | 'eclass.course.section_summary'
  | 'eclass.course.section_tabs'
  | 'eclass.calendar.upcoming_events'
  | 'eclass.calendar.month_events'
  | 'eclass.files.embedded_resource'
  | 'eclass.files.direct_download_link'
  | 'eclass.assignment.intro'
  | 'eclass.assignment.status_table'
  | 'eclass.quiz.intro'
  | 'eclass.grades.overview_table'
  | 'eclass.grades.user_rows'
  | 'eclass.announcements.forum_link'
  | 'eclass.announcements.topic_rows'
  | 'cengage.dashboard.course_cards'
  | 'cengage.dashboard.launch_links'
  | 'cengage.assignments.containers'
  | 'cengage.assignments.rows'
  | 'cengage.assignments.name'
  | 'cengage.assignments.due_date'
  | 'cengage.assignments.score'
  | 'cengage.assignments.status'
  | 'cengage.assignments.tabs';

export interface SelectorCandidate {
  id: string;
  selector: string;
  description?: string;
}

export interface SelectorGroup {
  id: SelectorGroupId;
  pageType: string;
  required: boolean;
  candidates: readonly SelectorCandidate[];
}

export const SELECTOR_REGISTRY = {
  'eclass.dashboard.course_cards': {
    id: 'eclass.dashboard.course_cards',
    pageType: 'eclass.dashboard',
    required: true,
    candidates: [
      {
        id: 'moove_course_listitem',
        selector: '.course-listitem .coursename',
      },
      { id: 'legacy_coursebox', selector: '.coursebox .coursename a' },
      { id: 'boost_card_body', selector: '.card-body .coursename' },
      { id: 'classic_course_title', selector: '.course_title a' },
    ],
  },
  'eclass.dashboard.course_links': {
    id: 'eclass.dashboard.course_links',
    pageType: 'eclass.dashboard',
    required: false,
    candidates: [
      {
        id: 'course_view_id_link',
        selector: 'a[href*="course/view.php?id="]',
      },
    ],
  },
  'eclass.course.section_summary': {
    id: 'eclass.course.section_summary',
    pageType: 'eclass.course',
    required: false,
    candidates: [
      { id: 'moodle_summary', selector: '.summary' },
      { id: 'course_description', selector: '.course-description' },
      { id: 'section_summary', selector: '.section-summary' },
      { id: 'description', selector: '.description' },
    ],
  },
  'eclass.course.section_tabs': {
    id: 'eclass.course.section_tabs',
    pageType: 'eclass.course',
    required: false,
    candidates: [
      { id: 'bootstrap_nav_links', selector: '.nav-tabs .nav-link' },
      { id: 'aria_tabs', selector: '[role="tablist"] [role="tab"]' },
    ],
  },
  'eclass.calendar.upcoming_events': {
    id: 'eclass.calendar.upcoming_events',
    pageType: 'eclass.calendar',
    required: false,
    candidates: [{ id: 'calendar_event', selector: '.event' }],
  },
  'eclass.calendar.month_events': {
    id: 'eclass.calendar.month_events',
    pageType: 'eclass.calendar',
    required: false,
    candidates: [
      { id: 'calendar_course_event', selector: '.calendar_event_course' },
      { id: 'calendar_day_event', selector: '[data-region="event-item"]' },
      { id: 'calendar_table_event', selector: '.calendar_event' },
      { id: 'calendar_event', selector: '.event' },
    ],
  },
  'eclass.files.embedded_resource': {
    id: 'eclass.files.embedded_resource',
    pageType: 'eclass.files',
    required: false,
    candidates: [
      { id: 'object_data', selector: 'object[data]' },
      { id: 'iframe_src', selector: 'iframe[src]' },
    ],
  },
  'eclass.files.direct_download_link': {
    id: 'eclass.files.direct_download_link',
    pageType: 'eclass.files',
    required: true,
    candidates: [
      { id: 'resource_workaround_link', selector: '.resourceworkaround a' },
      { id: 'workaround_direct_link', selector: 'a[href*="forcedownload=1"]' },
      { id: 'pluginfile_link', selector: 'a[href*="pluginfile.php"]' },
    ],
  },
  'eclass.assignment.intro': {
    id: 'eclass.assignment.intro',
    pageType: 'eclass.assignment',
    required: false,
    candidates: [
      { id: 'description_no_overflow', selector: '.description .no-overflow' },
      { id: 'intro_no_overflow', selector: '#intro .no-overflow' },
      { id: 'assign_intro_attachment', selector: '.activity-description' },
      { id: 'intro', selector: '#intro' },
      { id: 'no_overflow', selector: '.no-overflow' },
    ],
  },
  'eclass.assignment.status_table': {
    id: 'eclass.assignment.status_table',
    pageType: 'eclass.assignment',
    required: false,
    candidates: [
      { id: 'submission_status_table', selector: '.submissionstatustable' },
      { id: 'feedback_table', selector: '.feedbacktable' },
      { id: 'generaltable', selector: '.generaltable' },
    ],
  },
  'eclass.quiz.intro': {
    id: 'eclass.quiz.intro',
    pageType: 'eclass.quiz',
    required: false,
    candidates: [
      { id: 'intro_no_overflow', selector: '#intro .no-overflow' },
      { id: 'intro', selector: '#intro' },
      { id: 'no_overflow', selector: '.no-overflow' },
    ],
  },
  'eclass.grades.overview_table': {
    id: 'eclass.grades.overview_table',
    pageType: 'eclass.grades',
    required: false,
    candidates: [
      { id: 'generic_grade_table', selector: '.generaltable' },
      { id: 'overview_grade', selector: '#overview-grade' },
      { id: 'user_grade', selector: '.user-grade' },
    ],
  },
  'eclass.grades.user_rows': {
    id: 'eclass.grades.user_rows',
    pageType: 'eclass.grades',
    required: false,
    candidates: [{ id: 'table_rows', selector: 'tr' }],
  },
  'eclass.announcements.forum_link': {
    id: 'eclass.announcements.forum_link',
    pageType: 'eclass.announcements',
    required: false,
    candidates: [
      {
        id: 'course_table_forum_link',
        selector: '.generaltable a[href*="mod/forum/view.php"]',
      },
      {
        id: 'forum_link',
        selector: 'a[href*="mod/forum/view.php"]',
      },
    ],
  },
  'eclass.announcements.topic_rows': {
    id: 'eclass.announcements.topic_rows',
    pageType: 'eclass.announcements',
    required: false,
    candidates: [
      { id: 'forum_topic', selector: '.topic' },
      { id: 'forum_discussion', selector: '.discussion' },
    ],
  },
  'cengage.dashboard.course_cards': {
    id: 'cengage.dashboard.course_cards',
    pageType: 'cengage.dashboard',
    required: false,
    candidates: [
      {
        id: 'entitlement_id',
        selector: '[id^="home-page-entitlement-card-"]',
      },
      {
        id: 'entitlement_testid_prefix',
        selector: '[data-testid^="home-page-entitlement-card-"]',
      },
      {
        id: 'entitlement_testid_contains',
        selector: '[data-testid*="home-page-entitlement-card"]',
      },
      {
        id: 'entitlement_datatest_contains',
        selector: '[data-test*="home-page-entitlement-card"]',
      },
      {
        id: 'entitlement_class_contains',
        selector: '[class*="home-page-entitlement-card"]',
      },
    ],
  },
  'cengage.dashboard.launch_links': {
    id: 'cengage.dashboard.launch_links',
    pageType: 'cengage.dashboard',
    required: false,
    candidates: [
      {
        id: 'home_page_launch_class',
        selector: 'a.home-page-launch-course-link[href]',
      },
      {
        id: 'home_page_launch_testid',
        selector: 'a[data-testid="home-page-launch-course-link"][href]',
      },
      {
        id: 'home_page_launch_testid_contains',
        selector: 'a[data-testid*="home-page-launch-course-link"][href]',
      },
      {
        id: 'home_page_launch_datatest',
        selector: 'a[data-test="home-page-launch-course-link"][href]',
      },
      {
        id: 'home_page_launch_datatest_contains',
        selector: 'a[data-test*="home-page-launch-course-link"][href]',
      },
      {
        id: 'home_page_launch_class_contains',
        selector: 'a[class*="home-page-launch-course-link"][href]',
      },
    ],
  },
  'cengage.assignments.containers': {
    id: 'cengage.assignments.containers',
    pageType: 'cengage.assignments',
    required: false,
    candidates: [
      {
        id: 'my_assignments_wrapper',
        selector: '#js-student-myAssignmentsWrapper',
      },
      { id: 'my_assignments_page', selector: '#js-student-myAssignmentsPage' },
      { id: 'my_assignments_id_contains', selector: '[id*="myAssignments"]' },
      {
        id: 'current_assignment_container',
        selector: '[data-test="currentAssignmentContainer"]',
      },
      {
        id: 'past_assignment_container',
        selector: '[data-test="pastAssignmentContainer"]',
      },
      {
        id: 'all_assignment_container',
        selector: '[data-test="allAssignmentContainer"]',
      },
      {
        id: 'testid_assignment_container',
        selector: '[data-testid*="assignment"][data-testid*="container"]',
      },
      {
        id: 'my_assignments_testid',
        selector: '[data-testid="my-assignments"]',
      },
      { id: 'assignment_e2e', selector: '[data-e2e*="assignment"]' },
      { id: 'assignments_aria_label', selector: '[aria-label*="Assignments"]' },
    ],
  },
  'cengage.assignments.rows': {
    id: 'cengage.assignments.rows',
    pageType: 'cengage.assignments',
    required: false,
    candidates: [
      { id: 'assignment_id', selector: '[data-assignment-id]' },
      {
        id: 'assignment_datatest_row',
        selector: 'tr[data-test^="assignment_"]',
      },
      {
        id: 'assignment_testid_row',
        selector: '[data-testid*="assignment-row"]',
      },
      { id: 'assignment_row_class', selector: '.assignment-row' },
      { id: 'assignment_li_class', selector: 'li[class*="assignment"]' },
      { id: 'assignment_tr_class', selector: 'tr[class*="assignment"]' },
      { id: 'li_role_row', selector: 'li[role="row"]' },
      { id: 'tr_role_row', selector: 'tr[role="row"]' },
      { id: 'generic_li', selector: 'li' },
      { id: 'generic_tr', selector: 'tr' },
    ],
  },
  'cengage.assignments.name': {
    id: 'cengage.assignments.name',
    pageType: 'cengage.assignments',
    required: false,
    candidates: [
      {
        id: 'assignment_link_datatest',
        selector: '[data-test^="assignment_link_"]',
      },
      {
        id: 'assignment_title_testid',
        selector: '[data-testid*="assignment-title"]',
      },
      { id: 'assignment_title_class', selector: '.assignment-title' },
      { id: 'assignment_href', selector: 'a[href*="assignment"]' },
      { id: 'homework_href', selector: 'a[href*="homework"]' },
      { id: 'strong', selector: 'strong' },
      { id: 'bold', selector: 'b' },
      { id: 'heading_3', selector: 'h3' },
      { id: 'heading_4', selector: 'h4' },
      { id: 'first_cell_link', selector: 'td:first-child a' },
      { id: 'first_cell', selector: 'td:first-child' },
    ],
  },
  'cengage.assignments.due_date': {
    id: 'cengage.assignments.due_date',
    pageType: 'cengage.assignments',
    required: false,
    candidates: [
      { id: 'due_datatest', selector: '[data-test="due"]' },
      { id: 'due_testid', selector: '[data-testid*="due"]' },
      { id: 'due_class', selector: '[class*="due"]' },
      { id: 'time_datetime', selector: 'time[datetime]' },
      { id: 'time', selector: 'time' },
      { id: 'date_cell', selector: 'td[class*="date"]' },
    ],
  },
  'cengage.assignments.score': {
    id: 'cengage.assignments.score',
    pageType: 'cengage.assignments',
    required: false,
    candidates: [
      { id: 'score_datatest', selector: '[data-test="score"]' },
      { id: 'score_testid', selector: '[data-testid*="score"]' },
      { id: 'score_class', selector: '[class*="score"]' },
      { id: 'grade_class', selector: '[class*="grade"]' },
      { id: 'score_cell', selector: 'td[class*="score"]' },
      { id: 'grade_cell', selector: 'td[class*="grade"]' },
    ],
  },
  'cengage.assignments.status': {
    id: 'cengage.assignments.status',
    pageType: 'cengage.assignments',
    required: false,
    candidates: [
      { id: 'status_datatest', selector: '[data-test="status"]' },
      { id: 'status_testid', selector: '[data-testid*="status"]' },
      { id: 'status_class', selector: '[class*="status"]' },
      { id: 'submission_class', selector: '[class*="submission"]' },
      { id: 'status_cell', selector: 'td[class*="status"]' },
    ],
  },
  'cengage.assignments.tabs': {
    id: 'cengage.assignments.tabs',
    pageType: 'cengage.assignments',
    required: false,
    candidates: [
      {
        id: 'past_assignments_button_analytics',
        selector: 'button[data-analytics="past-assignments-tab"]',
        description: 'Past Assignments',
      },
      {
        id: 'past_assignments_tab_analytics',
        selector: '[role="tab"][data-analytics="past-assignments-tab"]',
        description: 'Past Assignments',
      },
      {
        id: 'past_assignments_tab_aria',
        selector: '[role="tab"][aria-label*="Past Assignments"]',
        description: 'Past Assignments',
      },
      {
        id: 'past_assignments_button_aria',
        selector: 'button[aria-label*="Past Assignments"]',
        description: 'Past Assignments',
      },
      {
        id: 'past_assignments_tab_text',
        selector: '[role="tab"]:has-text("Past Assignments")',
        description: 'Past Assignments',
      },
      {
        id: 'past_assignments_button_text',
        selector: 'button:has-text("Past Assignments")',
        description: 'Past Assignments',
      },
      {
        id: 'all_assignments_button_analytics',
        selector: 'button[data-analytics="all-assignments-tab"]',
        description: 'All Assignments',
      },
      {
        id: 'all_assignments_tab_analytics',
        selector: '[role="tab"][data-analytics="all-assignments-tab"]',
        description: 'All Assignments',
      },
      {
        id: 'all_assignments_tab_aria',
        selector: '[role="tab"][aria-label*="All Assignments"]',
        description: 'All Assignments',
      },
      {
        id: 'all_assignments_button_aria',
        selector: 'button[aria-label*="All Assignments"]',
        description: 'All Assignments',
      },
      {
        id: 'all_assignments_tab_text',
        selector: '[role="tab"]:has-text("All Assignments")',
        description: 'All Assignments',
      },
      {
        id: 'all_assignments_button_text',
        selector: 'button:has-text("All Assignments")',
        description: 'All Assignments',
      },
    ],
  },
} satisfies Record<SelectorGroupId, SelectorGroup>;

export function getSelectorGroup(groupId: SelectorGroupId): SelectorGroup {
  return SELECTOR_REGISTRY[groupId];
}

export function selectorsFor(groupId: SelectorGroupId): string[] {
  return getSelectorGroup(groupId).candidates.map(
    (candidate) => candidate.selector
  );
}

export function selectorCandidateIdFor(
  groupId: SelectorGroupId,
  selector: string
): string | undefined {
  return getSelectorGroup(groupId).candidates.find(
    (candidate) => candidate.selector === selector
  )?.id;
}
