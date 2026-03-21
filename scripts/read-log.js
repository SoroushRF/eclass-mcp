const fs = require('fs');
const text = fs.readFileSync('debug-sections-out.txt', 'utf16le');
console.log(text);
