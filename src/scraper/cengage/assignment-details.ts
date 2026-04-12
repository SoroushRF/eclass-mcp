import type { Page } from 'playwright';

export type CengageQuestionResult =
  | 'correct'
  | 'incorrect'
  | 'partial'
  | 'ungraded'
  | 'unknown';

export interface ExtractAssignmentDetailsOptions {
  maxQuestions?: number;
  maxQuestionTextChars?: number;
  maxAnswerTextChars?: number;
  includeAnswers?: boolean;
  includeResources?: boolean;
}

export interface ExtractedAssignmentResourceLink {
  label: string;
  url: string;
}

export interface ExtractedAssignmentPromptSection {
  title?: string;
  text: string;
  truncated?: boolean;
}

export interface ExtractedAssignmentQuestion {
  questionNumber: number;
  questionId?: string;
  prompt: string;
  promptSections?: ExtractedAssignmentPromptSection[];
  promptTruncated?: boolean;
  answer?: string;
  answerTruncated?: boolean;
  pointsEarned?: number;
  pointsPossible?: number;
  submissionsUsed?: string;
  result?: CengageQuestionResult;
  feedback?: string;
  resourceLinks?: ExtractedAssignmentResourceLink[];
}

export interface ExtractedAssignmentDetails {
  pageTitle?: string;
  heading?: string;
  assignmentName?: string;
  questionCount: number;
  returnedQuestionCount: number;
  truncatedQuestions?: boolean;
  questions: ExtractedAssignmentQuestion[];
}

const DEFAULT_MAX_QUESTIONS = 50;
const DEFAULT_MAX_QUESTION_TEXT_CHARS = 2000;
const DEFAULT_MAX_ANSWER_TEXT_CHARS = 1200;

export async function extractAssignmentDetails(
  page: Page,
  options: ExtractAssignmentDetailsOptions = {}
): Promise<ExtractedAssignmentDetails> {
  const maxQuestions = Number.isFinite(options.maxQuestions)
    ? Math.max(1, Math.trunc(options.maxQuestions as number))
    : DEFAULT_MAX_QUESTIONS;

  const maxQuestionTextChars = Number.isFinite(options.maxQuestionTextChars)
    ? Math.max(200, Math.trunc(options.maxQuestionTextChars as number))
    : DEFAULT_MAX_QUESTION_TEXT_CHARS;

  const maxAnswerTextChars = Number.isFinite(options.maxAnswerTextChars)
    ? Math.max(100, Math.trunc(options.maxAnswerTextChars as number))
    : DEFAULT_MAX_ANSWER_TEXT_CHARS;

  const includeAnswers = options.includeAnswers !== false;
  const includeResources = options.includeResources !== false;

  return page.evaluate(
    ({
      maxQuestions: maxQuestionsArg,
      maxQuestionTextChars: maxQuestionTextCharsArg,
      maxAnswerTextChars: maxAnswerTextCharsArg,
      includeAnswers: includeAnswersArg,
      includeResources: includeResourcesArg,
    }) => {
      const normalizeText = (value: string | null | undefined): string =>
        (value || '').replace(/\s+/g, ' ').trim();

      const toPositiveInt = (value: string | null | undefined): number => {
        const parsed = Number.parseInt(
          normalizeText(value).replace(/\D+/g, ''),
          10
        );
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      };

      const toNumber = (value: unknown): number | undefined => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }

        if (typeof value === 'string') {
          const cleaned = value.replace(/[^0-9.+-]/g, '');
          const parsed = Number(cleaned);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }

        return undefined;
      };

      const truncateText = (value: string, maxChars: number) => {
        if (value.length <= maxChars) {
          return { text: value, truncated: false };
        }

        return {
          text: `${value.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`,
          truncated: true,
        };
      };

      const cleanPromptContent = (source: Element | null): HTMLElement | null => {
        if (!source) {
          return null;
        }

        const clone = source.cloneNode(true) as HTMLElement;
        clone
          .querySelectorAll(
            'script, style, noscript, template, [id^="question_resources_"], [id^="question_help_container_"], [id^="help-buttons-for-"], [id^="blue-buttons-for-"], [id^="student_assistant_button_"], .questionResources, .resourceHelpLinks, .help-buttons-paragraph'
          )
          .forEach((node) => node.remove());

        return clone;
      };

      const splitPromptByPartMarkers = (
        value: string
      ): ExtractedAssignmentPromptSection[] => {
        const markerRegex = /Part\s+(\d+)\s+of\s+(\d+)\s*-\s*/gi;
        const matches = Array.from(value.matchAll(markerRegex));
        if (matches.length === 0) {
          return [];
        }

        const sections: ExtractedAssignmentPromptSection[] = [];
        const intro = normalizeText(value.slice(0, matches[0]?.index || 0));
        if (intro) {
          sections.push({ title: 'Overview', text: intro });
        }

        for (let i = 0; i < matches.length; i++) {
          const current = matches[i];
          const start = current.index || 0;
          const end =
            i + 1 < matches.length
              ? (matches[i + 1].index || value.length)
              : value.length;
          const text = normalizeText(value.slice(start, end));
          if (!text) {
            continue;
          }

          sections.push({
            title: `Part ${current[1]} of ${current[2]}`,
            text,
          });
        }

        return sections;
      };

      const buildPromptSections = (
        promptContainer: HTMLElement | null
      ): ExtractedAssignmentPromptSection[] => {
        if (!promptContainer) {
          return [];
        }

        const withLineBreaks = (
          promptContainer.innerText ||
          promptContainer.textContent ||
          ''
        ).replace(/\r/g, '\n');

        const lines = withLineBreaks
          .split(/\n+/)
          .map((line) => normalizeText(line))
          .filter((line) => line.length > 0);

        if (lines.length === 0) {
          return [];
        }

        const dedupedLines: string[] = [];
        for (const line of lines) {
          if (dedupedLines[dedupedLines.length - 1] !== line) {
            dedupedLines.push(line);
          }
        }

        const normalizedPrompt = normalizeText(dedupedLines.join('\n'));
        const partSections = splitPromptByPartMarkers(normalizedPrompt);
        if (partSections.length > 0) {
          return partSections;
        }

        if (dedupedLines.length === 1) {
          return [{ text: dedupedLines[0] }];
        }

        return dedupedLines.map((line, index) => ({
          title: `Section ${index + 1}`,
          text: line,
        }));
      };

      const truncatePromptSections = (
        sections: ExtractedAssignmentPromptSection[],
        maxChars: number
      ): ExtractedAssignmentPromptSection[] => {
        const truncated: ExtractedAssignmentPromptSection[] = [];
        let remainingChars = maxChars;

        for (const section of sections) {
          if (remainingChars <= 0) {
            break;
          }

          const text = normalizeText(section.text);
          if (!text) {
            continue;
          }

          if (text.length <= remainingChars) {
            truncated.push({
              ...(section.title ? { title: section.title } : {}),
              text,
            });
            remainingChars -= text.length;
            continue;
          }

          const clipped = text
            .slice(0, Math.max(0, remainingChars - 3))
            .trimEnd();
          if (clipped) {
            truncated.push({
              ...(section.title ? { title: section.title } : {}),
              text: `${clipped}...`,
              truncated: true,
            });
          }

          remainingChars = 0;
        }

        return truncated;
      };

      const parseQuestionDisplay = (
        questionHeader: Element | null
      ): Record<string, unknown> | null => {
        const raw = normalizeText(
          questionHeader?.getAttribute('data-question-display') || ''
        );
        if (!raw) {
          return null;
        }

        try {
          return JSON.parse(raw) as Record<string, unknown>;
        } catch {
          return null;
        }
      };

      const inferResult = (questionElement: Element): CengageQuestionResult => {
        if (questionElement.querySelector('.mCorrect')) {
          return 'correct';
        }

        if (questionElement.querySelector('.mIncorrect')) {
          return 'incorrect';
        }

        if (questionElement.querySelector('.mPartial')) {
          return 'partial';
        }

        if (questionElement.querySelector('.waMark')) {
          return 'ungraded';
        }

        return 'unknown';
      };

      const parsePointsFromHeader = (
        questionElement: Element
      ): { earned?: number; possible?: number } => {
        const pointsText = normalizeText(
          questionElement.querySelector('.js-question-header strong')
            ?.textContent || ''
        );
        const match = pointsText.match(
          /\[\s*([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s*points?\s*\]/i
        );

        if (!match) {
          return {};
        }

        const earned = Number(match[1]);
        const possible = Number(match[2]);
        return {
          earned: Number.isFinite(earned) ? earned : undefined,
          possible: Number.isFinite(possible) ? possible : undefined,
        };
      };

      const normalizeResourceUrl = (href: string): string => {
        const raw = normalizeText(href);
        if (!raw) {
          return '';
        }

        try {
          return new URL(raw, window.location.href).toString();
        } catch {
          return raw;
        }
      };

      const collectResourceLinks = (
        questionElement: Element,
        questionId?: string
      ): ExtractedAssignmentResourceLink[] => {
        const selectors: string[] = [];
        if (questionId) {
          selectors.push(`#question_resources_${questionId} a[href]`);
          selectors.push(`#question_help_container_${questionId} a[href]`);
        }
        selectors.push('.questionResources a[href]');

        const links: ExtractedAssignmentResourceLink[] = [];
        const dedupe = new Set<string>();

        for (const selector of selectors) {
          const anchors = Array.from(
            questionElement.querySelectorAll<HTMLAnchorElement>(selector)
          );

          for (const anchor of anchors) {
            const label = normalizeText(anchor.textContent);
            const rawHref =
              anchor.getAttribute('href') ||
              anchor.getAttribute('data-href') ||
              '';
            const url = normalizeResourceUrl(rawHref || anchor.href || '');
            if (!label || !url) {
              continue;
            }

            const key = `${label}@@${url}`;
            if (dedupe.has(key)) {
              continue;
            }
            dedupe.add(key);
            links.push({ label, url });
          }

          if (links.length > 0) {
            break;
          }
        }

        return links;
      };

      const assignmentName = normalizeText(
        document
          .querySelector<HTMLElement>(
            '[id^="assignment"][data-assignment-name]'
          )
          ?.getAttribute('data-assignment-name') || ''
      );

      const pageTitle = normalizeText(document.title);
      const heading = normalizeText(
        document.querySelector<HTMLElement>('h1')?.textContent || ''
      );

      const questionElements = Array.from(
        document.querySelectorAll<HTMLElement>('div.waQBox[id^="question"]')
      );

      const limitedQuestions = questionElements.slice(0, maxQuestionsArg);

      const questions: ExtractedAssignmentQuestion[] = limitedQuestions.map(
        (questionElement, index) => {
          const questionHeader = questionElement.querySelector(
            '.js-question-header'
          );
          const questionDisplay = parseQuestionDisplay(questionHeader);
          const viewPosition = toPositiveInt(
            questionElement.getAttribute('data-view-position')
          );
          const questionNumberFromHeader = toPositiveInt(
            questionElement.querySelector<HTMLElement>(
              '[data-test^="questionNum"]'
            )?.textContent
          );

          const questionNumber =
            viewPosition || questionNumberFromHeader || index + 1;

          const questionIdFromDisplay = normalizeText(
            String(questionDisplay?.questionID || '')
          );
          const questionIdMatch = questionElement.id.match(
            /^question([a-z0-9._-]+)_/i
          );
          const questionIdFromContainer = normalizeText(questionIdMatch?.[1]);
          const questionId =
            questionIdFromDisplay || questionIdFromContainer || undefined;

          const promptNode =
            questionElement.querySelector('.studentQuestionContent .wa1par') ||
            questionElement.querySelector('.studentQuestionBox .wa1par') ||
            questionElement.querySelector('.standard.qContent .wa1par') ||
            questionElement.querySelector('.studentQuestionContent');

          const promptContainer = cleanPromptContent(promptNode);
          const promptRaw = normalizeText(promptContainer?.textContent || '');
          const prompt = truncateText(promptRaw, maxQuestionTextCharsArg);
          const promptSections = truncatePromptSections(
            buildPromptSections(promptContainer),
            maxQuestionTextCharsArg
          );

          let answerRaw = '';
          if (includeAnswersArg) {
            const answerNode =
              questionElement.querySelector(
                '.studentQuestionContent .wa1ans'
              ) || questionElement.querySelector('.studentQuestionBox .wa1ans');
            answerRaw = normalizeText(answerNode?.textContent || '');
          }
          const answer = truncateText(answerRaw, maxAnswerTextCharsArg);

          const feedback = normalizeText(
            questionElement.querySelector('.correctHint')?.textContent || ''
          );

          const submissionsUsed = normalizeText(
            typeof questionDisplay?.submissions === 'string'
              ? (questionDisplay.submissions as string)
              : ''
          );

          const questionDisplayAny = questionDisplay as any;

          const pointsFromDisplay = {
            earned: toNumber(
              questionDisplayAny?.score ||
                questionDisplayAny?.summary?.total?.score
            ),
            possible: toNumber(
              questionDisplayAny?.total ||
                questionDisplayAny?.summary?.total?.total
            ),
          };

          const pointsFromHeader = parsePointsFromHeader(questionElement);
          const pointsEarned =
            pointsFromDisplay.earned ?? pointsFromHeader.earned;
          const pointsPossible =
            pointsFromDisplay.possible ?? pointsFromHeader.possible;

          const resourceLinks = includeResourcesArg
            ? collectResourceLinks(questionElement, questionId)
            : [];

          return {
            questionNumber,
            ...(questionId ? { questionId } : {}),
            prompt: prompt.text,
            ...(promptSections.length > 0 ? { promptSections } : {}),
            ...(prompt.truncated ? { promptTruncated: true } : {}),
            ...(includeAnswersArg && answer.text
              ? { answer: answer.text }
              : {}),
            ...(includeAnswersArg && answer.truncated
              ? { answerTruncated: true }
              : {}),
            ...(typeof pointsEarned === 'number' ? { pointsEarned } : {}),
            ...(typeof pointsPossible === 'number' ? { pointsPossible } : {}),
            ...(submissionsUsed ? { submissionsUsed } : {}),
            result: inferResult(questionElement),
            ...(feedback ? { feedback } : {}),
            ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
          };
        }
      );

      return {
        ...(pageTitle ? { pageTitle } : {}),
        ...(heading ? { heading } : {}),
        ...(assignmentName ? { assignmentName } : {}),
        questionCount: questionElements.length,
        returnedQuestionCount: questions.length,
        ...(questionElements.length > questions.length
          ? { truncatedQuestions: true }
          : {}),
        questions,
      };
    },
    {
      maxQuestions,
      maxQuestionTextChars,
      maxAnswerTextChars,
      includeAnswers,
      includeResources,
    }
  );
}
