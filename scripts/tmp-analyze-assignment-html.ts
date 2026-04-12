import fs from 'fs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(
  '.eclass-mcp/debug/cengage-assignment-inspect/assignment1.html',
  'utf-8'
);
const dom = new JSDOM(html);
const doc = dom.window.document;

const selectors = [
  '[id^="Q"]',
  'a[href*="#Q"]',
  '[data-test*="question"]',
  '[data-testid*="question"]',
  '[class*="question"]',
  '[class*="problem"]',
  '.problem-template',
  '.problem',
  '.question',
  'div[id^="Q"]',
  'section[id^="Q"]',
  'li[id^="Q"]',
  '[aria-label*="Question"]',
];

const counts: Record<string, number> = {};
for (const selector of selectors) {
  counts[selector] = doc.querySelectorAll(selector).length;
}

const nav = Array.from(doc.querySelectorAll('a[href*="#Q"]'))
  .slice(0, 15)
  .map((a) => ({
    text: (a.textContent || '').trim(),
    href: a.getAttribute('href') || '',
    cls: a.getAttribute('class') || '',
    dataTest: a.getAttribute('data-test') || '',
  }));

const ids = Array.from(doc.querySelectorAll('[id^="Q"]'))
  .slice(0, 30)
  .map((el) => el.id);

const qAnchors = Array.from(doc.querySelectorAll('a[href*="#Q"]'))
  .map((a) => (a.getAttribute('href') || '').match(/#Q\d+/)?.[0])
  .filter((value): value is string => !!value);

const uniqueQAnchors = Array.from(new Set(qAnchors));

const q1 = doc.querySelector('#Q1');
const q1text = q1
  ? (q1.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 700)
  : '';

console.log(
  JSON.stringify(
    {
      counts,
      nav,
      ids,
      uniqueQCount: uniqueQAnchors.length,
      uniqueQAnchors: uniqueQAnchors.slice(0, 50),
      q1text,
    },
    null,
    2
  )
);
