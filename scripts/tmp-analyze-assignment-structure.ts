import fs from 'fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(
  '.eclass-mcp/debug/cengage-assignment-inspect/assignment1.html',
  'utf-8'
);
const doc = new JSDOM(html).window.document;

const idDetails = Array.from(doc.querySelectorAll('[id^="Q"]'))
  .slice(0, 12)
  .map((el) => {
    const parent = el.parentElement;
    return {
      id: el.id,
      tag: el.tagName,
      className: el.getAttribute('class') || '',
      dataTest: el.getAttribute('data-test') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      parentTag: parent?.tagName || '',
      parentClass: parent?.getAttribute('class') || '',
      parentDataTest: parent?.getAttribute('data-test') || '',
      parentText: (parent?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160),
    };
  });

const questionDataTest = Array.from(
  doc.querySelectorAll('[data-test*="question"]')
)
  .slice(0, 25)
  .map((el) => ({
    tag: el.tagName,
    id: el.getAttribute('id') || '',
    dataTest: el.getAttribute('data-test') || '',
    cls: el.getAttribute('class') || '',
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140),
  }));

const questionLabelCandidates = Array.from(
  doc.querySelectorAll('[aria-label*="Question" i]')
)
  .slice(0, 25)
  .map((el) => ({
    tag: el.tagName,
    id: el.getAttribute('id') || '',
    ariaLabel: el.getAttribute('aria-label') || '',
    dataTest: el.getAttribute('data-test') || '',
    cls: el.getAttribute('class') || '',
    text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
  }));

console.log(
  JSON.stringify(
    { idDetails, questionDataTest, questionLabelCandidates },
    null,
    2
  )
);
