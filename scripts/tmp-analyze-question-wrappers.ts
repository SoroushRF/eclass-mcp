import fs from 'fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(
  '.eclass-mcp/debug/cengage-assignment-inspect/assignment1.html',
  'utf-8'
);
const doc = new JSDOM(html).window.document;

const wrappers = Array.from(
  doc.querySelectorAll('[data-analytics-tags*="questionId"]')
);
const headers = Array.from(
  doc.querySelectorAll('[data-test^="questionHeader"]')
);

const sample = headers.slice(0, 3).map((header, i) => {
  const parent = header.parentElement;
  const grand = parent?.parentElement;
  const siblings = parent
    ? Array.from(parent.children).map((child) => ({
        tag: child.tagName,
        dataTest: child.getAttribute('data-test') || '',
        cls: child.getAttribute('class') || '',
        text: (child.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 140),
      }))
    : [];

  const next = header.nextElementSibling;
  const nextText = (next?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

  return {
    idx: i + 1,
    headerDataTest: header.getAttribute('data-test') || '',
    headerText: (header.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180),
    parentTag: parent?.tagName || '',
    parentClass: parent?.getAttribute('class') || '',
    parentDataTest: parent?.getAttribute('data-test') || '',
    grandTag: grand?.tagName || '',
    grandClass: grand?.getAttribute('class') || '',
    grandDataTest: grand?.getAttribute('data-test') || '',
    siblingCount: siblings.length,
    siblings,
    nextTag: next?.tagName || '',
    nextClass: next?.getAttribute('class') || '',
    nextDataTest: next?.getAttribute('data-test') || '',
    nextText,
  };
});

const questionIdWrappers = wrappers.slice(0, 5).map((el) => ({
  tag: el.tagName,
  dataTest: el.getAttribute('data-test') || '',
  cls: el.getAttribute('class') || '',
  tags: (el.getAttribute('data-analytics-tags') || '').slice(0, 220),
  text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220),
}));

console.log(
  JSON.stringify(
    {
      counts: {
        questionHeaders: headers.length,
        questionIdWrappers: wrappers.length,
        questionBlocksByAria: doc.querySelectorAll(
          '[aria-label^="Banner for question"]'
        ).length,
        questionPanels: doc.querySelectorAll('[data-test*="question"]').length,
      },
      sample,
      questionIdWrappers,
    },
    null,
    2
  )
);
