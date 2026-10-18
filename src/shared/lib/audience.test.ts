import { describe, expect, it } from 'vitest';
import { AUDIENCE_SRC, audienceSettings, countedPath, declines } from './audience';

describe('audienceSettings', () => {
  it('measures production builds only, unless asked', () => {
    expect(audienceSettings({ VITE_UMAMI_WEBSITE_ID: 'id' }, false)).toBeNull();
    expect(audienceSettings({ VITE_UMAMI_WEBSITE_ID: 'id', VITE_UMAMI_DEV: 'true' }, false)).not.toBeNull();
  });

  it('is switched off by a missing or empty website id', () => {
    expect(audienceSettings({}, true)).toBeNull();
    expect(audienceSettings({ VITE_UMAMI_WEBSITE_ID: '' }, true)).toBeNull();
    expect(audienceSettings({ VITE_UMAMI_WEBSITE_ID: '  ' }, true)).toBeNull();
  });

  it("reports to the maintainer's instance from the site's two hosts by default", () => {
    expect(audienceSettings({ VITE_UMAMI_WEBSITE_ID: ' id ' }, true)).toEqual({
      src: AUDIENCE_SRC,
      website: 'id',
      domains: 'atelier.steeve.website,costardrouge.github.io',
    });
  });

  it('follows the environment, and ignores an unusable tracker address', () => {
    expect(
      audienceSettings(
        {
          VITE_UMAMI_WEBSITE_ID: 'id',
          VITE_UMAMI_SRC: 'https://insight.example.com/insight',
          VITE_UMAMI_DOMAINS: 'A.com, b.com,',
        },
        true,
      ),
    ).toEqual({ src: 'https://insight.example.com/insight', website: 'id', domains: 'a.com,b.com' });
    expect(audienceSettings({ VITE_UMAMI_WEBSITE_ID: 'id', VITE_UMAMI_SRC: 'javascript:1' }, true)?.src).toBe(
      AUDIENCE_SRC,
    );
    expect(audienceSettings({ VITE_UMAMI_WEBSITE_ID: 'id', VITE_UMAMI_SRC: 'nope' }, true)?.src).toBe(AUDIENCE_SRC);
  });
});

describe('declines', () => {
  it('honours Do Not Track in both spellings, Global Privacy Control and the opt-out key', () => {
    expect(declines({ optedOut: false })).toBe(false);
    expect(declines({ doNotTrack: '0', optedOut: false })).toBe(false);
    expect(declines({ doNotTrack: 'unspecified', optedOut: false })).toBe(false);
    expect(declines({ doNotTrack: '1', optedOut: false })).toBe(true);
    expect(declines({ doNotTrack: 'yes', optedOut: false })).toBe(true);
    expect(declines({ globalPrivacyControl: true, optedOut: false })).toBe(true);
    expect(declines({ optedOut: true })).toBe(true);
  });
});

describe('countedPath', () => {
  it('counts the home page and a tool, nothing else', () => {
    expect(countedPath({ home: true })).toBe('/');
    expect(countedPath({ tool: 'studio', home: false })).toBe('/studio');
    // A tool's inner route is never sent: the tool's id is the whole address.
    expect(countedPath({ tool: 'roadtrip', home: false })).toBe('/roadtrip');
    // The shell's reading pages (sources, agents).
    expect(countedPath({ home: false })).toBeNull();
  });
});
