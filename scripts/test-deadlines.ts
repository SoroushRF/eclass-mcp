import { getUpcomingDeadlines, getDeadlines } from '../src/tools/deadlines';
import { scraper } from '../src/scraper/eclass';

async function testDeadlines() {
  console.log('🏁 Starting Deadlines Tool Test...');
  
  try {
    // Back-compat: original tool
    const result = await getUpcomingDeadlines(30);
    
    console.log('\n📊 get_upcoming_deadlines RESULT:');
    const content = result.content[0].text;
    const deadlines = JSON.parse(content);
    
    console.log(`- Tool returned ${deadlines.length} items.`);
    
    deadlines.forEach((d: any, i: number) => {
      console.log(`  [${i + 1}] ${d.name}`);
      console.log(`      DUE: ${d.dueDate}`);
      console.log(`      ID:  ${d.id}`);
    });

    // New tool: upcoming
    const upcoming = await getDeadlines({ scope: 'upcoming' });
    const upcomingItems = JSON.parse(upcoming.content[0].text);
    console.log(`\n📊 get_deadlines(upcoming) returned ${upcomingItems.length} items.`);

    // New tool: month
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const monthRes = await getDeadlines({ scope: 'month', month, year });
    const monthItems = JSON.parse(monthRes.content[0].text);
    console.log(`📊 get_deadlines(month=${year}-${month}) returned ${monthItems.length} items.`);

    // New tool: range (last 7 days -> next 7 days)
    const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const rangeRes = await getDeadlines({ scope: 'range', from, to });
    const rangeItems = JSON.parse(rangeRes.content[0].text);
    console.log(`📊 get_deadlines(range) returned ${rangeItems.length} items.`);

  } catch (error) {
    console.error('❌ FATAL ERROR:', error);
  } finally {
    await scraper.close();
  }
}

testDeadlines();
