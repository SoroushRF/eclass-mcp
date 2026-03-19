import { getUpcomingDeadlines } from '../src/tools/deadlines';
import { scraper } from '../src/scraper/eclass';

async function deepDebug() {
  console.log('🧪 Starting DEEP DEBUG for Deadlines Date Parsing...');
  
  try {
    const deadlines = await scraper.getDeadlines();
    console.log(`📡 Scraper found ${deadlines.length} events on page.`);

    console.log('\n🔍 DRY RUN OF DATE TRANSFORMATIONS:');
    const now = new Date();
    const currentYear = now.getFullYear();

    deadlines.forEach((d, i) => {
      console.log(`\n[${i+1}] Processing: "${d.name}"`);
      console.log(`    Raw Date String: "${d.dueDate}"`);
      
      // Step 1: Clean Parse
      let date = new Date(d.dueDate);
      console.log(`    Standard Parse Result: ${isNaN(date.getTime()) ? 'FAILED' : date.toISOString()}`);

      // Step 2: Regex Fix
      const match = d.dueDate.match(/(\d+)\s+([A-Za-z]+)/);
      if (match) {
        const day = match[1];
        const month = match[2];
        console.log(`    Regex Found: Day=${day}, Month=${month}`);
        date = new Date(`${month} ${day}, ${currentYear}`);
        console.log(`    Manual Parse Result: ${date.toISOString()}`);
        console.log(`    Is >= Now (${now.toISOString()})? ${date >= now}`);
      } else {
        console.log('    Regex FAILED to find day/month.');
      }
    });

    const result = await getUpcomingDeadlines(30);
    const finalCount = JSON.parse(result.content[0].text).length;
    console.log(`\n🏁 FINAL TOOL RESULT: ${finalCount} assignments.`);

  } catch (error) {
    console.error('❌ ERROR:', error);
  } finally {
    await scraper.close();
  }
}

deepDebug();
