import { toErrorPayload } from '../errors/tool-error';
import { ScrapeLayoutError } from '../scraper/scrape-errors';
import { EclassToolErrorResponseSchema } from './eclass-contracts';
import { asValidatedMcpText } from './mcp-validated-response';

export function isScrapeLayoutChanged(
  error: unknown
): error is ScrapeLayoutError {
  return error instanceof ScrapeLayoutError;
}

export function scrapeLayoutChangedResponse(
  toolName: string,
  error: ScrapeLayoutError
) {
  return asValidatedMcpText(
    toolName,
    EclassToolErrorResponseSchema,
    toErrorPayload('SCRAPE_LAYOUT_CHANGED', error.message, {
      details: error.context,
    })
  );
}
