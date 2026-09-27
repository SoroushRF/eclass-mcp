import { createHash } from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  computeMobileLaunchSiteId,
  extractMobileLaunchAnchorHref,
  generateMobilePassport,
  MoodleMobileLauncher,
  parseMobileLaunchLocation,
} from '../src/scraper/eclass/api/mobile';
import { MoodleApiError } from '../src/scraper/eclass/api/errors';
import type { EclassApiSession } from '../src/scraper/eclass/api/session-context';
import type { MobileCredential } from '../src/scraper/session';

const ORIGIN = 'https://eclass.yorku.ca';
const PASSPORT = 'fake-passport-for-tests';
// Obviously fake values in Moodle's token shapes (32 hex / 64 alphanumerics).
const TOKEN = '0'.repeat(32);
const PRIVATE_TOKEN = 'a'.repeat(64);

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex');
}

/** Builds a redirect exactly as Moodle 5.1 `launch.php` does. */
function launchLocation(
  options: {
    scheme?: string;
    origin?: string;
    passport?: string;
    token?: string;
    privateToken?: string;
    siteId?: string;
  } = {}
): string {
  const siteId =
    options.siteId ??
    md5((options.origin ?? ORIGIN) + (options.passport ?? PASSPORT));
  let appToken = `${siteId}:::${options.token ?? TOKEN}`;
  if (options.privateToken) appToken += `:::${options.privateToken}`;
  return `${options.scheme ?? 'moodlemobile'}://token=${Buffer.from(
    appToken
  ).toString('base64')}`;
}

const binding = { origin: ORIGIN, passport: PASSPORT };

function sessionContext(request: { get: ReturnType<typeof vi.fn> }) {
  return {
    getSession: vi.fn(
      async () =>
        ({
          request,
        }) as unknown as EclassApiSession
    ),
  };
}

/** Echoes the passport from the request URL back into a valid redirect. */
function redirectingRequest(
  build: (passport: string) => {
    status: number;
    location?: string;
    html?: string;
  }
) {
  return {
    get: vi.fn(async (url: string) => {
      const passport = new URL(url).searchParams.get('passport') ?? '';
      const response = build(passport);
      return {
        status: vi.fn(() => response.status),
        headers: vi.fn(() =>
          response.location ? { location: response.location } : {}
        ),
        text: vi.fn(async () => response.html ?? ''),
      };
    }),
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

  it('computes the site id as md5(wwwroot . passport) without a trailing slash', () => {
    expect(computeMobileLaunchSiteId(ORIGIN, PASSPORT)).toBe(
      md5(ORIGIN + PASSPORT)
    );
    expect(computeMobileLaunchSiteId(`${ORIGIN}/`, PASSPORT)).toBe(
      md5(ORIGIN + PASSPORT)
    );
  });

  it('decodes two-part and three-part launch payloads', () => {
    expect(parseMobileLaunchLocation(launchLocation(), binding)).toEqual({
      token: TOKEN,
    });
    expect(
      parseMobileLaunchLocation(
        launchLocation({ privateToken: PRIVATE_TOKEN }),
        binding
      )
    ).toEqual({ token: TOKEN, privateToken: PRIVATE_TOKEN });
  });

  it('accepts the moodle scheme case-insensitively', () => {
    expect(
      parseMobileLaunchLocation(launchLocation({ scheme: 'moodle' }), binding)
    ).toEqual({ token: TOKEN });
    expect(
      parseMobileLaunchLocation(
        launchLocation({ scheme: 'MoodleMobile' }),
        binding
      )
    ).toEqual({ token: TOKEN });
  });

  it('accepts a trailing slash on the configured origin', () => {
    expect(
      parseMobileLaunchLocation(launchLocation(), {
        origin: `${ORIGIN}/`,
        passport: PASSPORT,
      })
    ).toEqual({ token: TOKEN });
  });

  it('accepts a percent-encoded payload', () => {
    const location = launchLocation({ privateToken: PRIVATE_TOKEN });
    const [prefix, payload] = location.split('token=');
    expect(
      parseMobileLaunchLocation(
        `${prefix}token=${encodeURIComponent(payload)}`,
        binding
      )
    ).toEqual({ token: TOKEN, privateToken: PRIVATE_TOKEN });
  });

  it('rejects a site id that does not match this passport', () => {
    expect(() =>
      parseMobileLaunchLocation(
        launchLocation({ passport: 'other-passport' }),
        binding
      )
    ).toThrow(MoodleApiError);
    expect(() =>
      parseMobileLaunchLocation(
        launchLocation({ origin: 'https://evil.example' }),
        binding
      )
    ).toThrow(MoodleApiError);
    expect(() =>
      parseMobileLaunchLocation(
        launchLocation({ siteId: 'not-an-md5' }),
        binding
      )
    ).toThrow(MoodleApiError);
  });

  it('rejects malformed payloads and unexpected formats', () => {
    const rejects = (location: string) =>
      expect(() => parseMobileLaunchLocation(location, binding)).toThrow(
        MoodleApiError
      );

    // Legacy query-string format the old parser expected.
    rejects(`moodlemobile://launch?token=${TOKEN}`);
    rejects(`moodlemobile://?token=${TOKEN}`);
    // Wrong scheme.
    rejects(launchLocation({ scheme: 'https' }));
    rejects(launchLocation({ scheme: 'javascript' }));
    // User info before the payload.
    rejects(
      launchLocation().replace('moodlemobile://', 'moodlemobile://user:pw@')
    );
    // Invalid base64 alphabet, padding, and trailing data.
    rejects('moodlemobile://token=not*base64');
    rejects('moodlemobile://token=abc');
    rejects(`${launchLocation()}?extra=1`);
    rejects('moodlemobile://token=');
    // Wrong number of parts.
    rejects(
      `moodlemobile://token=${Buffer.from(md5(ORIGIN + PASSPORT)).toString('base64')}`
    );
    rejects(
      `moodlemobile://token=${Buffer.from(
        `${md5(ORIGIN + PASSPORT)}:::${TOKEN}:::${PRIVATE_TOKEN}:::x`
      ).toString('base64')}`
    );
    // Token shape.
    rejects(launchLocation({ token: 'short' }));
    rejects(launchLocation({ token: `${TOKEN}-with-dash` }));
    rejects(launchLocation({ privateToken: 'bad token!' }));
    rejects('not a URL');
  });

  it('extracts the #launchapp anchor from the HTML fallback page', () => {
    const location = launchLocation();
    const html = `<div class="generalbox"><a href="${location.replace(
      /&/g,
      '&amp;'
    )}" id="launchapp">Click here</a></div>`;
    expect(extractMobileLaunchAnchorHref(html)).toBe(location);
    expect(
      extractMobileLaunchAnchorHref(
        `<a id='launchapp' href='${location}'>x</a>`
      )
    ).toBe(location);
    expect(
      extractMobileLaunchAnchorHref('<a href="https://x" id="other">x</a>')
    ).toBeNull();
    expect(extractMobileLaunchAnchorHref('<p>nothing</p>')).toBeNull();
  });

  it('does not follow redirects and stores the parsed tokens', async () => {
    const request = redirectingRequest((passport) => ({
      status: 302,
      location: launchLocation({ passport, privateToken: PRIVATE_TOKEN }),
    }));
    const saved: MobileCredential[] = [];
    const launcher = new MoodleMobileLauncher({
      sessionContext: sessionContext(request),
      origin: ORIGIN,
      credentialStore: {
        save: (credential) => saved.push(credential),
      },
    });

    const credential = await launcher.launch();

    expect(credential).toMatchObject({
      service: 'moodle_mobile_app',
      token: TOKEN,
      privateToken: PRIVATE_TOKEN,
    });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      token: TOKEN,
      privateToken: PRIVATE_TOKEN,
    });
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

  it('omits the private token when Moodle does not issue one', async () => {
    const request = redirectingRequest((passport) => ({
      status: 303,
      location: launchLocation({ passport }),
    }));
    const launcher = new MoodleMobileLauncher({
      sessionContext: sessionContext(request),
      origin: ORIGIN,
      credentialStore: { save: vi.fn() },
    });

    const credential = await launcher.launch();

    expect(credential.token).toBe(TOKEN);
    expect(credential).not.toHaveProperty('privateToken');
  });

  it('falls back to the HTML #launchapp anchor on a 200 response', async () => {
    const request = redirectingRequest((passport) => ({
      status: 200,
      html: `<a href="${launchLocation({ passport })}" id="launchapp">Launch</a>`,
    }));
    const launcher = new MoodleMobileLauncher({
      sessionContext: sessionContext(request),
      origin: ORIGIN,
      credentialStore: { save: vi.fn() },
    });

    await expect(launcher.launch()).resolves.toMatchObject({ token: TOKEN });
  });

  it('rejects a redirect minted for a different passport', async () => {
    const request = redirectingRequest(() => ({
      status: 302,
      location: launchLocation({ passport: 'replayed-passport' }),
    }));
    const save = vi.fn();
    const launcher = new MoodleMobileLauncher({
      sessionContext: sessionContext(request),
      origin: ORIGIN,
      credentialStore: { save },
    });

    await expect(launcher.launch()).rejects.toMatchObject({
      category: 'malformed_response',
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('classifies missing, unexpected, and unauthorized launch responses', async () => {
    const makeLauncher = (
      status: number,
      options: { location?: string; html?: string; requestError?: Error } = {}
    ) => {
      const request = {
        get: vi.fn(async () => {
          if (options.requestError) throw options.requestError;
          return {
            status: vi.fn(() => status),
            headers: vi.fn(() =>
              options.location ? { location: options.location } : {}
            ),
            text: vi.fn(async () => options.html ?? ''),
          };
        }),
      };
      return new MoodleMobileLauncher({
        sessionContext: sessionContext(request),
        origin: ORIGIN,
        credentialStore: { save: vi.fn() },
      });
    };

    await expect(makeLauncher(302).launch()).rejects.toMatchObject({
      category: 'malformed_response',
    });
    await expect(
      makeLauncher(200, { html: '<p>error page</p>' }).launch()
    ).rejects.toMatchObject({ category: 'malformed_response' });
    await expect(makeLauncher(500).launch()).rejects.toMatchObject({
      category: 'upstream',
    });
    await expect(makeLauncher(401).launch()).rejects.toMatchObject({
      category: 'session_invalid',
    });
    const timeout = new Error('timeout');
    timeout.name = 'TimeoutError';
    await expect(
      makeLauncher(0, { requestError: timeout }).launch()
    ).rejects.toMatchObject({ category: 'timeout' });
  });

  it('never includes token material in thrown errors', async () => {
    const request = redirectingRequest(() => ({
      status: 302,
      location: launchLocation({
        passport: 'replayed-passport',
        privateToken: PRIVATE_TOKEN,
      }),
    }));
    const launcher = new MoodleMobileLauncher({
      sessionContext: sessionContext(request),
      origin: ORIGIN,
      credentialStore: { save: vi.fn() },
    });

    const error = await launcher.launch().catch((caught: unknown) => caught);
    const serialized = JSON.stringify(error) + String(error);
    expect(serialized).not.toContain(TOKEN);
    expect(serialized).not.toContain(PRIVATE_TOKEN);
  });

  it('rejects unsafe launcher origins before making an authenticated request', () => {
    expect(
      () =>
        new MoodleMobileLauncher({
          sessionContext: sessionContext({ get: vi.fn() }),
          origin: 'not an origin',
          credentialStore: { save: vi.fn() },
        })
    ).toThrow(MoodleApiError);
    expect(
      () =>
        new MoodleMobileLauncher({
          sessionContext: sessionContext({ get: vi.fn() }),
          origin: 'http://eclass.yorku.ca',
          credentialStore: { save: vi.fn() },
        })
    ).toThrow(MoodleApiError);
    expect(
      () =>
        new MoodleMobileLauncher({
          sessionContext: sessionContext({ get: vi.fn() }),
          origin: 'https://user:password@eclass.yorku.ca',
          credentialStore: { save: vi.fn() },
        })
    ).toThrow(MoodleApiError);
  });
});
