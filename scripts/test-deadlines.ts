import { getUpcomingDeadlines, getDeadlines } from '../src/tools/deadlines';
import { scraper } from '../src/scraper/eclass';

async function testDeadlines() {
  console.log('🏁 Starting Deadlines Tool Test...');

  try {
    // Back-compat: original tool
    const result = await getUpcomingDeadlines({ daysAhead: 30 } as any);

    console.log('\n📊 get_upcoming_deadlines RESULT:');
    const content = JSON.parse(result.content[0].text);
    const deadlines = content.items || [];
    const meta = content._cache;

    console.log(
      `- Tool returned ${deadlines.length} items. Cache hit: ${meta?.hit}`
    );
    console.log(`- Fetched at: ${meta?.fetched_at}`);

    deadlines.forEach((d: any, i: number) => {
      console.log(`  [${i + 1}] ${d.name}`);
    });

    // New tool: upcoming
    const upcoming = await getDeadlines({ scope: 'upcoming' });
    const upcomingContent = JSON.parse(upcoming.content[0].text);
    const upcomingItems = upcomingContent.items || [];
    console.log(
      `\n📊 get_deadlines(upcoming) returned ${upcomingItems.length} items. Cache hit: ${upcomingContent._cache?.hit}`
    );

    // New tool: month
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const monthRes = await getDeadlines({ scope: 'month', month, year });
    const monthContent = JSON.parse(monthRes.content[0].text);
    const monthItems = monthContent.items || [];
    console.log(
      `📊 get_deadlines(month=${year}-${month}) returned ${monthItems.length} items. Cache hit: ${monthContent._cache?.hit}`
    );

    // New tool: range (last 7 days -> next 7 days)
    const from = new Date(
      now.getTime() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const rangeRes = await getDeadlines({ scope: 'range', from, to });
    const rangeContent = JSON.parse(rangeRes.content[0].text);
    const rangeItems = rangeContent.items || [];
    console.log(
      `📊 get_deadlines(range) returned ${rangeItems.length} items. Cache hit: ${rangeContent._cache?.hit}`
    );
  } catch (error) {
    console.error('❌ FATAL ERROR:', error);
  } finally {
    await scraper.close();
  }
}

testDeadlines();
