import { scraper, SessionExpiredError } from '../src/scraper/eclass';
import { isSessionValid } from '../src/scraper/session';
import { startAuthServer, openAuthWindow } from '../src/auth/server';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

async function main() {
  console.log('--- eClass Scraper Diagnostic Test ---');

  // 1. Check Session
  if (!isSessionValid()) {
    console.error(
      'ERROR: No session file found or it is stale. Please visit http://localhost:3000/auth first.'
    );
    process.exit(1);
  }
  console.log(
    '✅ Session file found (local check). Verifying eligibility during data fetch...'
  );

  try {
    // 2. Test getCourses
    console.log('\n1. Fetching Courses...');
    const courses = await scraper.getCourses();
    if (courses.length > 0) {
      console.log(`✅ Found ${courses.length} courses:`);
      courses.forEach((c) => console.log(`   - [${c.id}] ${c.name}`));

      // 3. Test getCourseContent (Find a course with resources)
      let testCourse = courses[0];
      let content: any = { sections: [] };
      let testResourceUrl = '';
      let testResourceName = '';

      for (let i = 0; i < Math.min(courses.length, 5); i++) {
        console.log(`\n2. Fetching Content for "${courses[i].name}"...`);
        content = await scraper.getCourseContent(courses[i].id);
        console.log(`✅ Found ${content.sections.length} sections.`);

        for (const sec of content.sections) {
          const resource = sec.items.find(
            (item: any) => item.type === 'resource' && item.url
          );
          if (resource) {
            testResourceUrl = resource.url;
            testResourceName = resource.name;
            break;
          }
        }

        if (testResourceUrl) {
          testCourse = courses[i];
          break; // Stop once we find a course with a resource
        }
      }

      // 3.5 Test downloadFile
      console.log(`\n2.5 Testing File Download...`);
      if (testResourceUrl) {
        console.log(
          `   - Found resource to test in "${testCourse.name}": ${testResourceName} (${testResourceUrl})`
        );
        try {
          const fileData = await scraper.downloadFile(testResourceUrl);
          console.log(`✅ File downloaded successfully!`);
          console.log(`   - Filename: ${fileData.filename}`);
          console.log(`   - Mime Type: ${fileData.mimeType}`);
          console.log(
            `   - Size: ${(fileData.buffer.length / 1024).toFixed(2)} KB`
          );

          // Write to a debug file to verify it actually downloaded a real PDF/DOCX
          const debugDir = path.join(__dirname, '..', '.eclass-mcp', 'debug');
          if (!require('fs').existsSync(debugDir)) {
            require('fs').mkdirSync(debugDir, { recursive: true });
          }
          const outPath = path.join(debugDir, fileData.filename);
          require('fs').writeFileSync(outPath, fileData.buffer);
          console.log(`   - Saved to: ${outPath}`);
        } catch (e: any) {
          console.error(`❌ File download failed:`, e.message);
        }
      } else {
        console.log(`   - No resources found in course to test downloading.`);
      }

      // 4. Test getDeadlines
      console.log('\n3. Fetching Upcoming Deadlines...');
      const deadlines = await scraper.getDeadlines();
      console.log(`✅ Found ${deadlines.length} assignments due.`);
      if (deadlines.length > 0) {
        deadlines
          .slice(0, 3)
          .forEach((d) => console.log(`   - ${d.name} (${d.dueDate})`));
      }

      // 5. Test getGrades
      console.log('\n4. Fetching Recent Grades...');
      const grades = await scraper.getGrades();
      console.log(`✅ Found ${grades.length} grade entries.`);
    } else {
      console.log(
        '❌ No courses found. Check .eclass-mcp/debug/dashboard_empty.html'
      );
    }
  } catch (error: any) {
    if (error instanceof SessionExpiredError) {
      console.error(
        '\n❌ SESSION EXPIRED. Starting auth server and opening login window...'
      );
      startAuthServer();
      openAuthWindow();
      // Keep process alive for a bit so the user can interact
      console.log(
        "Use http://localhost:3000/auth if the window didn't open. Press Ctrl+C to stop the test."
      );
      await new Promise(() => {}); // Wait indefinitely for user to handle login
    } else {
      console.error('\n❌ TEST FAILED:', error.message);
    }
  } finally {
    await scraper.close();
    console.log('\n--- Test Complete ---');
  }
}

main().catch(console.error);
