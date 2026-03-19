/**
 * Standalone PDF Parser Test Script
 * Usage: npx ts-node scripts/test-pdf-parser.ts <path-to-pdf> [startPage] [endPage]
 *
 * Runs the full analysis + extraction pipeline on a local PDF file and outputs
 * a detailed report of page classifications, content previews, and rendered images.
 */

import fs from 'fs';
import path from 'path';
import { analyzePages, parsePdfSmart, ContentBlock } from '../src/parser/pdf-analyzer';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.error('Usage: npx ts-node scripts/test-pdf-parser.ts <pdf-path> [startPage] [endPage]');
    console.error('Example: npx ts-node scripts/test-pdf-parser.ts ./sample.pdf');
    console.error('Example: npx ts-node scripts/test-pdf-parser.ts ./sample.pdf 5 10');
    process.exit(1);
  }

  const pdfPath = path.resolve(args[0]);
  const startPage = args[1] ? parseInt(args[1], 10) : undefined;
  const endPage = args[2] ? parseInt(args[2], 10) : undefined;

  if (!fs.existsSync(pdfPath)) {
    console.error(`ERROR: File not found: ${pdfPath}`);
    process.exit(1);
  }

  const buffer = fs.readFileSync(pdfPath);
  const fileSizeKB = (buffer.length / 1024).toFixed(1);
  console.log(`\n📄 Testing PDF: ${path.basename(pdfPath)} (${fileSizeKB} KB)`);
  console.log('━'.repeat(60));

  // ── Phase 1: Full-document analysis ──────────────────────────
  console.log('\n🔍 Phase 1: Full-Document Page Analysis');
  console.log('─'.repeat(40));

  const analysisStart = Date.now();
  const analysis = await analyzePages(buffer);
  const analysisTime = Date.now() - analysisStart;

  const textPages = analysis.filter(p => p.classification === 'text');
  const imagePages = analysis.filter(p => p.classification === 'image');

  console.log(`Total pages:    ${analysis.length}`);
  console.log(`Text pages:     ${textPages.length}`);
  console.log(`Image pages:    ${imagePages.length}`);
  console.log(`Analysis time:  ${analysisTime}ms`);
  console.log('');

  // Per-page breakdown
  console.log('Page-by-page breakdown:');
  for (const page of analysis) {
    const icon = page.classification === 'image' ? '🖼️' : '📝';
    const imgFlag = page.hasImages ? ' [has images]' : '';
    console.log(`  ${icon} Page ${String(page.pageNum).padStart(3)}: ${page.classification.padEnd(5)} | ${page.textLength} chars${imgFlag}`);
  }

  // ── Phase 2: Smart extraction pipeline ───────────────────────
  const rangeLabel = startPage || endPage
    ? ` (pages ${startPage ?? 1}–${endPage ?? 'end'})`
    : '';
  console.log(`\n⚙️  Phase 2: Smart Extraction Pipeline${rangeLabel}`);
  console.log('─'.repeat(40));

  const extractStart = Date.now();
  const blocks = await parsePdfSmart(buffer, startPage, endPage);
  const extractTime = Date.now() - extractStart;

  const textBlocks = blocks.filter(b => b.type === 'text');
  const imageBlocks = blocks.filter(b => b.type === 'image');

  console.log(`\nExtraction complete in ${extractTime}ms`);
  console.log(`Total blocks:   ${blocks.length}`);
  console.log(`Text blocks:    ${textBlocks.length}`);
  console.log(`Image blocks:   ${imageBlocks.length}`);

  // ── Phase 3: Content preview ─────────────────────────────────
  console.log(`\n📋 Phase 3: Content Block Preview`);
  console.log('─'.repeat(40));

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === 'text') {
      const preview = (block.text || '').substring(0, 200).replace(/\n/g, '\\n');
      const totalLen = (block.text || '').length;
      console.log(`  [${i}] TEXT (${totalLen} chars): ${preview}${totalLen > 200 ? '...' : ''}`);
    } else if (block.type === 'image') {
      const sizeKB = ((block.data || '').length * 0.75 / 1024).toFixed(1); // base64 → bytes
      console.log(`  [${i}] IMAGE (${sizeKB} KB PNG)`);
    }
  }

  // ── Phase 4: Save rendered images to debug dir ─────────────
  if (imageBlocks.length > 0) {
    const debugDir = path.join(__dirname, '..', '.eclass-mcp', 'debug', 'pdf-test');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }

    console.log(`\n💾 Phase 4: Saving ${imageBlocks.length} rendered images to ${debugDir}`);
    console.log('─'.repeat(40));

    let imgIndex = 0;
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].type === 'image' && blocks[i].data) {
        imgIndex++;
        const outPath = path.join(debugDir, `page_${imgIndex}.png`);
        fs.writeFileSync(outPath, Buffer.from(blocks[i].data!, 'base64'));
        console.log(`  Saved: ${outPath}`);
      }
    }
  }

  // ── Summary ──────────────────────────────────────────────────
  console.log('\n📊 Summary');
  console.log('━'.repeat(60));
  console.log(`File:             ${path.basename(pdfPath)}`);
  console.log(`Total pages:      ${analysis.length}`);
  console.log(`Pages processed:  ${rangeLabel || 'all (up to 50)'}`);
  console.log(`Analysis time:    ${analysisTime}ms`);
  console.log(`Extraction time:  ${extractTime}ms`);
  console.log(`Total time:       ${analysisTime + extractTime}ms`);
  console.log(`Text blocks:      ${textBlocks.length}`);
  console.log(`Image blocks:     ${imageBlocks.length}`);

  const totalTextChars = textBlocks.reduce((sum, b) => sum + (b.text?.length || 0), 0);
  const totalImageKB = imageBlocks.reduce((sum, b) => sum + (b.data?.length || 0) * 0.75 / 1024, 0);
  console.log(`Total text:       ${totalTextChars} chars (~${Math.round(totalTextChars / 4)} tokens)`);
  console.log(`Total images:     ${totalImageKB.toFixed(1)} KB (~${imageBlocks.length * 1600} tokens)`);
  console.log(`Est. total cost:  ~${Math.round(totalTextChars / 4) + imageBlocks.length * 1600} tokens`);
  console.log('');
}

main().catch(err => {
  console.error('\n❌ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
