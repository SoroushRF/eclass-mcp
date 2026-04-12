import { SISScraper } from '../src/scraper/sis';

async function testSISScraper() {
  const scraper = new SISScraper();
  
  console.log('--- Testing Exam Schedule Scraper ---');
  try {
    const exams = await scraper.scrapeExams();
    console.log(`Successfully scraped ${exams.length} exams:`);
    console.log(JSON.stringify(exams, null, 2));
  } catch (error) {
    console.error('Error in Exam Scraper:', error);
  }

  console.log('\n--- Testing Timetable Scraper ---');
  try {
    const timetable = await scraper.scrapeTimetable();
    console.log(`Successfully scraped ${timetable.length} timetable entries:`);
    console.log(JSON.stringify(timetable, null, 2));
  } catch (error) {
    console.error('Error in Timetable Scraper:', error);
  }
}

testSISScraper().catch(console.error);
