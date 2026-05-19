import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CengageScraper,
  closeActiveCengageScrapers,
} from '../src/scraper/cengage';

afterEach(async () => {
  vi.restoreAllMocks();
  await closeActiveCengageScrapers();
});

describe('Cengage scraper lifecycle registry', () => {
  it('closes active scraper instances once during shutdown cleanup', async () => {
    const scraper = new CengageScraper();
    const closeSpy = vi.spyOn(scraper, 'close');

    await closeActiveCengageScrapers();
    await closeActiveCengageScrapers();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('unregisters instances closed through their normal close path', async () => {
    const scraper = new CengageScraper();
    const closeSpy = vi.spyOn(scraper, 'close');

    await scraper.close();
    await closeActiveCengageScrapers();

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
