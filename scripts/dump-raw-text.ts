import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const htmlPath = path.resolve(__dirname, '../.eclass-mcp/webassign-dashboard.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const dom = new JSDOM(html);
const text = dom.window.document.body.textContent || '';
const cleanText = text.split('\n').map(s => s.trim()).filter(s => s.length > 2).join('\n');

fs.writeFileSync(path.resolve(__dirname, '../webassign-raw-text.txt'), cleanText);
console.log('Dumped raw text');
