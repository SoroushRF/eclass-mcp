import { describe, expect, it, vi } from 'vitest';
import {
  generateMobilePassport,
  MoodleMobileLauncher,
  parseMobileLaunchLocation,
} from '../src/scraper/eclass/api/mobile';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import type { EclassApiSession } from '../src/scraper/eclass/api/session-context';

const ORIGIN = 'https://eclass.yorku.ca';
const TOKEN = 'mobile-token-0123456789';

function sessionContext(request: {
  get: ReturnType<typeof vi.fn>;
}) {
  return {
    getSession: vi.fn(
      async () =>
        ({
          request,
        }) as unknown as EclassApiSession
    ),
  };
}

describe('Moodle mobile launch handshake', () => {
  it('generates one-time URL-safe passports', () => {
    const first = generateMobilePassport();
    const second = generateMobilePassport();

    expect(first).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(first).not.toBe(second);
  });

  it('accepts only validated Moodle custom-scheme token locations', () => {
    expect(
      parseMobileLaunchLocation(`moodlemobile://launch?token=${TOKEN}`)
    ).toBe(TOKEN);
    expect(parseMobileLaunchLocation(`moodle://launch?token=${TOKEN}`)).toBe(
      TOKEN
    );
    expect(() =>
      parseMobileLaunchLocation(`https://eclass.yorku.ca/?token=${TOKEN}`)
    ).toThrow(MoodleApiError);
    expect(() =>
      parseMobileLaunchLocation('moodlemobile://launch?token=short')
    ).toThrow(MoodleApiError);
    expect(() =>
      parseMobileLaunchLocation('moodlemobile://launch')
    ).toThrow(MoodleApiError);
  });

  it('does not follow redirects and stores only the parsed token', async () => {
    const request = {
      get: vi.fn(async () => ({
        status: vi.fn(() => 302),
        headers: vi.fn(() => ({
          location: `moodlemobile://launch?token=${TOKEN}&other=discarded`,
        })),
      })),
    };
    const saved: string[] = [];
    const launcher = new MoodleMobileLauncher({
      sessionContext: sessionContext(request),
      origin: ORIGIN,
      credentialStore: {
        save: (credential) => saved.push(credential.token),
      },
    });

    const credential = await launcher.launch();

    expect(credential).toMatchObject({
      service: 'moodle_mobile_app',
      token: TOKEN,
    });
    expect(saved).toEqual([TOKEN]);
    const [url, options] = request.get.mock.calls[0] as unknown as [
      string,
      { maxRedirects: number; failOnStatusCode: boolean },
    ];
    expect(new URL(url).pathname).toBe('/admin/tool/mobile/launch.php');
    expect(new URL(url).searchParams.get('service')).toBe('moodle_mobile_app');
    expect(new URL(url).searchParams.get('passport')).toMatch(
      /^[A-Za-z0-9_-]{32,}$/
    );
    expect(options).toMatchObject({
      maxRedirects: 0,
      failOnStatusCode: false,
    });
  });

  it('classifies missing, unexpected, and unauthorized launch responses', async () => {
    const makeLauncher = (
      status: number,
      location?: string,
      requestError?: Error
    ) => {
      const request = {
        get: vi.fn(async () => {
          if (requestError) throw requestError;
          return {
            status: vi.fn(() => status),
            headers: vi.fn(() => (location ? { location } : {})),
          };
        }),
      };
      return new MoodleMobileLauncher({
        sessionContext: sessionContext(request),
        origin: ORIGIN,
        credentialStore: { save: vi.fn() },
      });
    };

    await expect(
      makeLauncher(302).launch()
    ).rejects.toMatchObject({ category: 'malformed_response' });
    await expect(
      makeLauncher(200).launch()
    ).rejects.toMatchObject({ category: 'upstream' });
    await expect(
      makeLauncher(401).launch()
    ).rejects.toMatchObject({ category: 'session_invalid' });
    const timeout = new Error('timeout');
    timeout.name = 'TimeoutError';
    await expect(
      makeLauncher(0, undefined, timeout).launch()
    ).rejects.toMatchObject({ category: 'timeout' });
  });
});
