import { describe, expect, it } from 'vitest';
import { isWithinRoute } from './use-hash-route';

describe('isWithinRoute', () => {
  it('matches the route itself and its sub-routes', () => {
    expect(isWithinRoute('/roadtrip', '/roadtrip')).toBe(true);
    expect(isWithinRoute('/roadtrip/home', '/roadtrip')).toBe(true);
  });

  it('does not match another tool', () => {
    // The bug this guards: a mounted tool sees the hash change to another
    // tool's route and redirects "back" to its own, so the switcher does
    // nothing at all.
    expect(isWithinRoute('/studio', '/roadtrip')).toBe(false);
    expect(isWithinRoute('/studio/home', '/roadtrip')).toBe(false);
  });

  it('does not match a route that merely starts with the same letters', () => {
    expect(isWithinRoute('/roadtrip-notes', '/roadtrip')).toBe(false);
    expect(isWithinRoute('/studios', '/studio')).toBe(false);
  });

  it('does not match the empty route or the home page', () => {
    expect(isWithinRoute('', '/roadtrip')).toBe(false);
    expect(isWithinRoute('/', '/roadtrip')).toBe(false);
  });
});
