import { getItemDetails } from '../src/tools/deadlines';
import { isSessionValid } from '../src/scraper/session';

async function main() {
  if (!isSessionValid()) {
    console.error('ERROR: No session file found or it is stale. Run auth first at http://localhost:3000/auth.');
    process.exit(1);
  }

  const url = process.argv[2] || 'https://eclass.yorku.ca/mod/assign/view.php?id=4068184';
  const maxImages = process.argv[3] ? Number(process.argv[3]) : 3;
  const maxTotalImageBytes = process.argv[4] ? Number(process.argv[4]) : 200000;
  const imageOffset = process.argv[5] ? Number(process.argv[5]) : 0;

  console.log(`Testing get_item_details image mode: maxImages=${maxImages}, imageOffset=${imageOffset}`);
  console.log(`URL: ${url}`);

  const result = await getItemDetails({
    url,
    includeImages: true,
    maxImages,
    imageOffset,
    maxTotalImageBytes,
  });

  if (!result?.content?.length) {
    console.error('No tool content returned.');
    process.exit(1);
  }

  const textBlock = result.content.find((b: any) => b?.type === 'text');
  if (!textBlock?.text) {
    console.error('Missing first text metadata block.');
    process.exit(1);
  }

  const meta = JSON.parse(textBlock.text);
  console.log('\nCaps metadata:');
  console.log(JSON.stringify(
    {
      imageTotalCount: meta.imageTotalCount,
      imageOffset: meta.imageOffset,
      imagesReturnedCount: meta.imagesReturnedCount,
      imagesSkippedByBudget: meta.imagesSkippedByBudget,
      imagesRemainingCount: meta.imagesRemainingCount,
      nextImageOffset: meta.nextImageOffset,
      attachmentsCount: Array.isArray(meta.attachments) ? meta.attachments.length : 0,
      maxImages: meta.maxImages,
      maxTotalImageBytes: meta.maxTotalImageBytes,
      usedBase64BytesEstimate: meta.usedBase64BytesEstimate,
    },
    null,
    2
  ));

  const imageBlocks = result.content.filter((b: any) => b?.type === 'image');
  console.log(`\nAttached image blocks: ${imageBlocks.length}`);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});

