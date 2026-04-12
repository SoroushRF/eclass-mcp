/**
 * Thrown when Moodle/eClass HTML no longer matches selectors the scraper expects
 * (E12: machine code SCRAPE_LAYOUT_CHANGED).
 */
export class ScrapeLayoutError extends Error {
  readonly code = 'SCRAPE_LAYOUT_CHANGED' as const;

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ScrapeLayoutError';
  }
}
