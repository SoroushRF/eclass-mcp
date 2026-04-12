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
  includeAssetInventory?: boolean;
  maxInteractiveAssets?: number;
  maxMediaAssets?: number;
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

export type AssignmentCompletenessLevel = 'complete' | 'partial' | 'truncated';

export type AssignmentInteractiveAssetKind =
  | 'iframe'
  | 'iframe_graph'
  | 'math_widget'
  | 'simulation_widget'
  | 'embed'
  | 'object'
  | 'canvas'
  | 'svg'
  | 'unknown_widget';

export interface ExtractedAssignmentInteractiveAsset {
  kind: AssignmentInteractiveAssetKind;
  tagName: string;
  sourceUrl?: string;
  id?: string;
  classes?: string[];
  title?: string;
  ariaLabel?: string;
  width?: number;
  height?: number;
  unsupported?: boolean;
}

export type AssignmentMediaAssetKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'canvas'
  | 'svg';

export interface ExtractedAssignmentMediaAsset {
  kind: AssignmentMediaAssetKind;
  tagName: string;
  sourceUrl?: string;
  altText?: string;
  title?: string;
  width?: number;
  height?: number;
}

export type AssignmentRenderedMediaClassification = 'text' | 'image';

export interface ExtractedAssignmentRenderedMediaAsset {
  kind: 'question_region_png';
  mimeType: 'image/png';
  data: string;
  byteSize: number;
  captureDpi: number;
}

export interface ExtractedAssignmentRenderedMediaSummary {
  processedQuestionCount: number;
  renderedImageCount: number;
  skippedImageCount: number;
  maxRenderedImages: number;
  maxCaptureUnits: number;
  maxCapturePerQuestion: number;
  maxPayloadBytes: number;
  captureDpi: number;
  minTextForSafeText: number;
  truncatedCaptureUnits?: boolean;
}

export interface ExtractedAssignmentOverview {
  mode: 'text_with_rendered_media_fallback';
  startNote: string;
  endNote: string;
  truncated: boolean;
}

export interface ExtractedAssignmentQuestion {
  questionNumber: number;
  questionId?: string;
  prompt: string;
  promptSections?: ExtractedAssignmentPromptSection[];
  hasMediaCarriers?: boolean;
  mediaClassification?: AssignmentRenderedMediaClassification;
  interactiveAssets?: ExtractedAssignmentInteractiveAsset[];
  mediaAssets?: ExtractedAssignmentMediaAsset[];
  renderedMedia?: ExtractedAssignmentRenderedMediaAsset[];
  renderedMediaWarning?: string;
  extractionWarnings?: string[];
  completenessLevel?: AssignmentCompletenessLevel;
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
  extractionWarnings?: string[];
  completenessLevel?: AssignmentCompletenessLevel;
  extractionOverview?: ExtractedAssignmentOverview;
  renderedMediaSummary?: ExtractedAssignmentRenderedMediaSummary;
  questions: ExtractedAssignmentQuestion[];
}

export interface CaptureAssignmentRenderedMediaOptions {
  maxRenderedImages?: number;
  maxCaptureUnits?: number;
  maxCapturePerQuestion?: number;
  maxPayloadBytes?: number;
  minTextForSafeText?: number;
  captureDpi?: number;
}

const DEFAULT_MAX_QUESTIONS = 50;
const DEFAULT_MAX_QUESTION_TEXT_CHARS = 2000;
const DEFAULT_MAX_ANSWER_TEXT_CHARS = 1200;
const DEFAULT_MAX_INTERACTIVE_ASSETS = 10;
const DEFAULT_MAX_MEDIA_ASSETS = 10;
const PDF_PARITY_MAX_IMAGE_PAGES = 20;
const PDF_PARITY_MAX_TOTAL_UNITS = 50;
const PDF_PARITY_DEFAULT_DPI = 100;
const PDF_PARITY_MIN_TEXT_FOR_SAFE_TEXT = 250;
const PDF_PARITY_MAX_PAYLOAD_BYTES = 800 * 1024;
const PDF_PARITY_DEFAULT_CAPTURES_PER_QUESTION = 1;

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
  const includeAssetInventory = options.includeAssetInventory !== false;

  const maxInteractiveAssets = Number.isFinite(options.maxInteractiveAssets)
    ? Math.max(1, Math.trunc(options.maxInteractiveAssets as number))
    : DEFAULT_MAX_INTERACTIVE_ASSETS;

  const maxMediaAssets = Number.isFinite(options.maxMediaAssets)
    ? Math.max(1, Math.trunc(options.maxMediaAssets as number))
    : DEFAULT_MAX_MEDIA_ASSETS;

  return page.evaluate(
    ({
      maxQuestions: maxQuestionsArg,
      maxQuestionTextChars: maxQuestionTextCharsArg,
      maxAnswerTextChars: maxAnswerTextCharsArg,
      includeAnswers: includeAnswersArg,
      includeResources: includeResourcesArg,
      includeAssetInventory: includeAssetInventoryArg,
      maxInteractiveAssets: maxInteractiveAssetsArg,
      maxMediaAssets: maxMediaAssetsArg,
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

      const cleanPromptContent = (
        source: Element | null
      ): HTMLElement | null => {
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
        const markerPrefixRegex =
          /(?=Part\s+\d+\s+of\s+\d+\b(?:\s*[-:\u2013\u2014])?)/gi;

        const segments = value
          .split(markerPrefixRegex)
          .map((segment) => normalizeText(segment))
          .filter((segment) => segment.length > 0);

        if (segments.length === 0) {
          return [];
        }

        const sections: ExtractedAssignmentPromptSection[] = [];
        let runningPartIndex = 0;

        for (const segment of segments) {
          const headerMatch = segment.match(
            /^Part\s+(\d+)\s+of\s+(\d+)\b(?:\s*[-:\u2013\u2014])?/i
          );

          if (!headerMatch) {
            if (sections.length === 0) {
              sections.push({ title: 'Overview', text: segment });
            } else {
              const previous = sections[sections.length - 1];
              if (previous) {
                previous.text = normalizeText(`${previous.text} ${segment}`);
              }
            }
            continue;
          }

          runningPartIndex += 1;
          const partNumber = headerMatch[1] || `${runningPartIndex}`;
          const totalParts = headerMatch[2] || undefined;

          sections.push({
            title: totalParts
              ? `Part ${partNumber} of ${totalParts}`
              : `Part ${partNumber}`,
            text: segment,
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

      const normalizeAssetUrl = (value: string | null | undefined): string => {
        const raw = normalizeText(value);
        if (!raw) {
          return '';
        }

        try {
          return new URL(raw, window.location.href).toString();
        } catch {
          return raw;
        }
      };

      const normalizedClassList = (element: Element): string[] => {
        const className = normalizeText(element.getAttribute('class') || '');
        if (!className) {
          return [];
        }

        return Array.from(new Set(className.split(/\s+/))).slice(0, 8);
      };

      const measureElementSize = (
        element: HTMLElement
      ): { width?: number; height?: number } => {
        const rect = element.getBoundingClientRect();
        const width =
          rect.width > 0
            ? Math.round(rect.width)
            : Number.parseInt(element.getAttribute('width') || '', 10);
        const height =
          rect.height > 0
            ? Math.round(rect.height)
            : Number.parseInt(element.getAttribute('height') || '', 10);

        return {
          ...(Number.isFinite(width) && width > 0 ? { width } : {}),
          ...(Number.isFinite(height) && height > 0 ? { height } : {}),
        };
      };

      const classifyInteractiveAsset = (
        element: HTMLElement
      ): { kind: AssignmentInteractiveAssetKind; unsupported: boolean } => {
        const tag = element.tagName.toLowerCase();
        const fingerprint = normalizeText(
          [
            element.id,
            element.getAttribute('class') || '',
            element.getAttribute('data-widget') || '',
            element.getAttribute('data-component') || '',
            element.getAttribute('title') || '',
            element.getAttribute('aria-label') || '',
            element.getAttribute('src') || '',
          ]
            .filter(Boolean)
            .join(' ')
        ).toLowerCase();

        if (
          fingerprint.includes('iframegraph') ||
          fingerprint.includes('graphing')
        ) {
          return { kind: 'iframe_graph', unsupported: false };
        }

        if (
          fingerprint.includes('mathjax') ||
          fingerprint.includes('mathquill') ||
          fingerprint.includes('equation')
        ) {
          return { kind: 'math_widget', unsupported: false };
        }

        if (
          fingerprint.includes('simulation') ||
          fingerprint.includes('sim-widget') ||
          fingerprint.includes('interactive')
        ) {
          return { kind: 'simulation_widget', unsupported: false };
        }

        if (tag === 'iframe') {
          return { kind: 'iframe', unsupported: false };
        }

        if (tag === 'embed') {
          return { kind: 'embed', unsupported: true };
        }

        if (tag === 'object') {
          return { kind: 'object', unsupported: true };
        }

        if (tag === 'canvas') {
          return { kind: 'canvas', unsupported: false };
        }

        if (tag === 'svg') {
          return { kind: 'svg', unsupported: false };
        }

        return { kind: 'unknown_widget', unsupported: true };
      };

      const collectInteractiveAssets = (
        questionElement: Element
      ): {
        assets: ExtractedAssignmentInteractiveAsset[];
        warnings: string[];
      } => {
        const selectors =
          'iframe, embed, object, canvas, svg, [data-widget], [class*="widget"], [class*="math"], [id*="math"], [class*="iframeGraph"], [id*="iframeGraph"], [class*="simulation"]';
        const elements = Array.from(
          questionElement.querySelectorAll<HTMLElement>(selectors)
        );

        const assets: ExtractedAssignmentInteractiveAsset[] = [];
        const warnings: string[] = [];
        const dedupe = new Set<string>();

        for (const element of elements) {
          if (assets.length >= maxInteractiveAssetsArg) {
            warnings.push(
              `Interactive asset inventory truncated at ${maxInteractiveAssetsArg} item(s).`
            );
            break;
          }

          const { kind, unsupported } = classifyInteractiveAsset(element);
          if (kind === 'unknown_widget' && !element.id && !element.className) {
            continue;
          }

          const sourceUrl = normalizeAssetUrl(
            element.getAttribute('src') ||
              element.getAttribute('data-src') ||
              element.getAttribute('data-url') ||
              element.getAttribute('href') ||
              ''
          );

          const classes = normalizedClassList(element);
          const key = [
            kind,
            normalizeText(element.id),
            sourceUrl,
            classes.join('.'),
          ].join('@@');

          if (dedupe.has(key)) {
            continue;
          }
          dedupe.add(key);

          const size = measureElementSize(element);
          assets.push({
            kind,
            tagName: element.tagName.toLowerCase(),
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(element.id ? { id: element.id } : {}),
            ...(classes.length > 0 ? { classes } : {}),
            ...(element.getAttribute('title')
              ? { title: normalizeText(element.getAttribute('title')) }
              : {}),
            ...(element.getAttribute('aria-label')
              ? {
                  ariaLabel: normalizeText(element.getAttribute('aria-label')),
                }
              : {}),
            ...size,
            ...(unsupported ? { unsupported: true } : {}),
          });

          if (unsupported) {
            warnings.push(
              `Unsupported interactive asset detected (${kind}); text fallback retained.`
            );
          }
        }

        return { assets, warnings };
      };

      const collectMediaAssets = (
        questionElement: Element
      ): ExtractedAssignmentMediaAsset[] => {
        const elements = Array.from(
          questionElement.querySelectorAll<HTMLElement>(
            'img, video, audio, canvas, svg'
          )
        );

        const assets: ExtractedAssignmentMediaAsset[] = [];
        const dedupe = new Set<string>();

        for (const element of elements) {
          if (assets.length >= maxMediaAssetsArg) {
            break;
          }

          const tagName = element.tagName.toLowerCase();
          const kind: AssignmentMediaAssetKind =
            tagName === 'img'
              ? 'image'
              : tagName === 'video'
                ? 'video'
                : tagName === 'audio'
                  ? 'audio'
                  : tagName === 'canvas'
                    ? 'canvas'
                    : 'svg';

          const sourceUrl = normalizeAssetUrl(
            element.getAttribute('src') ||
              element.getAttribute('data-src') ||
              element.getAttribute('data-url') ||
              element.getAttribute('href') ||
              ''
          );

          const key = [kind, sourceUrl, normalizeText(element.id)].join('@@');
          if (dedupe.has(key)) {
            continue;
          }
          dedupe.add(key);

          const size = measureElementSize(element);
          assets.push({
            kind,
            tagName,
            ...(sourceUrl ? { sourceUrl } : {}),
            ...(tagName === 'img' && element.getAttribute('alt')
              ? { altText: normalizeText(element.getAttribute('alt')) }
              : {}),
            ...(element.getAttribute('title')
              ? { title: normalizeText(element.getAttribute('title')) }
              : {}),
            ...size,
          });
        }

        return assets;
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

          const assetInventory = includeAssetInventoryArg
            ? collectInteractiveAssets(questionElement)
            : { assets: [], warnings: [] };
          const mediaAssets = includeAssetInventoryArg
            ? collectMediaAssets(questionElement)
            : [];

          const extractionWarnings: string[] = [];
          if (prompt.truncated) {
            extractionWarnings.push(
              `Prompt text truncated to ${maxQuestionTextCharsArg} chars.`
            );
          }

          if (includeAnswersArg && answer.truncated) {
            extractionWarnings.push(
              `Answer text truncated to ${maxAnswerTextCharsArg} chars.`
            );
          }

          if (promptSections.some((section) => section.truncated)) {
            extractionWarnings.push(
              `Prompt sections truncated to ${maxQuestionTextCharsArg} chars total.`
            );
          }

          extractionWarnings.push(...assetInventory.warnings);

          const completenessLevel: AssignmentCompletenessLevel =
            prompt.truncated ||
            (includeAnswersArg && answer.truncated) ||
            promptSections.some((section) => section.truncated)
              ? 'truncated'
              : extractionWarnings.length > 0
                ? 'partial'
                : 'complete';

          return {
            questionNumber,
            ...(questionId ? { questionId } : {}),
            prompt: prompt.text,
            ...(promptSections.length > 0 ? { promptSections } : {}),
            ...(includeAssetInventoryArg && assetInventory.assets.length > 0
              ? { interactiveAssets: assetInventory.assets }
              : {}),
            ...(includeAssetInventoryArg && mediaAssets.length > 0
              ? { mediaAssets }
              : {}),
            ...(extractionWarnings.length > 0 ? { extractionWarnings } : {}),
            completenessLevel,
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

      const extractionWarnings: string[] = [];
      const truncatedQuestions = questionElements.length > questions.length;
      if (truncatedQuestions) {
        extractionWarnings.push(
          `Question list truncated: returned ${questions.length} of ${questionElements.length}.`
        );
      }

      const truncatedQuestionCount = questions.filter(
        (question) => question.completenessLevel === 'truncated'
      ).length;
      if (truncatedQuestionCount > 0) {
        extractionWarnings.push(
          `${truncatedQuestionCount} question(s) include truncated text sections.`
        );
      }

      const partialQuestionCount = questions.filter(
        (question) => question.completenessLevel === 'partial'
      ).length;
      if (partialQuestionCount > 0) {
        extractionWarnings.push(
          `${partialQuestionCount} question(s) include extraction warnings.`
        );
      }

      const completenessLevel: AssignmentCompletenessLevel =
        truncatedQuestions || truncatedQuestionCount > 0
          ? 'truncated'
          : partialQuestionCount > 0
            ? 'partial'
            : 'complete';

      const extractionOverview: ExtractedAssignmentOverview = {
        mode: 'text_with_rendered_media_fallback',
        startNote:
          'Text extraction completed. Image-classified prompts can include rendered media fallback when enabled.',
        endNote:
          completenessLevel === 'truncated'
            ? 'Output includes truncation from configured limits. Increase maxQuestions or text limits for fuller output.'
            : 'Output completed within configured extraction limits.',
        truncated: completenessLevel === 'truncated',
      };

      return {
        ...(pageTitle ? { pageTitle } : {}),
        ...(heading ? { heading } : {}),
        ...(assignmentName ? { assignmentName } : {}),
        questionCount: questionElements.length,
        returnedQuestionCount: questions.length,
        ...(truncatedQuestions ? { truncatedQuestions: true } : {}),
        ...(extractionWarnings.length > 0 ? { extractionWarnings } : {}),
        completenessLevel,
        extractionOverview,
        questions,
      };
    },
    {
      maxQuestions,
      maxQuestionTextChars,
      maxAnswerTextChars,
      includeAnswers,
      includeResources,
      includeAssetInventory,
      maxInteractiveAssets,
      maxMediaAssets,
    }
  );
}

function escapeCssIdentifier(value: string): string {
  return value.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

interface RenderCaptureCandidate {
  questionNumber: number;
  questionId?: string;
  containerId?: string;
  promptLength: number;
  hasMediaCarriers: boolean;
  classification: AssignmentRenderedMediaClassification;
}

export async function captureAssignmentRenderedMedia(
  page: Page,
  details: ExtractedAssignmentDetails,
  options: CaptureAssignmentRenderedMediaOptions = {}
): Promise<ExtractedAssignmentRenderedMediaSummary> {
  const maxRenderedImages = Number.isFinite(options.maxRenderedImages)
    ? Math.max(
        1,
        Math.min(
          PDF_PARITY_MAX_IMAGE_PAGES,
          Math.trunc(options.maxRenderedImages as number)
        )
      )
    : PDF_PARITY_MAX_IMAGE_PAGES;

  const maxCaptureUnits = Number.isFinite(options.maxCaptureUnits)
    ? Math.max(
        1,
        Math.min(
          PDF_PARITY_MAX_TOTAL_UNITS,
          Math.trunc(options.maxCaptureUnits as number)
        )
      )
    : PDF_PARITY_MAX_TOTAL_UNITS;

  const maxCapturePerQuestion = Number.isFinite(options.maxCapturePerQuestion)
    ? Math.max(1, Math.trunc(options.maxCapturePerQuestion as number))
    : PDF_PARITY_DEFAULT_CAPTURES_PER_QUESTION;

  const maxPayloadBytes = Number.isFinite(options.maxPayloadBytes)
    ? Math.max(10_000, Math.trunc(options.maxPayloadBytes as number))
    : PDF_PARITY_MAX_PAYLOAD_BYTES;

  const minTextForSafeText = Number.isFinite(options.minTextForSafeText)
    ? Math.max(1, Math.trunc(options.minTextForSafeText as number))
    : PDF_PARITY_MIN_TEXT_FOR_SAFE_TEXT;

  const captureDpi = Number.isFinite(options.captureDpi)
    ? Math.max(72, Math.trunc(options.captureDpi as number))
    : PDF_PARITY_DEFAULT_DPI;

  const candidates = await page.evaluate(
    ({
      maxCaptureUnits: maxCaptureUnitsArg,
      minTextForSafeText: minTextArg,
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

      const questionElements = Array.from(
        document.querySelectorAll<HTMLElement>('div.waQBox[id^="question"]')
      ).slice(0, maxCaptureUnitsArg);

      return questionElements.map((questionElement, index) => {
        const questionHeader = questionElement.querySelector(
          '.js-question-header'
        );
        let questionDisplay: Record<string, unknown> | null = null;

        const rawDisplay = normalizeText(
          questionHeader?.getAttribute('data-question-display') || ''
        );
        if (rawDisplay) {
          try {
            questionDisplay = JSON.parse(rawDisplay) as Record<string, unknown>;
          } catch {
            questionDisplay = null;
          }
        }

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

        const promptRaw = normalizeText(promptNode?.textContent || '');

        const hasMediaCarriers =
          questionElement.querySelector(
            'img, canvas, svg, iframe, video, audio, object, embed'
          ) !== null;

        const classification: AssignmentRenderedMediaClassification =
          hasMediaCarriers && promptRaw.length < minTextArg ? 'image' : 'text';

        return {
          questionNumber,
          ...(questionId ? { questionId } : {}),
          ...(questionElement.id ? { containerId: questionElement.id } : {}),
          promptLength: promptRaw.length,
          hasMediaCarriers,
          classification,
        };
      });
    },
    {
      maxCaptureUnits,
      minTextForSafeText,
    }
  );

  const questionById = new Map<string, ExtractedAssignmentQuestion>();
  const questionByNumber = new Map<number, ExtractedAssignmentQuestion>();

  for (const question of details.questions) {
    if (question.questionId) {
      questionById.set(question.questionId, question);
    }
    questionByNumber.set(question.questionNumber, question);
  }

  let renderedImageCount = 0;
  let skippedImageCount = 0;
  let currentPayloadSize = 0;

  const appendQuestionWarning = (
    question: ExtractedAssignmentQuestion,
    warning: string
  ) => {
    const existing = question.extractionWarnings || [];
    if (!existing.includes(warning)) {
      question.extractionWarnings = [...existing, warning];
    }

    if (question.completenessLevel !== 'truncated') {
      question.completenessLevel = 'partial';
    }
  };

  for (const candidate of candidates as RenderCaptureCandidate[]) {
    const question =
      (candidate.questionId
        ? questionById.get(candidate.questionId)
        : undefined) || questionByNumber.get(candidate.questionNumber);

    if (!question) {
      continue;
    }

    question.hasMediaCarriers = candidate.hasMediaCarriers;
    question.mediaClassification = candidate.classification;

    if (candidate.classification !== 'image') {
      continue;
    }

    if (!candidate.containerId) {
      skippedImageCount += 1;
      question.renderedMediaWarning =
        'Image-classified question region could not be captured because container id was missing. Text fallback retained.';
      appendQuestionWarning(question, question.renderedMediaWarning);
      continue;
    }

    const existingCaptures = question.renderedMedia?.length || 0;
    if (existingCaptures >= maxCapturePerQuestion) {
      skippedImageCount += 1;
      question.renderedMediaWarning =
        'Per-question capture limit reached. Text fallback retained.';
      appendQuestionWarning(question, question.renderedMediaWarning);
      continue;
    }

    if (
      renderedImageCount >= maxRenderedImages ||
      currentPayloadSize >= maxPayloadBytes
    ) {
      skippedImageCount += 1;
      question.renderedMediaWarning =
        renderedImageCount >= maxRenderedImages
          ? 'Image capture limit reached. Text fallback retained.'
          : 'Image payload limit reached. Text fallback retained.';
      appendQuestionWarning(question, question.renderedMediaWarning);
      continue;
    }

    const selector = `#${escapeCssIdentifier(candidate.containerId)}`;
    const locator = page.locator(selector).first();

    let imageBuffer: Buffer;
    try {
      imageBuffer = await locator.screenshot({
        type: 'png',
        scale: 'css',
        animations: 'disabled',
      });
    } catch {
      skippedImageCount += 1;
      question.renderedMediaWarning =
        'Question region screenshot failed. Text fallback retained.';
      appendQuestionWarning(question, question.renderedMediaWarning);
      continue;
    }

    const base64 = imageBuffer.toString('base64');
    const estimatedPayloadSize = base64.length + 100;

    if (currentPayloadSize + estimatedPayloadSize > maxPayloadBytes) {
      skippedImageCount += 1;
      question.renderedMediaWarning =
        'Image payload limit reached. Text fallback retained.';
      appendQuestionWarning(question, question.renderedMediaWarning);
      continue;
    }

    question.renderedMedia = [
      {
        kind: 'question_region_png',
        mimeType: 'image/png',
        data: base64,
        byteSize: imageBuffer.length,
        captureDpi,
      },
    ];

    renderedImageCount += 1;
    currentPayloadSize += estimatedPayloadSize;
  }

  const summary: ExtractedAssignmentRenderedMediaSummary = {
    processedQuestionCount: candidates.length,
    renderedImageCount,
    skippedImageCount,
    maxRenderedImages,
    maxCaptureUnits,
    maxCapturePerQuestion,
    maxPayloadBytes,
    captureDpi,
    minTextForSafeText,
    ...(details.questions.length > candidates.length
      ? { truncatedCaptureUnits: true }
      : {}),
  };

  const detailWarnings = new Set<string>(details.extractionWarnings || []);
  if (summary.truncatedCaptureUnits) {
    detailWarnings.add(
      `Rendered media candidate scan truncated at ${maxCaptureUnits} question(s).`
    );
  }

  if (skippedImageCount > 0) {
    detailWarnings.add(
      `${skippedImageCount} image-classified question(s) used text fallback due to rendered-media limits or capture failures.`
    );
  }

  if (detailWarnings.size > 0) {
    details.extractionWarnings = Array.from(detailWarnings);
  }

  if (details.completenessLevel !== 'truncated' && skippedImageCount > 0) {
    details.completenessLevel = 'partial';
  }

  if (details.extractionOverview) {
    details.extractionOverview = {
      ...details.extractionOverview,
      endNote:
        details.completenessLevel === 'truncated'
          ? details.extractionOverview.endNote
          : skippedImageCount > 0
            ? 'Rendered media capture applied with fallback on some questions. Text extraction remains complete for all returned questions.'
            : details.extractionOverview.endNote,
    };
  }

  details.renderedMediaSummary = summary;
  return summary;
}
