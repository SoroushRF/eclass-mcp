import fs from 'fs';
import path from 'path';
import jsdom, { JSDOM } from 'jsdom';

const htmlPath = path.resolve(
  __dirname,
  '../../.eclass-mcp/cengage-dashboard.html'
);
const html = fs.readFileSync(htmlPath, 'utf-8');

const dom = new JSDOM(html);
const document = dom.window.document;

const out: string[] = [];
function traverseLinks(node: any) {
  if (node.tagName && node.tagName.toLowerCase() === 'a') {
    out.push(`${node.textContent?.trim()} -> ${node.href}`);
  }
  for (let i = 0; i < node.childNodes.length; i++) {
    traverseLinks(node.childNodes[i]);
  }
}

const mainContent = document.getElementById('reactMagmaMainContent');
if (mainContent) {
  traverseLinks(mainContent);
} else {
  traverseLinks(document.body);
}

const outputDir = path.resolve(__dirname, '../output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}
const outPath = path.join(outputDir, 'cengage-links-dump.txt');
fs.writeFileSync(outPath, out.join('\n'));
console.log(`Dumped links to ${outPath}`);
