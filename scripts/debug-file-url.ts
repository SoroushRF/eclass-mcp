/**
 * Debug script: dumps raw HTTP response + rendered page HTML for a file URL.
 * Usage: npx ts-node scripts/debug-file-url.ts <fileUrl>
 * Example: npx ts-node scripts/debug-file-url.ts "https://eclass.yorku.ca/mod/resource/view.php?id=4083221"
 */
import { chromium } from 'playwright';
import { loadSession } from '../src/scraper/session';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const fileUrl = process.argv[2];
if (!fileUrl) {
  console.error('Usage: npx ts-node scripts/debug-file-url.ts <fileUrl>');
  process.exit(1);
}

const debugDir = path.join(__dirname, '..', '.eclass-mcp', 'debug');
if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

async function main() {
  const cookies = loadSession();
  if (!cookies) {
    console.error('No valid session. Run the auth server first.');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(cookies);

  // --- Step 1: Raw HTTP request ---
  console.log('\n=== PHASE 1: Raw HTTP Request ===');
  const res = await context.request.get(fileUrl, { maxRedirects: 10 });
  const rawHeaders = res.headers();
  const rawBody = await res.body();
  const rawMime = rawHeaders['content-type'] || 'unknown';

  console.log(`Status:       ${res.status()}`);
  console.log(`Final URL:    ${res.url()}`);
  console.log(`Content-Type: ${rawMime}`);
  console.log(`Body size:    ${rawBody.length} bytes`);
  console.log(`Content-Disposition: ${rawHeaders['content-disposition'] || '(none)'}`);

  const rawDumpPath = path.join(debugDir, 'raw_response.html');
  fs.writeFileSync(rawDumpPath, rawBody);
  console.log(`\nRaw body saved to: ${rawDumpPath}`);

  // --- Step 2: Rendered page (JS executed) ---
  console.log('\n=== PHASE 2: Playwright Page (JS rendered) ===');
  const page = await context.newPage();
  const interceptedUrls: { url: string, type: string, size: number }[] = [];

  page.on('response', async (resp) => {
    const ct = resp.headers()['content-type'] || '';
    const isNoise = ct.includes('text/javascript') || ct.includes('text/css') || ct.includes('image/') || ct.includes('font/');
    if (!isNoise) {
      try {
        const body = await resp.body();
        interceptedUrls.push({ url: resp.url(), type: ct, size: body.length });
      } catch { /* already consumed */ }
    }
  });

  await page.goto(fileUrl, { waitUntil: 'networkidle', timeout: 20000 });

  const renderedHtml = await page.content();
  const renderedDumpPath = path.join(debugDir, 'rendered_page.html');
  fs.writeFileSync(renderedDumpPath, renderedHtml);
  console.log(`Rendered HTML saved to: ${renderedDumpPath}`);

  console.log('\n--- All non-noise network responses intercepted ---');
  interceptedUrls.forEach(r => {
    console.log(`  [${r.size.toString().padStart(8)} bytes] ${r.type.padEnd(50)} ${r.url}`);
  });

  await page.close();
  await browser.close();

  console.log('\n=== Done. Check .eclass-mcp/debug/ for the dumped files. ===');
}

main().catch(console.error);
