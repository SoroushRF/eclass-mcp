import { scraper } from '../src/scraper/eclass';
import { getFileText } from '../src/tools/files';
import dotenv from 'dotenv';
dotenv.config();

async function testFileRead() {
  const fileUrl = 'https://eclass.yorku.ca/pluginfile.php/8851378/mod_assign/introattachment/0/EECS1021-Lab07B-Instruction.pdf?forcedownload=1';
  const courseId = '147149'; // Just a placeholder course ID
  
  try {
    console.log(`➡️  Testing PDF Read for: ${fileUrl}`);
    const result = await getFileText(courseId, fileUrl);
    
    // Check first couple of blocks
    const blocks = result.content;
    console.log(`✅ Found ${blocks.length} content blocks.`);
    
    blocks.slice(0, 3).forEach((b: any, i: number) => {
        if (b.type === 'text') {
            console.log(`Block ${i} (Text): ${b.text.substring(0, 200)}...`);
        } else if (b.type === 'image') {
            console.log(`Block ${i} (Image): [Base64 Data]`);
        }
    });

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await scraper.close();
  }
}

testFileRead();
