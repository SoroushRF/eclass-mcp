const fs = require('fs');
const text = fs.readFileSync('debug-sections-out.txt', 'utf16le');
const lines = text.split('\n');
let currentCourse = '';
for (const line of lines) {
  if (line.includes('Checking:')) currentCourse = line.trim();
  if (line.includes('WARNING')) {
    console.log(currentCourse);
    console.log(line.trim());
  }
}
