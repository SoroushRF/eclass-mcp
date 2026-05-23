import type { EClassBrowserSession } from './browser-session';
import { inferItemType } from './helpers';
import { normalizeAndClassifyCengageEntry } from '../cengage-url';
import type {
  Attachment,
  AttachmentKind,
  AssignmentDetails,
  AssignmentSubmissionPreflightData,
  ItemDetails,
  ItemDetailsBase,
  QuizDetails,
} from './types';
import { getSelectorGroup, logDomSelectorMatch } from '../selectors';
import {
  validateFinalUrlForPolicy,
  validateUrlForPolicy,
} from '../../security/url-policy';

function getPageUrl(page: { url?: () => string }): string | undefined {
  if (typeof page.url !== 'function') return undefined;
  try {
    return page.url();
  } catch {
    return undefined;
  }
}

type RawDescriptionLink = {
  name: string;
  url: string;
};

type ExternalLinkType = NonNullable<
  ItemDetailsBase['externalLinks']
>[number]['linkType'];

export function classifyDescriptionExternalLinks(
  rawLinks: RawDescriptionLink[],
  pageUrl: string
): NonNullable<ItemDetailsBase['externalLinks']> {
  const links: NonNullable<ItemDetailsBase['externalLinks']> = [];
  const seen = new Set<string>();
  const pageHost = (() => {
    try {
      return new URL(pageUrl).host.toLowerCase();
    } catch {
      return '';
    }
  })();

  for (const raw of rawLinks) {
    const candidate = (raw.url || '').trim();
    if (!candidate) continue;

    let parsed: URL;
    try {
      parsed = new URL(candidate, pageUrl);
    } catch {
      continue;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      continue;
    }

    parsed.hash = '';
    const normalizedUrl = parsed.toString();

    let linkType: ExternalLinkType;
    try {
      linkType = normalizeAndClassifyCengageEntry(normalizedUrl).linkType;
    } catch {
      linkType = 'other';
    }

    const isInternal =
      pageHost.length > 0 && parsed.host.toLowerCase() === pageHost;
    if (isInternal && linkType !== 'eclass_lti') {
      continue;
    }

    const key = normalizedUrl.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    links.push({
      name: (raw.name || '').trim() || normalizedUrl,
      url: normalizedUrl,
      linkType,
    });
  }

  return links;
}

export async function getItemDetails(
  session: EClassBrowserSession,
  url: string
): Promise<ItemDetails> {
  const safeUrl = validateUrlForPolicy(url, 'eclass_item');
  const t = inferItemType(safeUrl);
  if (t === 'quiz') return getQuizDetails(session, safeUrl);
  return getAssignmentDetails(session, safeUrl);
}

export async function getAssignmentDetails(
  session: EClassBrowserSession,
  url: string
): Promise<AssignmentDetails> {
  const safeUrl = validateUrlForPolicy(url, 'eclass_item');
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    await page.goto(safeUrl, { waitUntil: 'load', timeout: 60000 });
    const currentPageUrl = getPageUrl(page);
    if (currentPageUrl) {
      validateFinalUrlForPolicy(currentPageUrl, 'eclass_item');
    }

    const commentLink = await page.$('.comment-link');
    if (commentLink) {
      await commentLink.click().catch(() => {});
      await page.waitForTimeout(1000).catch(() => {});
    }

    const selectorGroups = {
      intro: [...getSelectorGroup('eclass.assignment.intro').candidates],
      statusTable: [
        ...getSelectorGroup('eclass.assignment.status_table').candidates,
      ],
    };
    const data = await page.evaluate(
      ({
        url: pageUrl,
        selectors,
      }: {
        url: string;
        selectors: typeof selectorGroups;
      }) => {
        const title =
          (
            document.querySelector('h1')?.textContent ||
            document.title ||
            ''
          ).trim() || 'Assignment';

        const moodleWindow = window as Window & {
          M?: { cfg?: { courseId?: unknown } };
        };
        const rawCourseId = moodleWindow.M?.cfg?.courseId;
        const courseId =
          (typeof rawCourseId === 'string' || typeof rawCourseId === 'number'
            ? rawCourseId.toString()
            : '') ||
          document.body.className.match(/course-(\d+)/)?.[1] ||
          '';

        let descEl: HTMLElement | null = null;
        let descSelectorMatch:
          | { candidateId: string; selector: string; count: number }
          | undefined;
        for (const candidate of selectors.intro) {
          const found = Array.from(
            document.querySelectorAll<HTMLElement>(candidate.selector)
          );
          if (found.length > 0) {
            descEl = found[0];
            descSelectorMatch = {
              candidateId: candidate.id,
              selector: candidate.selector,
              count: found.length,
            };
            break;
          }
        }

        const descriptionHtml = descEl?.innerHTML?.trim() || '';
        const descriptionText = descEl?.textContent?.trim() || '';
        const rawDescriptionLinks: Array<{ name: string; url: string }> =
          Array.from(descEl?.querySelectorAll('a[href]') || []).map((a) => ({
            name: (a.textContent || '').trim(),
            url: (a as HTMLAnchorElement).href || a.getAttribute('href') || '',
          }));

        const descriptionImageUrls: string[] = [];
        if (descEl) {
          const imgs = Array.from(
            descEl.querySelectorAll('img[src]')
          ) as HTMLImageElement[];
          for (const img of imgs) {
            const src = img.getAttribute('src') || '';
            if (!src) continue;
            try {
              descriptionImageUrls.push(new URL(src, pageUrl).href);
            } catch {
              // ignore invalid URLs
            }
          }
        }
        const descriptionImageUrlsUnique = Array.from(
          new Set(descriptionImageUrls)
        );
        const descriptionImageSet = new Set(descriptionImageUrlsUnique);

        const pluginAnchors = Array.from(
          document.querySelectorAll('a[href*="pluginfile.php"]')
        ) as HTMLAnchorElement[];
        const attachments: Attachment[] = [];

        const classifyKind = (href: string): AttachmentKind => {
          const h = href.toLowerCase();
          if (h.includes('.pdf')) return 'pdf';
          if (h.includes('.docx')) return 'docx';
          if (h.includes('.pptx')) return 'pptx';
          if (h.match(/\.(png|jpe?g|gif|webp)(\?|#|$)/i)) return 'image';
          if (h.includes('.csv')) return 'csv';
          return 'other';
        };

        for (const a of pluginAnchors) {
          const href = a.href || a.getAttribute('href') || '';
          if (!href) continue;
          let abs = href;
          try {
            abs = new URL(href, pageUrl).href;
          } catch {
            // ignore
          }

          if (descriptionImageSet.has(abs)) continue;
          if (attachments.length >= 20) break;

          const name = (a.textContent || '').trim() || '';
          const kind = classifyKind(abs);
          attachments.push({
            url: abs,
            kind,
            name: name || undefined,
            hint: 'Use the get_file_text tool to read this file.',
          });
        }

        const uniqueAttachments: Attachment[] = [];
        const seen = new Set<string>();
        for (const att of attachments) {
          if (seen.has(att.url)) continue;
          seen.add(att.url);
          uniqueAttachments.push(att);
        }

        const tables: Element[] = [];
        let tableSelectorMatch:
          | { candidateId: string; selector: string; count: number }
          | undefined;
        for (const candidate of selectors.statusTable) {
          const found = Array.from(
            document.querySelectorAll(candidate.selector)
          );
          if (found.length > 0) {
            tables.push(...found);
            if (!tableSelectorMatch) {
              tableSelectorMatch = {
                candidateId: candidate.id,
                selector: candidate.selector,
                count: found.length,
              };
            }
          }
        }
        const fields: Record<string, string> = {};

        for (const table of tables) {
          const rows = Array.from(table.querySelectorAll('tr'));
          for (const r of rows) {
            const k = (r.querySelector('th')?.textContent || '').trim();
            let v = (r.querySelector('td')?.textContent || '').trim();

            if (!k) continue;

            if (k === 'Submission comments') {
              const commentMessages = Array.from(
                r.querySelectorAll('.comment-message, .commentscontainer .text')
              );
              if (commentMessages.length > 0) {
                const cleanMsgs = commentMessages
                  .map((m) => m.textContent?.trim())
                  .filter((txt) => txt && !txt.includes('___'));
                if (cleanMsgs.length > 0) v = cleanMsgs.join('\n');
              } else {
                v = v
                  .replace(/Show comments/g, '')
                  .replace(/Comments\s*\(\d+\)/g, '')
                  .replace(/Save comment\s*\|\s*Cancel/g, '')
                  .trim();
              }
            }

            fields[k] = v;
          }
        }

        const dedicatedFeedback = document.querySelector(
          '.assignfeedback_comments, .feedback-comments, .feedback .no-overflow'
        );
        let extraFeedback = '';
        if (dedicatedFeedback) {
          extraFeedback = dedicatedFeedback.textContent?.trim() || '';
          if (
            fields['Feedback comments'] &&
            extraFeedback.includes(fields['Feedback comments'])
          ) {
            extraFeedback = '';
          }
        }

        const grade = fields['Grade'] || fields['Grading status'] || '';

        const finalFeedback = [
          fields['Feedback'],
          fields['Feedback comments'],
          fields['Submission comments'],
          extraFeedback,
        ]
          .filter((f) => f && f.length > 0)
          .filter((v, i, a) => a.indexOf(v) === i)
          .join('\n---\n');

        return {
          kind: 'assign' as const,
          url: pageUrl,
          courseId: courseId || undefined,
          title,
          descriptionHtml: descriptionHtml || undefined,
          descriptionText: descriptionText || undefined,
          descriptionImageUrls: descriptionImageUrlsUnique.length
            ? descriptionImageUrlsUnique
            : undefined,
          rawDescriptionLinks,
          descSelectorMatch,
          tableSelectorMatch,
          attachments: uniqueAttachments.length ? uniqueAttachments : undefined,
          fields: Object.keys(fields).length ? fields : undefined,
          grade: grade || undefined,
          feedbackText: finalFeedback || undefined,
        };
      },
      { url: safeUrl, selectors: selectorGroups }
    );

    if (data.descSelectorMatch) {
      logDomSelectorMatch({
        pageType: 'eclass.assignment',
        groupId: 'eclass.assignment.intro',
        candidateId: data.descSelectorMatch.candidateId,
        selector: data.descSelectorMatch.selector,
        matchCount: data.descSelectorMatch.count,
        url: typeof page.url === 'function' ? page.url() : undefined,
      });
    }
    if (data.tableSelectorMatch) {
      logDomSelectorMatch({
        pageType: 'eclass.assignment',
        groupId: 'eclass.assignment.status_table',
        candidateId: data.tableSelectorMatch.candidateId,
        selector: data.tableSelectorMatch.selector,
        matchCount: data.tableSelectorMatch.count,
        url: typeof page.url === 'function' ? page.url() : undefined,
      });
    }

    const {
      rawDescriptionLinks,
      descSelectorMatch: _descSelectorMatch,
      tableSelectorMatch: _tableSelectorMatch,
      ...rest
    } = data;
    const externalLinks = classifyDescriptionExternalLinks(
      rawDescriptionLinks || [],
      safeUrl
    );

    return {
      ...rest,
      externalLinks: externalLinks.length ? externalLinks : undefined,
    } as AssignmentDetails;
  } finally {
    await page.close();
    await context.close();
  }
}

function safeAssignmentFormUrl(value: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(value, baseUrl);
    if (parsed.protocol !== 'https:') return null;
    if (parsed.hostname.toLowerCase() !== 'eclass.yorku.ca') return null;
    if (!parsed.pathname.endsWith('/mod/assign/view.php')) return null;
    const action = parsed.searchParams.get('action') || '';
    if (!['editsubmission', 'addsubmission'].includes(action)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function getAssignmentSubmissionPreflight(
  session: EClassBrowserSession,
  url: string
): Promise<AssignmentSubmissionPreflightData> {
  const safeUrl = validateUrlForPolicy(url, 'eclass_item');
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    await page.goto(safeUrl, { waitUntil: 'load', timeout: 60000 });
    const currentPageUrl = getPageUrl(page);
    if (currentPageUrl) {
      validateFinalUrlForPolicy(currentPageUrl, 'eclass_item');
    }

    const data = await page.evaluate((pageUrl: string) => {
      const normalize = (value: string | null | undefined) =>
        (value || '').replace(/\s+/g, ' ').trim();
      const parseBytes = (value: string): number | undefined => {
        const match = value.match(
          /(\d+(?:\.\d+)?)\s*(bytes?|kb|kib|mb|mib|gb|gib)/i
        );
        if (!match) return undefined;
        const amount = Number(match[1]);
        const unit = match[2].toLowerCase();
        const multiplier = unit.startsWith('g')
          ? 1024 * 1024 * 1024
          : unit.startsWith('m')
            ? 1024 * 1024
            : unit.startsWith('k')
              ? 1024
              : 1;
        return Math.round(amount * multiplier);
      };
      const extractCmId = (candidateUrl: string): string | undefined => {
        try {
          return (
            new URL(candidateUrl, pageUrl).searchParams.get('id') || undefined
          );
        } catch {
          return undefined;
        }
      };

      const title =
        normalize(
          document.querySelector('h1')?.textContent || document.title
        ) || 'Assignment';
      const moodleWindow = window as Window & {
        M?: { cfg?: { courseId?: unknown } };
      };
      const rawCourseId = moodleWindow.M?.cfg?.courseId;
      const courseId =
        (typeof rawCourseId === 'string' || typeof rawCourseId === 'number'
          ? rawCourseId.toString()
          : '') ||
        document.body.className.match(/course-(\d+)/)?.[1] ||
        '';
      const cmId =
        extractCmId(pageUrl) ||
        document.body.className.match(/cmid-(\d+)/)?.[1] ||
        undefined;

      const fields: Record<string, string> = {};
      const tables = Array.from(
        document.querySelectorAll(
          '.submissionstatustable, .feedbacktable, .generaltable'
        )
      );
      for (const table of tables) {
        const rows = Array.from(table.querySelectorAll('tr'));
        for (const row of rows) {
          const key = normalize(row.querySelector('th')?.textContent);
          const value = normalize(row.querySelector('td')?.textContent);
          if (key && value) fields[key] = value;
        }
      }

      const allText = normalize(document.body?.innerText || '');
      const dueDate =
        fields['Due date'] ||
        fields['Due'] ||
        allText.match(/Due date\s+([^.]+)/i)?.[1]?.trim() ||
        undefined;
      const cutoffDate =
        fields['Cut-off date'] ||
        fields['Cutoff date'] ||
        allText.match(/Cut-off date\s+([^.]+)/i)?.[1]?.trim() ||
        undefined;
      const submissionState =
        fields['Submission status'] ||
        fields['Status'] ||
        fields['Attempt state'] ||
        undefined;
      const gradingState =
        fields['Grading status'] || fields['Grade'] || undefined;

      const anchors = Array.from(document.querySelectorAll('a[href]')).map(
        (anchor) => {
          const href =
            (anchor as HTMLAnchorElement).href ||
            anchor.getAttribute('href') ||
            '';
          return {
            href,
            text: normalize(anchor.textContent),
          };
        }
      );
      const editLink =
        anchors.find((anchor) => /^(add|edit)\s+submission$/i.test(anchor.text))
          ?.href || '';
      const submitFinalLink =
        anchors.find((anchor) => /submit assignment/i.test(anchor.text))
          ?.href || '';

      const currentFiles = anchors
        .filter((anchor) => anchor.href.includes('pluginfile.php'))
        .map((anchor) => ({ name: anchor.text || anchor.href }))
        .filter((file, index, array) => {
          return (
            array.findIndex((candidate) => candidate.name === file.name) ===
            index
          );
        });

      const lowerState = `${submissionState || ''} ${allText}`.toLowerCase();
      const isFinalized =
        /submitted for grading|already submitted|submission is closed|no more submissions/i.test(
          lowerState
        ) && !editLink;

      return {
        url: pageUrl,
        title,
        courseId: courseId || undefined,
        cmId,
        dueDate,
        cutoffDate,
        submissionState,
        gradingState,
        isFinalized,
        canEditSubmission: Boolean(editLink),
        canSubmitFinal: Boolean(submitFinalLink),
        fields,
        currentFiles,
        editUrl: editLink || undefined,
        bodyMaxBytes: parseBytes(
          allText.match(/Maximum file size[^.]*/i)?.[0] || ''
        ),
        bodyMaxFiles:
          Number(
            allText.match(/Maximum number of files\s*:?\s*(\d+)/i)?.[1] || ''
          ) || undefined,
      };
    }, safeUrl);

    const uploadSlots = [...extractReadOnlySlotsFromFields(data)];
    const formUrl = data.editUrl
      ? safeAssignmentFormUrl(data.editUrl, data.url)
      : null;
    if (formUrl) {
      await page.goto(formUrl, { waitUntil: 'load', timeout: 60000 });
      const formPageUrl = getPageUrl(page);
      if (formPageUrl) {
        validateFinalUrlForPolicy(formPageUrl, 'eclass_item');
      }
      const formSlots = await page.evaluate(() => {
        const normalize = (value: string | null | undefined) =>
          (value || '').replace(/\s+/g, ' ').trim();
        const parseBytes = (value: string): number | undefined => {
          const match = value.match(
            /(\d+(?:\.\d+)?)\s*(bytes?|kb|kib|mb|mib|gb|gib)/i
          );
          if (!match) return undefined;
          const amount = Number(match[1]);
          const unit = match[2].toLowerCase();
          const multiplier = unit.startsWith('g')
            ? 1024 * 1024 * 1024
            : unit.startsWith('m')
              ? 1024 * 1024
              : unit.startsWith('k')
                ? 1024
                : 1;
          return Math.round(amount * multiplier);
        };
        const bodyText = normalize(document.body?.innerText || '');
        const fileManagers = Array.from(
          document.querySelectorAll<HTMLElement>(
            '.filemanager, [data-fieldtype="filemanager"], input[name*="filemanager"]'
          )
        );
        const slots: Array<{
          kind: 'file' | 'online_text';
          label: string;
          canUpload: boolean;
          maxBytes?: number;
          maxFiles?: number;
          accepts?: string[];
        }> = fileManagers.length
          ? [
              {
                kind: 'file' as const,
                label: 'File submissions',
                canUpload: true,
                maxBytes: parseBytes(
                  bodyText.match(/Maximum file size[^.]*/i)?.[0] || ''
                ),
                maxFiles:
                  Number(
                    bodyText.match(
                      /Maximum number of files\s*:?\s*(\d+)/i
                    )?.[1] || ''
                  ) || undefined,
                accepts: Array.from(
                  new Set(
                    Array.from(
                      document.querySelectorAll<HTMLInputElement>(
                        'input[accept]'
                      )
                    )
                      .flatMap((input) => (input.accept || '').split(','))
                      .map((item) => item.trim())
                      .filter(Boolean)
                  )
                ),
              },
            ]
          : [];
        const onlineText = document.querySelector(
          'textarea[name*="onlinetext"], [data-fieldtype="editor"] textarea'
        );
        if (onlineText) {
          slots.push({
            kind: 'online_text' as const,
            label: 'Online text',
            canUpload: true,
          });
        }
        return slots;
      });
      uploadSlots.push(...formSlots);
    }

    const dedupedSlots = dedupeUploadSlots(uploadSlots);
    if (
      data.currentFiles.length > 0 &&
      !dedupedSlots.some((slot) => slot.kind === 'file')
    ) {
      dedupedSlots.push({
        kind: 'file',
        label: 'File submissions',
        canUpload: Boolean(data.canEditSubmission),
        maxBytes: data.bodyMaxBytes,
        maxFiles: data.bodyMaxFiles,
        currentFiles: data.currentFiles,
      });
    } else if (data.currentFiles.length > 0) {
      for (const slot of dedupedSlots) {
        if (slot.kind === 'file' && !slot.currentFiles) {
          slot.currentFiles = data.currentFiles;
        }
      }
    }

    return {
      kind: 'assign',
      url: data.url,
      courseId: data.courseId,
      title: data.title,
      cmId: data.cmId,
      dueDate: data.dueDate,
      cutoffDate: data.cutoffDate,
      submissionState: data.submissionState,
      gradingState: data.gradingState,
      isFinalized: data.isFinalized,
      canEditSubmission: data.canEditSubmission,
      canSubmitFinal: data.canSubmitFinal,
      fields: Object.keys(data.fields).length ? data.fields : undefined,
      uploadSlots: dedupedSlots,
      warnings: formUrl
        ? undefined
        : data.canEditSubmission
          ? ['Could not safely inspect the edit-submission form URL.']
          : undefined,
    };
  } finally {
    await page.close();
    await context.close();
  }
}

function extractReadOnlySlotsFromFields(data: {
  currentFiles: { name: string; sizeBytes?: number; mimeType?: string }[];
  canEditSubmission: boolean;
  bodyMaxBytes?: number;
  bodyMaxFiles?: number;
}): AssignmentSubmissionPreflightData['uploadSlots'] {
  if (data.currentFiles.length === 0) return [];
  return [
    {
      kind: 'file',
      label: 'File submissions',
      canUpload: data.canEditSubmission,
      maxBytes: data.bodyMaxBytes,
      maxFiles: data.bodyMaxFiles,
      currentFiles: data.currentFiles,
    },
  ];
}

function dedupeUploadSlots(
  slots: AssignmentSubmissionPreflightData['uploadSlots']
): AssignmentSubmissionPreflightData['uploadSlots'] {
  const seen = new Set<string>();
  const result: AssignmentSubmissionPreflightData['uploadSlots'] = [];
  for (const slot of slots) {
    const key = `${slot.kind}:${slot.label || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(slot);
  }
  return result;
}

export async function getQuizDetails(
  session: EClassBrowserSession,
  url: string
): Promise<QuizDetails> {
  const safeUrl = validateUrlForPolicy(url, 'eclass_item');
  const context = await session.getAuthenticatedContext();
  const page = await context.newPage();
  try {
    await page.goto(safeUrl, { waitUntil: 'load', timeout: 60000 });
    const currentPageUrl = getPageUrl(page);
    if (currentPageUrl) {
      validateFinalUrlForPolicy(currentPageUrl, 'eclass_item');
    }
    const introSelectors = [
      ...getSelectorGroup('eclass.quiz.intro').candidates,
    ];
    const data = await page.evaluate(
      ({ pageUrl, selectors }) => {
        const title =
          (
            document.querySelector('h1')?.textContent ||
            document.title ||
            ''
          ).trim() || 'Quiz';
        const moodleWindow = window as Window & {
          M?: { cfg?: { courseId?: unknown } };
        };
        const rawCourseId = moodleWindow.M?.cfg?.courseId;
        const courseId =
          (typeof rawCourseId === 'string' || typeof rawCourseId === 'number'
            ? rawCourseId.toString()
            : '') ||
          document.body.className.match(/course-(\d+)/)?.[1] ||
          '';

        let descEl: HTMLElement | null = null;
        let descSelectorMatch:
          | { candidateId: string; selector: string; count: number }
          | undefined;
        for (const candidate of selectors) {
          const found = Array.from(
            document.querySelectorAll<HTMLElement>(candidate.selector)
          );
          if (found.length > 0) {
            descEl = found[0];
            descSelectorMatch = {
              candidateId: candidate.id,
              selector: candidate.selector,
              count: found.length,
            };
            break;
          }
        }

        const descriptionHtml = descEl?.innerHTML?.trim() || '';
        const descriptionText = descEl?.textContent?.trim() || '';
        const rawDescriptionLinks: Array<{ name: string; url: string }> =
          Array.from(descEl?.querySelectorAll('a[href]') || []).map((a) => ({
            name: (a.textContent || '').trim(),
            url: (a as HTMLAnchorElement).href || a.getAttribute('href') || '',
          }));

        const descriptionImageUrls: string[] = [];
        if (descEl) {
          const imgs = Array.from(
            descEl.querySelectorAll('img[src]')
          ) as HTMLImageElement[];
          for (const img of imgs) {
            const src = img.getAttribute('src') || '';
            if (!src) continue;
            try {
              descriptionImageUrls.push(new URL(src, pageUrl).href);
            } catch {
              // ignore invalid URLs
            }
          }
        }
        const descriptionImageUrlsUnique = Array.from(
          new Set(descriptionImageUrls)
        );
        const descriptionImageSet = new Set(descriptionImageUrlsUnique);

        const pluginAnchors = Array.from(
          document.querySelectorAll('a[href*="pluginfile.php"]')
        ) as HTMLAnchorElement[];
        const attachments: Attachment[] = [];

        const classifyKind = (href: string): AttachmentKind => {
          const h = href.toLowerCase();
          if (h.includes('.pdf')) return 'pdf';
          if (h.includes('.docx')) return 'docx';
          if (h.includes('.pptx')) return 'pptx';
          if (h.match(/\.(png|jpe?g|gif|webp)(\?|#|$)/i)) return 'image';
          if (h.includes('.csv')) return 'csv';
          return 'other';
        };

        for (const a of pluginAnchors) {
          const href = a.href || a.getAttribute('href') || '';
          if (!href) continue;
          let abs = href;
          try {
            abs = new URL(href, pageUrl).href;
          } catch {
            // ignore
          }

          if (descriptionImageSet.has(abs)) continue;
          if (attachments.length >= 20) break;

          const name = (a.textContent || '').trim() || '';
          const kind = classifyKind(abs);
          attachments.push({
            url: abs,
            kind,
            name: name || undefined,
            hint: 'Use the get_file_text tool to read this file.',
          });
        }

        const uniqueAttachments: Attachment[] = [];
        const seen = new Set<string>();
        for (const att of attachments) {
          if (seen.has(att.url)) continue;
          seen.add(att.url);
          uniqueAttachments.push(att);
        }

        const pageText = (document.body?.innerText || '')
          .replace(/\s+/g, ' ')
          .trim();

        const num = `(\\d+(?:\\.\\d+)?)`;
        const highestGradeMatch = pageText.match(
          new RegExp(`Highest grade:\\s*${num}\\s*\\/\\s*${num}`, 'i')
        );
        const gradeToPassMatch = pageText.match(
          new RegExp(`Grade to pass:\\s*${num}\\s*out of\\s*${num}`, 'i')
        );
        const markPercentMatch = pageText.match(
          new RegExp(`(?:Mark|Score):\\s*${num}\\s*%`, 'i')
        );

        let grade: string | undefined;
        if (highestGradeMatch) {
          grade = `${highestGradeMatch[1]} / ${highestGradeMatch[2]}`;
        } else if (markPercentMatch) {
          grade = `${markPercentMatch[1]}%`;
        } else if (gradeToPassMatch) {
          grade = `${gradeToPassMatch[1]} / ${gradeToPassMatch[2]} (to pass)`;
        }

        const table =
          (document.querySelector(
            'table.quizattemptsummary'
          ) as HTMLTableElement | null) ||
          (document.querySelector(
            'table.generaltable.quizattemptsummary'
          ) as HTMLTableElement | null) ||
          (document.querySelector('.quizattemptsummary') as HTMLElement | null);

        const fields: Record<string, string> = {};
        const tableEl =
          table && table.tagName === 'TABLE'
            ? (table as HTMLTableElement)
            : table
              ? (table.querySelector('table') as HTMLTableElement | null)
              : null;

        if (tableEl) {
          const rows = Array.from(tableEl.querySelectorAll('tr'));
          for (const r of rows) {
            const cells = Array.from(r.querySelectorAll('th, td'))
              .map((el) => (el.textContent || '').trim().replace(/\s+/g, ' '))
              .filter(Boolean);

            if (cells.length >= 2) {
              const k = cells[0];
              const v = cells.slice(1).join(' ').trim();
              if (
                k &&
                v &&
                (/(grade|mark|attempt|state)/i.test(k) ||
                  /\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?/.test(v))
              ) {
                fields[k] = v;
              }
            }
          }
        }

        if (!grade) {
          const candidateKeys = Object.keys(fields).filter((k) =>
            /grade|mark/i.test(k)
          );
          for (const k of candidateKeys) {
            const v = fields[k];
            if (/\d/.test(v) && (v.includes('/') || v.includes('%'))) {
              grade = v;
              break;
            }
          }
        }

        const feedbackMatch = pageText.match(/Feedback:\s*(.+?)(?:\n|$)/i);
        const feedbackText = feedbackMatch ? feedbackMatch[1].trim() : '';

        return {
          kind: 'quiz' as const,
          url: pageUrl,
          courseId: courseId || undefined,
          title,
          descriptionHtml: descriptionHtml || undefined,
          descriptionText: descriptionText || undefined,
          descriptionImageUrls: descriptionImageUrlsUnique.length
            ? descriptionImageUrlsUnique
            : undefined,
          rawDescriptionLinks,
          attachments: uniqueAttachments.length ? uniqueAttachments : undefined,
          fields: Object.keys(fields).length ? fields : undefined,
          grade: grade || undefined,
          feedbackText: feedbackText || undefined,
          descSelectorMatch,
        };
      },
      { pageUrl: safeUrl, selectors: introSelectors }
    );

    if (data.descSelectorMatch) {
      logDomSelectorMatch({
        pageType: 'eclass.quiz',
        groupId: 'eclass.quiz.intro',
        candidateId: data.descSelectorMatch.candidateId,
        selector: data.descSelectorMatch.selector,
        matchCount: data.descSelectorMatch.count,
        url: typeof page.url === 'function' ? page.url() : undefined,
      });
    }

    const {
      rawDescriptionLinks,
      descSelectorMatch: _descSelectorMatch,
      ...rest
    } = data;
    const externalLinks = classifyDescriptionExternalLinks(
      rawDescriptionLinks || [],
      safeUrl
    );

    return {
      ...rest,
      externalLinks: externalLinks.length ? externalLinks : undefined,
    } as QuizDetails;
  } finally {
    await page.close();
    await context.close();
  }
}
