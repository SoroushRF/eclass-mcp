import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const htmlPath = path.resolve(
  __dirname,
  '../../.eclass-mcp/webassign-dashboard.html'
);
const html = fs.readFileSync(htmlPath, 'utf-8');

const dom = new JSDOM(html);
const text = dom.window.document.body.textContent || '';
const cleanText = text
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s.length > 2)
  .join('\n');

const outputDir = path.resolve(__dirname, '../output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
const outPath = path.join(outputDir, 'webassign-raw-text.txt');

fs.writeFileSync(outPath, cleanText);
console.log(`Dumped raw text to ${outPath}`);
