import {
  normalizeAndClassifyCengageEntry,
  type CengageEntryClassification,
  type CengageEntryLinkType,
} from '../../scraper/cengage-url';
import type {
  DiscoverCengageLinksInput,
  DiscoverCengageLinksResponse,
} from '../cengage-contracts';

const URL_REGEX_GLOBAL = /https?:\/\/[^\s<>'"\])]+/gi;

type DiscoveredLinkItem = DiscoverCengageLinksResponse['links'][number];

function normalizeExtractedUrl(raw: string): string {
  return raw
    .trim()
    .replace(/^<+/, '')
    .replace(/>+$/, '')
    .replace(/[),.;!?]+$/, '')
    .replace(/&amp;/gi, '&');
}

function isLikelyCengageHost(host: string): boolean {
  return (
    host.includes('webassign.net') ||
    host.includes('getenrolled.com') ||
    host.includes('cengage.com') ||
    host.includes('eclass.yorku.ca')
  );
}

function shouldIncludeClassification(
  classification: CengageEntryClassification
): boolean {
  if (classification.linkType !== 'other') {
    return true;
  }

  return isLikelyCengageHost(classification.host);
}

function calculateLinkConfidence(linkType: CengageEntryLinkType): number {
  switch (linkType) {
    case 'webassign_course':
      return 0.98;
    case 'eclass_lti':
      return 0.95;
    case 'webassign_dashboard':
      return 0.9;
    case 'cengage_dashboard':
      return 0.88;
    case 'cengage_login':
      return 0.76;
    default:
      return 0.55;
  }
}

function getLineAndColumn(
  text: string,
  index: number
): {
  line: number;
  column: number;
} {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  const column = index - lastNewline;
  return { line, column };
}

function buildSourceHint(
  text: string,
  matchIndex: number,
  input: DiscoverCengageLinksInput
): string {
  const { line, column } = getLineAndColumn(text, matchIndex);
  const parts = [`line:${line}`, `col:${column}`];

  if (input.courseId) {
    parts.push(`courseId:${input.courseId}`);
  }

  if (input.sectionUrl) {
    parts.push(`sectionUrl:${input.sectionUrl}`);
  }

  if (input.sourceFile?.fileName) {
    parts.push(`file:${input.sourceFile.fileName}`);
  }

  if (input.sourceFile?.fileUrl) {
    parts.push(`fileUrl:${input.sourceFile.fileUrl}`);
  }

  if (input.sourceFile?.fileType) {
    parts.push(`fileType:${input.sourceFile.fileType}`);
  }

  if (typeof input.sourceFile?.blockIndex === 'number') {
    parts.push(`block:${input.sourceFile.blockIndex}`);
  }

  return parts.join(' ');
}

function buildSourceFileMetadata(input: DiscoverCengageLinksInput) {
  const sourceFile = input.sourceFile;
  if (!sourceFile) {
    return undefined;
  }

  const metadata: NonNullable<DiscoveredLinkItem['sourceFile']> = {
    fileName: sourceFile.fileName,
    fileUrl: sourceFile.fileUrl,
    fileType: sourceFile.fileType,
    blockIndex: sourceFile.blockIndex,
  };

  if (
    metadata.fileName ||
    metadata.fileUrl ||
    metadata.fileType ||
    typeof metadata.blockIndex === 'number'
  ) {
    return metadata;
  }

  return undefined;
}

export function upsertDiscoveredLink(
  links: Map<string, DiscoveredLinkItem>,
  item: DiscoveredLinkItem
) {
  const key = `${item.normalizedUrl}|${item.source}`;
  const existing = links.get(key);
  if (!existing || (item.confidence || 0) > (existing.confidence || 0)) {
    links.set(key, item);
  }
}

export function discoverCengageLinksFromText(
  input: DiscoverCengageLinksInput
): DiscoverCengageLinksResponse {
  const source = input.source || 'manual';
  const links = new Map<string, DiscoveredLinkItem>();

  URL_REGEX_GLOBAL.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = URL_REGEX_GLOBAL.exec(input.text)) !== null) {
    const rawMatch = match[0];
    const candidate = normalizeExtractedUrl(rawMatch);

    try {
      const classification = normalizeAndClassifyCengageEntry(candidate);
      if (!shouldIncludeClassification(classification)) {
        continue;
      }

      const sourceFile = buildSourceFileMetadata(input);

      const item: DiscoveredLinkItem = {
        rawUrl: candidate,
        normalizedUrl: classification.normalizedUrl,
        linkType: classification.linkType,
        source,
        sourceHint: buildSourceHint(input.text, match.index, input),
        confidence: calculateLinkConfidence(classification.linkType),
        ...(sourceFile ? { sourceFile } : {}),
      };

      upsertDiscoveredLink(links, item);
    } catch {
      // Ignore malformed URL candidates during discovery.
    }
  }

  const discovered = Array.from(links.values());
  if (discovered.length === 0) {
    return {
      status: 'no_data',
      links: [],
      message:
        'No Cengage/WebAssign links were detected in the provided text. Include full URLs from eClass content, announcements, or files.',
    };
  }

  return {
    status: 'ok',
    links: discovered,
  };
}

export interface DiscoverCengageLinksFromFileBlocksInput {
  blocks: Array<{
    type?: string;
    text?: string;
  }>;
  sourceFile?: {
    fileName?: string;
    fileUrl?: string;
    fileType?: 'pdf' | 'docx' | 'pptx' | 'other';
  };
  courseId?: string;
}

export function discoverCengageLinksFromFileBlocks(
  input: DiscoverCengageLinksFromFileBlocksInput
): DiscoverCengageLinksResponse {
  const blocks = Array.isArray(input.blocks) ? input.blocks : [];
  const mined = new Map<string, DiscoveredLinkItem>();

  blocks.forEach((block, blockIndex) => {
    if (!block || (block.type && block.type !== 'text')) {
      return;
    }

    const text = (block.text || '').trim();
    if (!text) {
      return;
    }

    const blockResult = discoverCengageLinksFromText({
      text,
      source: 'file_text',
      courseId: input.courseId,
      sourceFile: {
        fileName: input.sourceFile?.fileName,
        fileUrl: input.sourceFile?.fileUrl,
        fileType: input.sourceFile?.fileType,
        blockIndex,
      },
    });

    if (blockResult.status !== 'ok') {
      return;
    }

    for (const link of blockResult.links) {
      upsertDiscoveredLink(mined, link);
    }
  });

  const links = Array.from(mined.values());
  if (links.length === 0) {
    return {
      status: 'no_data',
      links: [],
      message:
        'No Cengage/WebAssign links were detected in the provided file text blocks.',
    };
  }

  return {
    status: 'ok',
    links,
  };
}
