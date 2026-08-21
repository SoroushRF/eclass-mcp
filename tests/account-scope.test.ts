import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearActiveEclassAccountScope,
  deriveEclassAccountScope,
  getActiveEclassAccountScope,
  getEclassCacheKey,
  requireActiveEclassAccountScope,
  setActiveEclassAccountScope,
} from '../src/cache/account-scope';

const originalSecret = process.env.ECLASS_MCP_SESSION_SECRET;

beforeEach(() => {
  process.env.ECLASS_MCP_SESSION_SECRET = 'scope-test-secret-'.padEnd(32, 'x');
  clearActiveEclassAccountScope();
});

afterEach(() => {
  clearActiveEclassAccountScope();
  if (originalSecret === undefined) {
    delete process.env.ECLASS_MCP_SESSION_SECRET;
  } else {
    process.env.ECLASS_MCP_SESSION_SECRET = originalSecret;
  }
});

describe('eClass account cache scope', () => {
  it('derives a stable keyed scope without exposing the user id', () => {
    const first = deriveEclassAccountScope(
      'https://eclass.yorku.ca/my/',
      123456
    );
    const same = deriveEclassAccountScope('https://eclass.yorku.ca', '123456');
    const otherAccount = deriveEclassAccountScope(
      'https://eclass.yorku.ca',
      '654321'
    );

    expect(first).toBe(same);
    expect(first).not.toBe(otherAccount);
    expect(first).toMatch(/^acct_[a-f0-9]{32}$/);
    expect(first).not.toContain('123456');
    expect(first).not.toContain('654321');
  });

  it('fails closed when the session secret or identity is unavailable', () => {
    delete process.env.ECLASS_MCP_SESSION_SECRET;
    expect(() =>
      deriveEclassAccountScope('https://eclass.yorku.ca', '123456')
    ).toThrow(/scope is unavailable/);
    expect(() => requireActiveEclassAccountScope()).toThrow(
      /scope is unavailable/
    );
    expect(() =>
      deriveEclassAccountScope('https://eclass.yorku.ca', 'not-numeric')
    ).toThrow(/scope is unavailable/);
  });

  it('adds the active scope to authenticated cache keys', () => {
    const scope = setActiveEclassAccountScope(
      'https://eclass.yorku.ca',
      '123456'
    );
    const key = getEclassCacheKey('courses');

    expect(getActiveEclassAccountScope()).toBe(scope);
    expect(key).toContain(`eclass:${scope}:courses`);
    expect(key).not.toContain('123456');
  });

  it('clears only the matching active account scope', () => {
    const scope = setActiveEclassAccountScope(
      'https://eclass.yorku.ca',
      '123456'
    );
    clearActiveEclassAccountScope('different-scope');
    expect(getActiveEclassAccountScope()).toBe(scope);
    clearActiveEclassAccountScope(scope);
    expect(getActiveEclassAccountScope()).toBeNull();
  });
});
