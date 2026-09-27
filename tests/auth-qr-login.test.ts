import http from 'http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOODLE_MOBILE_USER_AGENT,
  QR_LOGIN_FUNCTION,
  QrLoginError,
  exchangeQrLogin,
  isQrLoginEnabled,
  parseQrLoginPayload,
} from '../src/auth/qr-login';
import {
  getAuthUrl,
  startAuthServer,
  stopAuthServer,
} from '../src/auth/server';
import type { FetchLike } from '../src/scraper/eclass/api/transport';
import { rootLogger } from '../src/logging/logger';

const ORIGIN = 'https://eclass.yorku.ca';
// Obviously fake values.
const FAKE_KEY = 'FAKEqrKEY0123456789abcdefABCDEF0';
const FAKE_TOKEN = 'faketoken0123456789abcdef012345';
const FAKE_PRIVATE = 'fakeprivate0123456789abcdef0123';
const PAYLOAD = `moodlemobile://${ORIGIN}?qrlogin=${FAKE_KEY}&userid=42`;

function captureLogs() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(JSON.stringify(args));
  };
  vi.spyOn(rootLogger, 'info').mockImplementation(record as never);
  vi.spyOn(rootLogger, 'warn').mockImplementation(record as never);
  return lines;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('QR login payload parsing', () => {
  it('accepts the app-scheme payload and the bare site URL', () => {
    expect(parseQrLoginPayload(PAYLOAD, ORIGIN)).toEqual({
      origin: ORIGIN,
      qrLoginKey: FAKE_KEY,
      userId: 42,
    });
    expect(
      parseQrLoginPayload(`  ${ORIGIN}/?qrlogin=${FAKE_KEY}&userid=7 `, ORIGIN)
    ).toMatchObject({ userId: 7 });
  });

  it('rejects other sites, plain HTTP, and malformed keys or user ids', () => {
    const code = (raw: string) => {
      try {
        parseQrLoginPayload(raw, ORIGIN);
        return 'ok';
      } catch (error) {
        return (error as QrLoginError).code;
      }
    };
    expect(
      code(`moodlemobile://https://evil.example?qrlogin=${FAKE_KEY}&userid=1`)
    ).toBe('wrong_site');
    expect(
      code(`moodlemobile://http://eclass.yorku.ca?qrlogin=${FAKE_KEY}&userid=1`)
    ).toBe('wrong_site');
    expect(code(`${ORIGIN}?qrlogin=short&userid=1`)).toBe('invalid_payload');
    expect(code(`${ORIGIN}?qrlogin=${FAKE_KEY}&userid=-3`)).toBe(
      'invalid_payload'
    );
    expect(code(`${ORIGIN}?qrlogin=${FAKE_KEY}`)).toBe('invalid_payload');
    expect(code('not a url')).toBe('invalid_payload');
  });

  it('is off unless the flag is exactly 1', () => {
    expect(isQrLoginEnabled({})).toBe(false);
    expect(isQrLoginEnabled({ ECLASS_MCP_ENABLE_QR_LOGIN: 'true' })).toBe(
      false
    );
    expect(isQrLoginEnabled({ ECLASS_MCP_ENABLE_QR_LOGIN: '1' })).toBe(true);
  });
});

describe('QR login exchange', () => {
  const payload = { origin: ORIGIN, qrLoginKey: FAKE_KEY, userId: 42 };

  it('calls the no-login AJAX function with a MoodleMobile user agent', async () => {
    const logs = captureLogs();
    const fetchImpl = vi.fn<FetchLike>(async () =>
      json([
        {
          error: false,
          data: { token: FAKE_TOKEN, privatetoken: FAKE_PRIVATE, warnings: [] },
        },
      ])
    );

    const credential = await exchangeQrLogin(payload, {
      fetchImpl,
      now: () => new Date('2026-09-27T00:00:00.000Z'),
    });

    expect(credential).toEqual({
      service: 'moodle_mobile_app',
      token: FAKE_TOKEN,
      privateToken: FAKE_PRIVATE,
      issuedAt: '2026-09-27T00:00:00.000Z',
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      `${ORIGIN}/lib/ajax/service-nologin.php?info=${QR_LOGIN_FUNCTION}`
    );
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(
      MOODLE_MOBILE_USER_AGENT
    );
    expect(JSON.parse(String(init.body))).toEqual([
      {
        index: 0,
        methodname: QR_LOGIN_FUNCTION,
        args: { qrloginkey: FAKE_KEY, userid: 42 },
      },
    ]);
    const text = logs.join('\n');
    expect(text).toContain('"outcome":"ok"');
    for (const secret of [FAKE_KEY, FAKE_TOKEN, FAKE_PRIVATE]) {
      expect(text).not.toContain(secret);
    }
  });

  it('omits an empty private token', async () => {
    captureLogs();
    const credential = await exchangeQrLogin(payload, {
      fetchImpl: async () =>
        json([{ error: false, data: { token: FAKE_TOKEN, privatetoken: '' } }]),
    });
    expect(credential).not.toHaveProperty('privateToken');
  });

  it.each([
    ['qrcodedisabled', 'qr_login_disabled'],
    ['apprequired', 'app_required'],
    ['invalidkey', 'expired_or_used'],
    ['autologinnotallowedtoadmins', 'admin_not_allowed'],
    ['servicenotavailable', 'service_unavailable'],
    ['somethingelse', 'upstream'],
  ])('maps Moodle %s to %s', async (errorcode, expected) => {
    captureLogs();
    await expect(
      exchangeQrLogin(payload, {
        fetchImpl: async () =>
          json([{ error: true, exception: { errorcode, message: 'm' } }]),
      })
    ).rejects.toMatchObject({ code: expected });
  });

  it('maps whole-request errors, HTTP failures, bad JSON, and bad tokens', async () => {
    captureLogs();
    const expectCode = async (fetchImpl: FetchLike, code: string) =>
      expect(exchangeQrLogin(payload, { fetchImpl })).rejects.toMatchObject({
        code,
      });

    await expectCode(
      async () => json({ error: 'x', errorcode: 'invalidkey' }),
      'expired_or_used'
    );
    await expectCode(async () => json({}, 503), 'upstream');
    await expectCode(
      async () => new Response('<html>', { status: 200 }),
      'upstream'
    );
    await expectCode(async () => {
      throw new TypeError('network');
    }, 'upstream');
    await expectCode(
      async () => json([{ error: false, data: { token: 'short' } }]),
      'upstream'
    );
  });
});

describe.sequential('QR login routes', () => {
  const originalFlag = process.env.ECLASS_MCP_ENABLE_QR_LOGIN;
  const originalSecret = process.env.ECLASS_MCP_SESSION_SECRET;

  function request(
    url: string,
    init: {
      method?: string;
      body?: string;
      headers?: Record<string, string>;
    } = {}
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        url,
        {
          method: init.method ?? 'GET',
          agent: false,
          headers: {
            ...(init.body
              ? {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'Content-Length': String(Buffer.byteLength(init.body)),
                }
              : {}),
            ...init.headers,
          },
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        }
      );
      req.on('error', reject);
      req.end(init.body);
    });
  }

  beforeEach(async () => {
    await stopAuthServer();
    process.env.ECLASS_MCP_SESSION_SECRET = 'x'.repeat(32);
  });

  afterEach(async () => {
    await stopAuthServer();
    for (const [key, value] of [
      ['ECLASS_MCP_ENABLE_QR_LOGIN', originalFlag],
      ['ECLASS_MCP_SESSION_SECRET', originalSecret],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns 404 when the flag is off', async () => {
    delete process.env.ECLASS_MCP_ENABLE_QR_LOGIN;
    await startAuthServer();
    const url = getAuthUrl().replace('/auth', '/auth-qr');

    expect((await request(url)).status).toBe(404);
    expect((await request(url, { method: 'POST', body: 'x=1' })).status).toBe(
      404
    );
  });

  it('serves the form and enforces same-origin CSRF when enabled', async () => {
    process.env.ECLASS_MCP_ENABLE_QR_LOGIN = '1';
    await startAuthServer();
    const url = getAuthUrl().replace('/auth', '/auth-qr');
    const origin = new URL(url).origin;

    const page = await request(url);
    expect(page.status).toBe(200);
    const csrf = page.body.match(/name="_csrf" value="([^"]+)"/)?.[1];
    expect(csrf).toMatch(/^[a-f0-9]{64}$/);

    const forged = await request(url, {
      method: 'POST',
      body: `_csrf=wrong&payload=${encodeURIComponent(PAYLOAD)}`,
      headers: { Origin: origin },
    });
    expect(forged.status).toBe(403);

    const crossSite = await request(url, {
      method: 'POST',
      body: `_csrf=${csrf}&payload=x`,
      headers: { Origin: 'http://localhost:9999' },
    });
    expect(crossSite.status).toBe(403);

    const invalid = await request(url, {
      method: 'POST',
      body: `_csrf=${csrf}&payload=${encodeURIComponent('not a qr code')}`,
      headers: { Origin: origin },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toContain('not an eClass QR login code');
  });
});
