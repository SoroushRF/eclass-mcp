import { scraper } from '../src/scraper/eclass';
import { isSessionValid } from '../src/scraper/session';

async function main() {
  if (!isSessionValid()) {
    console.error('ERROR: No session file found or it is stale. Please visit http://localhost:3000/auth first.');
    process.exit(1);
  }

  try {
    console.log('🔎 Discovering a couple of upcoming items to test details...');
    const items = await scraper.getDeadlines();

    const urls = items
      .map((i) => i.url)
      .filter(Boolean)
      .slice(0, 2);

    if (urls.length === 0) {
      console.log('No upcoming assignment/quiz URLs found to test.');
      return;
    }

    for (const url of urls) {
      console.log(`\n➡️  Fetching details for ${url}`);
      const details = await scraper.getItemDetails(url);
      console.log(JSON.stringify(details, null, 2));
    }
  } finally {
    await scraper.close();
  }
}

main().catch((e) => {
  console.error('❌ ERROR:', e);
  process.exit(1);
});

