import crypto from 'crypto';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';
import type { AssignmentSubmissionPreflightResponse } from './write-contracts';

const MIME_BY_EXTENSION: Record<string, string> = {
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.java': 'text/x-java-source',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.zip': 'application/zip',
};

export interface IntendedUploadFileForSummary {
  path: string;
  displayName?: string;
  sizeBytes?: number;
  mimeType?: string;
  sha256?: string;
}

function inferMimeType(filePath: string): string {
  return (
    MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()] ||
    'application/octet-stream'
  );
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

export async function summarizeIntendedFiles(
  files: IntendedUploadFileForSummary[] | undefined
): Promise<{
  summaries: NonNullable<
    AssignmentSubmissionPreflightResponse['intendedFiles']
  >;
  blockers: string[];
}> {
  if (!files || files.length === 0) {
    return { summaries: [], blockers: [] };
  }

  const summaries: NonNullable<
    AssignmentSubmissionPreflightResponse['intendedFiles']
  > = [];
  const blockers: string[] = [];

  for (const file of files) {
    const displayName = file.displayName || path.basename(file.path);
    try {
      const info = await stat(file.path);
      if (!info.isFile()) {
        blockers.push(`${displayName} is not a regular file.`);
        continue;
      }

      summaries.push({
        name: displayName,
        path: file.path,
        sizeBytes: file.sizeBytes ?? info.size,
        mimeType: file.mimeType || inferMimeType(file.path),
        sha256: file.sha256 || (await sha256File(file.path)),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      blockers.push(`${displayName} could not be read: ${reason}`);
    }
  }

  return { summaries, blockers };
}
