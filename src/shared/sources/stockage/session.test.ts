import { describe, expect, it } from 'vitest';
import { isSesameReturn, readSession, safeReturn } from './session';

describe('the Sésame session', () => {
  it('reads a stored session back, and refuses what is not one', () => {
    expect(readSession({ sub: 's', accessToken: 't', expiresAt: 1 })).toMatchObject({ sub: 's', refreshToken: null, name: null });
    expect(readSession({ sub: '', accessToken: 't', expiresAt: 1 })).toBeNull();
    expect(readSession({ sub: 's', accessToken: 't' })).toBeNull();
    expect(readSession('nope')).toBeNull();
  });

  it('lands only on a hash route of ours after a sign-in', () => {
    expect(safeReturn('#/recap/home')).toBe('#/recap/home');
    expect(safeReturn('https://evil.example')).toBe('#/sources');
    expect(safeReturn('#//evil.example')).toBe('#/sources');
    expect(safeReturn(null)).toBe('#/sources');
  });

  it('treats a load as Sésame’s return only when this tab started a sign-in', () => {
    expect(isSesameReturn('?code=c&state=s', '{"verifier":"v"}')).toBe(true);
    expect(isSesameReturn('?error=access_denied&state=s', '{}')).toBe(true);
    expect(isSesameReturn('?code=c&state=s', null)).toBe(false);
    expect(isSesameReturn('', '{}')).toBe(false);
  });
});
