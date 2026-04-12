import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const htmlPath = path.resolve(__dirname, '../../.eclass-mcp/webassign-dashboard.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const dom = new JSDOM(html);
const document = dom.window.document;

const out: string[] = [];

// WebAssign often uses tables for assignments
const tables = document.querySelectorAll('table');
out.push(`Found ${tables.length} tables`);

tables.forEach((table, i) => {
  const text = table.textContent?.trim() || '';
  if (text.toLowerCase().includes('assignment') || text.toLowerCase().includes('due')) {
    out.push(`--- Table ${i} (ID: ${table.id}, Class: ${table.className}) ---`);
    out.push(text.split('\n').map(s => s.trim()).filter(s => s).join(' | '));
  }
});

// Also check for divs that might contain assignment info
const assignmentDivs = document.querySelectorAll('div');
assignmentDivs.forEach((div, i) => {
    const text = div.textContent?.trim() || '';
    if (div.id.toLowerCase().includes('assignment') || div.className.toLowerCase().includes('assignment')) {
        out.push(`--- Div ${i} (ID: ${div.id}, Class: ${div.className}) ---`);
        out.push(text.split('\n').map(s => s.trim()).filter(s => s).join(' | '));
    }
});

const outputDir = path.resolve(__dirname, '../output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
const outPath = path.join(outputDir, 'webassign-text-dump.txt');
fs.writeFileSync(outPath, out.join('\n'));
console.log(`Dumped text to ${outPath}`);
