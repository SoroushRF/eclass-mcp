const fs = require('fs');
const text = fs.readFileSync('debug-sections-out.txt', 'utf16le');
const lines = text.split('\n');
let currentCourse = '';
let report = '';
for (const line of lines) {
  if (line.includes('Checking:')) currentCourse = line.trim();
  if (line.includes('WARNING')) {
    report += currentCourse + '\n' + line.trim() + '\n\n';
  }
}
fs.writeFileSync('scripts/warnings.txt', report, 'utf8');
