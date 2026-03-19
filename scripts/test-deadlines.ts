import { getUpcomingDeadlines } from '../src/tools/deadlines';
import { scraper } from '../src/scraper/eclass';

async function testDeadlines() {
  console.log('🏁 Starting Deadlines Tool Test (Filtering + Parsing)...');
  
  try {
    // Calling the actual tool function with a 30-day window
    const result = await getUpcomingDeadlines(30);
    
    console.log('\n📊 FILTERED TOOL RESULT:');
    const content = result.content[0].text;
    const deadlines = JSON.parse(content);
    
    console.log(`- Tool returned ${deadlines.length} assignments due in the next 30 days.`);
    
    deadlines.forEach((d: any, i: number) => {
      console.log(`  [${i + 1}] ${d.name}`);
      console.log(`      DUE: ${d.dueDate}`);
      console.log(`      ID:  ${d.id}`);
    });

  } catch (error) {
    console.error('❌ FATAL ERROR:', error);
  } finally {
    await scraper.close();
  }
}

testDeadlines();
