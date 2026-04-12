import type { Browser, Page } from 'playwright';
import { CengageAuthRequiredError } from './cengage-errors';
import {
  CENGAGE_SESSION_STALE_HOURS,
  getCengageSessionValidity,
} from './cengage-session';
import type { CengageEntryLinkType } from './cengage-url';

export function getValidSessionStatePathOrThrow(
  entryUrl: string,
  linkType: CengageEntryLinkType
): string {
  const sessionValidity = getCengageSessionValidity();
  if (!sessionValidity.valid) {
    const message =
      sessionValidity.reason === 'stale'
        ? `Cengage session is stale (older than ${CENGAGE_SESSION_STALE_HOURS} hours). Please authenticate again.`
        : 'Cengage session state is missing or invalid. Please authenticate first.';

    throw new CengageAuthRequiredError(message, {
      entryUrl,
      linkType,
      sessionReason: sessionValidity.reason,
      sessionSavedAt: sessionValidity.savedAt,
    });
  }

  return sessionValidity.statePath;
}

export async function withAuthenticatedPage<T>(params: {
  entryUrl: string;
  linkType: CengageEntryLinkType;
  getBrowser: () => Promise<Browser>;
  callback: (page: Page) => Promise<T>;
}): Promise<T> {
  const { entryUrl, linkType, getBrowser, callback } = params;
  const storageState = getValidSessionStatePathOrThrow(entryUrl, linkType);
  const browser = await getBrowser();
  const context = await browser.newContext({
    storageState,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  try {
    return await callback(page);
  } finally {
    await context.close();
  }
}
