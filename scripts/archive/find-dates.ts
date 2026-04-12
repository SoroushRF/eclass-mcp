import fs from 'fs';
import path from 'path';

const htmlPath = path.resolve(__dirname, '../../.eclass-mcp/webassign-dashboard.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const regex = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+/gi;
let match;
const matches = [];

while ((match = regex.exec(html)) !== null) {
    const start = Math.max(0, match.index - 100);
    const end = Math.min(html.length, match.index + 200);
    matches.push(`Match: ${match[0]}\nContext: ${html.slice(start, end)}\n---`);
}

const outputDir = path.resolve(__dirname, '../output');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}
const outPath = path.join(outputDir, 'webassign-matches.txt');
fs.writeFileSync(outPath, matches.join('\n'));
console.log(`Found ${matches.length} matches and wrote to ${outPath}`);
