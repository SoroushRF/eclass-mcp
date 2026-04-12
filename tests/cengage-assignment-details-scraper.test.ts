import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  captureAssignmentRenderedMedia,
  extractAssignmentDetails,
  type ExtractedAssignmentDetails,
} from '../src/scraper/cengage/assignment-details';

function restoreGlobal(key: string, previous: unknown): void {
  if (typeof previous === 'undefined') {
    delete (globalThis as Record<string, unknown>)[key];
    return;
  }

  (globalThis as Record<string, unknown>)[key] = previous;
}

function runEvaluateInDom<TArg, TResult>(
  html: string,
  url: string,
  callback: ((arg: TArg) => TResult) | (() => TResult),
  arg?: TArg
): TResult {
  const dom = new JSDOM(html, { url });
  const { window } = dom;

  Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 240,
      bottom: 60,
      width: 240,
      height: 60,
      toJSON: () => ({}) as object,
    }),
  });

  const prevWindow = (globalThis as Record<string, unknown>).window;
  const prevDocument = (globalThis as Record<string, unknown>).document;
  const prevHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;

  (globalThis as Record<string, unknown>).window = window;
  (globalThis as Record<string, unknown>).document = window.document;
  (globalThis as Record<string, unknown>).HTMLElement = window.HTMLElement;

  try {
    if (typeof arg === 'undefined') {
      return (callback as () => TResult)();
    }
    return (callback as (value: TArg) => TResult)(arg);
  } finally {
    restoreGlobal('window', prevWindow);
    restoreGlobal('document', prevDocument);
    restoreGlobal('HTMLElement', prevHTMLElement);
    window.close();
  }
}

describe('cengage assignment details scraper internals', () => {
  it('extracts rich question details with truncation, resources, and assets', async () => {
    const html = `
      <main>
        <div id="assignment_meta" data-assignment-name="Limits Homework"></div>
        <h1>Limits Homework</h1>

        <div class="waQBox" id="questionq1_1" data-view-position="7">
          <div class="js-question-header" data-question-display='{"questionID":"q1","submissions":"1/2","score":"2","total":"3"}'>
            <strong>[ 2 / 3 points ]</strong>
            <span data-test="questionNum1">Question 7</span>
          </div>
          <div class="studentQuestionContent">
            <div class="wa1par">
              Part 1 of 2 - Evaluate f(x).
              Part 2 of 2 - Explain your steps clearly.
              <script>ignored()</script>
            </div>
            <div class="wa1ans">Answer one.</div>
            <div class="correctHint">Nice work!</div>
            <iframe id="graph-widget" class="iframeGraph simulation" src="/widget/graph"></iframe>
            <embed id="embed-widget" src="/widget/embed"></embed>
            <img src="/media/figure.png" alt="Figure A" title="Figure title" />
            <video src="/media/clip.mp4"></video>
          </div>
          <div class="mCorrect"></div>
          <div id="question_resources_q1">
            <a href="/resource/a">Resource A</a>
            <a href="/resource/a">Resource A</a>
          </div>
        </div>

        <div class="waQBox" id="questionfallback_1">
          <div class="js-question-header" data-question-display="{bad-json">
            <strong>[ 0 / 1 points ]</strong>
            <span data-test="questionNum2">2</span>
          </div>
          <div class="studentQuestionBox">
            <div class="wa1par">Line one with long explanation text that forces truncation. Line two continues beyond limits.</div>
            <div class="wa1ans">This answer is intentionally very long and should be truncated.</div>
          </div>
          <div class="mPartial"></div>
        </div>

        <div class="waQBox" id="questionnomark_1">
          <div class="js-question-header">
            <strong>[ 1 / 1 points ]</strong>
          </div>
          <div class="studentQuestionContent">
            <div class="wa1par">Single short prompt</div>
          </div>
          <div class="waMark"></div>
        </div>

        <div class="waQBox" id="questionunknown_1">
          <div class="studentQuestionContent">
            <div class="wa1par">No marker class present.</div>
          </div>
        </div>
      </main>
    `;

    const page = {
      evaluate: async (callback: unknown, arg: unknown) =>
        runEvaluateInDom(
          html,
          'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=100',
          callback as ((value: unknown) => unknown) | (() => unknown),
          arg
        ),
    };

    const details = await extractAssignmentDetails(page as any, {
      maxQuestions: 3,
      maxQuestionTextChars: 40,
      maxAnswerTextChars: 24,
      includeAnswers: true,
      includeResources: true,
      includeAssetInventory: true,
      maxInteractiveAssets: 1,
      maxMediaAssets: 1,
    });

    expect(details.questionCount).toBe(4);
    expect(details.returnedQuestionCount).toBe(3);
    expect(details.truncatedQuestions).toBe(true);
    expect(details.completenessLevel).toBe('truncated');
    expect(details.extractionWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Question list truncated'),
        expect.stringContaining('question(s) include extraction warnings'),
      ])
    );

    const q1 = details.questions[0];
    expect(q1?.questionNumber).toBe(7);
    expect(q1?.questionId).toBe('q1');
    expect(q1?.result).toBe('correct');
    expect(q1?.submissionsUsed).toBe('1/2');
    expect(q1?.pointsEarned).toBe(2);
    expect(q1?.pointsPossible).toBe(3);
    expect(q1?.resourceLinks).toHaveLength(1);
    expect(q1?.interactiveAssets).toHaveLength(1);
    expect(q1?.mediaAssets).toHaveLength(1);
    expect(q1?.promptSections?.[0]?.title).toBe('Part 1 of 2');
    expect(q1?.extractionWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Interactive asset inventory truncated'),
      ])
    );

    const q2 = details.questions[1];
    expect(q2?.questionId).toBe('fallback');
    expect(q2?.result).toBe('partial');
    expect(q2?.pointsEarned).toBe(0);
    expect(q2?.pointsPossible).toBe(1);

    const q3 = details.questions[2];
    expect(q3?.result).toBe('ungraded');
    expect(q3?.pointsEarned).toBe(1);
    expect(q3?.pointsPossible).toBe(1);
  });

  it('supports minimal extraction mode and unknown question result fallback', async () => {
    const html = `
      <main>
        <h1>Practice</h1>
        <div class="waQBox" id="questionx1_1">
          <div class="studentQuestionContent">
            <div class="wa1par">Line one\nLine two</div>
            <div class="wa1ans">Should not be returned</div>
          </div>
        </div>
      </main>
    `;

    const page = {
      evaluate: async (callback: unknown, arg: unknown) =>
        runEvaluateInDom(
          html,
          'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=200',
          callback as ((value: unknown) => unknown) | (() => unknown),
          arg
        ),
    };

    const details = await extractAssignmentDetails(page as any, {
      includeAnswers: false,
      includeResources: false,
      includeAssetInventory: false,
    });

    expect(details.questionCount).toBe(1);
    expect(details.returnedQuestionCount).toBe(1);
    expect(details.completenessLevel).toBe('complete');
    expect(details.questions[0]?.result).toBe('unknown');
    expect(details.questions[0]?.answer).toBeUndefined();
    expect(details.questions[0]?.resourceLinks).toBeUndefined();
    expect(details.questions[0]?.interactiveAssets).toBeUndefined();
    expect(details.questions[0]?.mediaAssets).toBeUndefined();
  });

  it('captures rendered-media screenshots from image-classified questions', async () => {
    const html = `
      <main>
        <div class="waQBox" id="questionq1_1" data-view-position="1">
          <div class="js-question-header" data-question-display='{"questionID":"q1"}'></div>
          <div class="studentQuestionContent">
            <div class="wa1par">Tiny prompt</div>
            <img src="/media/one.png" />
          </div>
        </div>
        <div class="waQBox" id="questionq2_1" data-view-position="2">
          <div class="js-question-header" data-question-display='{"questionID":"q2"}'></div>
          <div class="studentQuestionContent">
            <div class="wa1par">This prompt is intentionally long enough to be treated as text even with media present in the container.</div>
            <img src="/media/two.png" />
          </div>
        </div>
      </main>
    `;

    const screenshotSpy = vi.fn(async () => Buffer.from('img-1'));
    const page = {
      evaluate: async (callback: unknown, arg: unknown) =>
        runEvaluateInDom(
          html,
          'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=300',
          callback as ((value: unknown) => unknown) | (() => unknown),
          arg
        ),
      locator: vi.fn((selector: string) => ({
        first: () => ({
          screenshot: screenshotSpy,
          selector,
        }),
      })),
    };

    const details: ExtractedAssignmentDetails = {
      questionCount: 3,
      returnedQuestionCount: 3,
      completenessLevel: 'complete',
      extractionOverview: {
        mode: 'text_with_rendered_media_fallback',
        startNote: 'start',
        endNote: 'done',
        truncated: false,
      },
      questions: [
        {
          questionNumber: 1,
          questionId: 'q1',
          prompt: 'A',
          completenessLevel: 'complete',
        },
        {
          questionNumber: 2,
          questionId: 'q2',
          prompt: 'B',
          completenessLevel: 'complete',
        },
        {
          questionNumber: 3,
          questionId: 'q3',
          prompt: 'C',
          completenessLevel: 'complete',
        },
      ],
    };

    const summary = await captureAssignmentRenderedMedia(page as any, details, {
      maxCaptureUnits: 2,
      minTextForSafeText: 20,
      maxRenderedImages: 5,
      maxPayloadBytes: 5000,
    });

    expect(summary.processedQuestionCount).toBe(2);
    expect(summary.renderedImageCount).toBe(1);
    expect(summary.skippedImageCount).toBe(0);
    expect(summary.truncatedCaptureUnits).toBe(true);
    expect(screenshotSpy).toHaveBeenCalledTimes(1);

    expect(details.questions[0]?.mediaClassification).toBe('image');
    expect(details.questions[0]?.renderedMedia).toHaveLength(1);
    expect(details.questions[1]?.mediaClassification).toBe('text');
    expect(details.extractionWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'Rendered media candidate scan truncated at 2 question(s).'
        ),
      ])
    );
  });

  it('falls back to text when capture limits or screenshot errors occur', async () => {
    const candidates = [
      {
        questionNumber: 1,
        promptLength: 10,
        hasMediaCarriers: true,
        classification: 'image',
      },
      {
        questionNumber: 2,
        containerId: 'questionq2_1',
        promptLength: 10,
        hasMediaCarriers: true,
        classification: 'image',
      },
      {
        questionNumber: 3,
        containerId: 'questionq3_1',
        promptLength: 10,
        hasMediaCarriers: true,
        classification: 'image',
      },
      {
        questionNumber: 4,
        containerId: 'questionq4_1',
        promptLength: 10,
        hasMediaCarriers: true,
        classification: 'image',
      },
      {
        questionNumber: 5,
        containerId: 'questionq5_1',
        promptLength: 10,
        hasMediaCarriers: true,
        classification: 'image',
      },
      {
        questionNumber: 6,
        containerId: 'questionq6_1',
        promptLength: 10,
        hasMediaCarriers: true,
        classification: 'image',
      },
      {
        questionNumber: 7,
        containerId: 'questionq7_1',
        promptLength: 500,
        hasMediaCarriers: false,
        classification: 'text',
      },
      {
        questionNumber: 42,
        containerId: 'questionq42_1',
        promptLength: 10,
        hasMediaCarriers: true,
        classification: 'image',
      },
    ];

    const page = {
      evaluate: vi.fn(async () => candidates),
      locator: vi.fn((selector: string) => ({
        first: () => ({
          screenshot: async () => {
            if (selector === '#questionq3_1') {
              throw new Error('screenshot failed');
            }
            if (selector === '#questionq4_1') {
              return Buffer.alloc(8000, 65);
            }
            return Buffer.from('ok');
          },
        }),
      })),
    };

    const details: ExtractedAssignmentDetails = {
      questionCount: 7,
      returnedQuestionCount: 7,
      completenessLevel: 'complete',
      extractionOverview: {
        mode: 'text_with_rendered_media_fallback',
        startNote: 'start',
        endNote: 'Output completed within configured extraction limits.',
        truncated: false,
      },
      questions: [
        { questionNumber: 1, prompt: 'Q1', completenessLevel: 'complete' },
        {
          questionNumber: 2,
          prompt: 'Q2',
          completenessLevel: 'complete',
          renderedMedia: [
            {
              kind: 'question_region_png',
              mimeType: 'image/png',
              data: 'abc',
              byteSize: 2,
              captureDpi: 100,
            },
          ],
        },
        { questionNumber: 3, prompt: 'Q3', completenessLevel: 'complete' },
        { questionNumber: 4, prompt: 'Q4', completenessLevel: 'complete' },
        { questionNumber: 5, prompt: 'Q5', completenessLevel: 'complete' },
        { questionNumber: 6, prompt: 'Q6', completenessLevel: 'complete' },
        { questionNumber: 7, prompt: 'Q7', completenessLevel: 'complete' },
      ],
    };

    const summary = await captureAssignmentRenderedMedia(page as any, details, {
      maxRenderedImages: 1,
      maxCapturePerQuestion: 1,
      maxPayloadBytes: 10_000,
    });

    expect(summary.renderedImageCount).toBe(1);
    expect(summary.skippedImageCount).toBe(5);
    expect(details.questions[0]?.renderedMediaWarning).toContain(
      'container id was missing'
    );
    expect(details.questions[1]?.renderedMediaWarning).toContain(
      'Per-question capture limit reached'
    );
    expect(details.questions[2]?.renderedMediaWarning).toContain(
      'screenshot failed'
    );
    expect(details.questions[3]?.renderedMediaWarning).toContain(
      'payload limit reached'
    );
    expect(details.questions[5]?.renderedMediaWarning).toContain(
      'Image capture limit reached'
    );
    expect(details.questions[6]?.renderedMediaWarning).toBeUndefined();
    expect(details.completenessLevel).toBe('partial');
    expect(details.extractionWarnings).toEqual(
      expect.arrayContaining([expect.stringContaining('used text fallback')])
    );
    expect(details.extractionOverview?.endNote).toContain(
      'fallback on some questions'
    );
  });
});
