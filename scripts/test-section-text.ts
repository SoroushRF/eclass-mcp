import { getSectionText } from '../src/tools/content';
import { scraper } from '../src/scraper/eclass';

async function testSectionText() {
  console.log('🧪 Testing get_section_text on Clubs 101 Section 4...');
  const url = 'https://eclass.yorku.ca/course/view.php?id=148310&section=4';
  
  try {
    const result = await getSectionText(url);
    const parsed = JSON.parse(result.content[0].text);
    
    const fs = require('fs');
    let log = '';
    log += '\n==================================';
    log += `\n📌 Title: ${parsed.title}`;
    log += '\n==================================';
    log += `\n--- MAIN TEXT ---`;
    log += '\n' + (parsed.mainText ? parsed.mainText : '(no main text)');
    if (parsed.mainLinks && parsed.mainLinks.length > 0) {
      log += '\n\nMain Links:';
      parsed.mainLinks.forEach((l: any) => log += `\n- [${l.name}](${l.url})`);
    }
    
    log += `\n\n--- TABS (${parsed.tabs.length} found) ---`;
    parsed.tabs.forEach((t: any, i: number) => {
      log += `\n\n[Tab ${i + 1}] ${t.title}`;
      log += '\n' + t.content;
      if (t.links && t.links.length > 0) {
        log += '\nLinks:';
        t.links.forEach((l: any) => log += `\n- [${l.name}](${l.url})`);
      }
    });
    fs.writeFileSync('scripts/section-text-output.txt', log, 'utf8');
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await scraper.close();
  }
}
testSectionText();
