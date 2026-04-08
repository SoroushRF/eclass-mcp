import fs from 'fs';
import path from 'path';
import { JSDOM } from 'jsdom';

const htmlPath = path.resolve(__dirname, '../.eclass-mcp/webassign-dashboard.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const dom = new JSDOM(html);
const document = dom.window.document;

const assignments: any[] = [];

// Look for anything that looks like an assignment row
// In WebAssign React, they often use <li> or <div> with specific classes
const items = document.querySelectorAll('li, tr, div[role="row"]');

items.forEach((item) => {
    const text = item.textContent?.trim() || '';
    if (text.toLowerCase().includes('homework') || text.toLowerCase().includes('quiz') || text.toLowerCase().includes('test')) {
        // Try to find a date
        const dateMatch = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+/i);
        if (dateMatch) {
            assignments.push({
                text: text.replace(/\s+/g, ' ').slice(0, 200),
                date: dateMatch[0]
            });
        }
    }
});

console.log(JSON.stringify(assignments, null, 2));
fs.writeFileSync(path.resolve(__dirname, '../webassign-final-list.json'), JSON.stringify(assignments, null, 2));
