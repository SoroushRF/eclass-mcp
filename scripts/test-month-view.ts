import { scraper } from '../src/scraper/eclass';
import { isSessionValid } from '../src/scraper/session';

async function main() {
  if (!isSessionValid()) {
    console.error(
      'ERROR: No session file found or it is stale. Please visit http://localhost:3000/auth first.'
    );
    process.exit(1);
  }

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  try {
    console.log(
      `📅 Fetching month deadlines for ${year}-${String(month).padStart(2, '0')}...`
    );
    const items = await scraper.getMonthDeadlines(month, year);
    console.log(`✅ Found ${items.length} calendar items.`);
    items.slice(0, 10).forEach((it, idx) => {
      console.log(`[${idx + 1}] (${it.type}) ${it.name}`);
      console.log(`     dueDate: ${it.dueDate}`);
      console.log(`     courseId: ${it.courseId}`);
      console.log(`     url: ${it.url}`);
    });
  } finally {
    await scraper.close();
  }
}

main().catch((e) => {
  console.error('❌ ERROR:', e);
  process.exit(1);
});
