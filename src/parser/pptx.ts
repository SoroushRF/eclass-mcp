import AdmZip from 'adm-zip';

export async function parsePptx(buffer: Buffer): Promise<string> {
  try {
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    // Slide entries are typically in ppt/slides/
    const slideEntries = zipEntries
      .filter(
        (entry) =>
          entry.entryName.startsWith('ppt/slides/slide') &&
          entry.entryName.endsWith('.xml')
      )
      .sort((a, b) => {
        const aNum = parseInt(
          a.entryName.match(/slide(\d+)\.xml/)?.[1] || '0',
          10
        );
        const bNum = parseInt(
          b.entryName.match(/slide(\d+)\.xml/)?.[1] || '0',
          10
        );
        return aNum - bNum;
      });

    let overallText = '';

    for (const entry of slideEntries) {
      const slideNum = entry.entryName.match(/slide(\d+)\.xml/)?.[1] || '?';
      const content = zip.readAsText(entry);

      // Simple XML tag stripping: replace everything between < and > with nothing
      const text = content
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      overallText += `\n--- Slide ${slideNum} ---\n${text}\n`;
    }

    return overallText.trim();
  } catch (error) {
    console.error('Error parsing PPTX:', error);
    return '';
  }
}
