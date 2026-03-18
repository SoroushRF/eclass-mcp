import { scraper } from '../src/scraper/eclass';
import { isSessionValid } from '../src/scraper/session';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

async function main() {
  console.log('--- eClass Scraper Diagnostic Test ---');
  
  // 1. Check Session
  if (!isSessionValid()) {
    console.error('ERROR: No valid session found. Please run "npm run dev" and visit http://localhost:3000/auth first.');
    process.exit(1);
  }
  console.log('✅ Session is valid.');

  try {
    // 2. Test getCourses
    console.log('\n1. Fetching Courses...');
    const courses = await scraper.getCourses();
    if (courses.length > 0) {
      console.log(`✅ Found ${courses.length} courses:`);
      courses.forEach(c => console.log(`   - [${c.id}] ${c.name}`));
      
      // 3. Test getCourseContent (for the first course)
      const testCourse = courses[0];
      console.log(`\n2. Fetching Content for "${testCourse.name}"...`);
      const content = await scraper.getCourseContent(testCourse.id);
      console.log(`✅ Found ${content.sections.length} sections.`);
      
      // 4. Test getDeadlines
      console.log('\n3. Fetching Upcoming Deadlines...');
      const deadlines = await scraper.getDeadlines();
      console.log(`✅ Found ${deadlines.length} assignments due.`);
      if (deadlines.length > 0) {
        deadlines.slice(0, 3).forEach(d => console.log(`   - ${d.name} (${d.dueDate})`));
      }

      // 5. Test getGrades
      console.log('\n4. Fetching Recent Grades...');
      const grades = await scraper.getGrades();
      console.log(`✅ Found ${grades.length} grade entries.`);

    } else {
      console.log('❌ No courses found. Check .eclass-mcp/debug/dashboard_empty.html');
    }

  } catch (error: any) {
    console.error('\n❌ TEST FAILED:', error.message);
  } finally {
    await scraper.close();
    console.log('\n--- Test Complete ---');
  }
}

main().catch(console.error);
