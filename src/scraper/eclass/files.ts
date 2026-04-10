import type { EClassBrowserSession } from './browser-session';
import path from 'path';

export async function downloadFile(
  session: EClassBrowserSession,
  fileUrl: string
): Promise<{ buffer: Buffer; mimeType: string; filename: string }> {
  const context = await session.getAuthenticatedContext();
  try {
    let response = await context.request.get(fileUrl);
    let headers = response.headers();
    let mimeType = headers['content-type'] || 'application/octet-stream';
    let buffer = await response.body();

    if (mimeType.includes('text/html')) {
      const html = buffer.toString('utf-8');
      let directUrl: string | null = null;

      const objectMatch = html.match(/<object[^>]*data="([^"]+)"/i);
      if (objectMatch?.[1]) directUrl = objectMatch[1];

      if (!directUrl) {
        const downloadMatch = html.match(
          /<div class="resourceworkaround"><a href="([^"]+)"/i
        );
        if (downloadMatch?.[1]) directUrl = downloadMatch[1];
      }

      if (!directUrl) {
        const iframeMatch = html.match(/<iframe[^>]*src="([^"]+)"/i);
        if (iframeMatch?.[1]) directUrl = iframeMatch[1];
      }

      if (!directUrl) {
        const page = await context.newPage();
        try {
          let interceptedBuffer: Buffer | null = null;
          let interceptedMime = '';
          let interceptedFilename = '';

          page.on('response', async (res) => {
            if (interceptedBuffer) return;

            const ct = res.headers()['content-type'] || '';
            const url = res.url();

            const isFile =
              ct.includes('application/pdf') ||
              ct.includes('wordprocessingml') ||
              ct.includes('presentationml') ||
              ct.includes('application/octet-stream') ||
              url.includes('pluginfile.php');

            const isNoise =
              ct.includes('text/html') ||
              ct.includes('text/javascript') ||
              ct.includes('text/css') ||
              ct.includes('image/') ||
              ct.includes('font/');

            if (isFile && !isNoise) {
              try {
                const body = await res.body();
                if (body.length > 500) {
                  interceptedBuffer = body;
                  interceptedMime = ct || 'application/octet-stream';
                  const cd = res.headers()['content-disposition'] || '';
                  const fnMatch = cd.match(/filename="?([^";\n]+)"?/);
                  interceptedFilename = fnMatch
                    ? decodeURIComponent(fnMatch[1].trim())
                    : path.basename(new URL(url).pathname);
                }
              } catch {
                // response body may be unavailable, skip
              }
            }
          });

          await page.goto(fileUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          });

          const isWafChallenge = await page
            .evaluate(
              () =>
                typeof (window as any).awsWafCookieDomainList !== 'undefined'
            )
            .catch(() => false);

          if (isWafChallenge) {
            console.error(
              '[downloadFile] WAF challenge detected — waiting for auto-reload...'
            );
            try {
              await page.waitForNavigation({
                waitUntil: 'networkidle',
                timeout: 20000,
              });
            } catch {
              console.error(
                '[downloadFile] WAF challenge reload timed out — bot detection may have blocked us.'
              );
            }
          } else {
            await page.waitForLoadState('networkidle').catch(() => {});
          }

          if (interceptedBuffer) {
            await page.close();
            let resolvedMime = interceptedMime;
            const ext = path.extname(interceptedFilename).toLowerCase();
            if (resolvedMime === 'application/octet-stream') {
              if (ext === '.pdf') resolvedMime = 'application/pdf';
              else if (ext === '.docx')
                resolvedMime =
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
              else if (ext === '.pptx')
                resolvedMime =
                  'application/vnd.openxmlformats-officedocument.presentationml.presentation';
              else if (ext === '.png') resolvedMime = 'image/png';
              else if (ext === '.jpg' || ext === '.jpeg')
                resolvedMime = 'image/jpeg';
              else if (ext === '.gif') resolvedMime = 'image/gif';
              else if (ext === '.webp') resolvedMime = 'image/webp';
            }
            return {
              buffer: interceptedBuffer,
              mimeType: resolvedMime,
              filename: interceptedFilename,
            };
          }

          directUrl = await page.evaluate(() => {
            const obj =
              document.querySelector<HTMLObjectElement>('object[data]');
            if (obj?.data) return obj.data;
            const iframe =
              document.querySelector<HTMLIFrameElement>('iframe[src]');
            if (iframe?.src) return iframe.src;
            const workaround = document.querySelector<HTMLAnchorElement>(
              '.resourceworkaround a, a[href*="forcedownload=1"]'
            );
            if (workaround?.href) return workaround.href;
            const pluginLink = document.querySelector<HTMLAnchorElement>(
              'a[href*="pluginfile.php"]'
            );
            if (pluginLink?.href) return pluginLink.href;
            return null;
          });
        } finally {
          await page.close();
        }
      }

      if (directUrl) {
        const resolvedUrl = new URL(directUrl, fileUrl).toString();
        response = await context.request.get(resolvedUrl);
        headers = response.headers();
        mimeType = headers['content-type'] || 'application/octet-stream';
        buffer = await response.body();
      } else {
        throw new Error(
          'Hit an HTML wrapper page but could not extract a direct file URL even after JS rendering.'
        );
      }
    }

    const contentDisposition = headers['content-disposition'] || '';
    const filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
    let filename = filenameMatch
      ? decodeURIComponent(filenameMatch[1].trim())
      : '';

    if (!filename) {
      try {
        filename = path.basename(new URL(response.url()).pathname);
      } catch {
        filename = path.basename(fileUrl);
      }
    }

    if (!filename || !filename.includes('.')) {
      if (mimeType.includes('pdf')) filename += '.pdf';
      else if (mimeType.includes('wordprocessingml')) filename += '.docx';
      else if (mimeType.includes('presentationml')) filename += '.pptx';
      else filename += '.bin';
    }

    return { buffer, mimeType, filename };
  } finally {
    await context.close();
  }
}
