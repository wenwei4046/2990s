import { describe, expect, it } from 'vitest';
import { usesAndroidSofaLayout } from './android-sofa-layout';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; HONOR Pad) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const APPLE_AGENTS = [
  ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'],
  ['iPad', 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'],
  ['iPad desktop Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'],
  ['macOS Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'],
] as const;

describe('usesAndroidSofaLayout', () => {
  it('selects the Android layout from an Android user agent', () => {
    expect(usesAndroidSofaLayout(ANDROID, false, '')).toBe(true);
    expect(usesAndroidSofaLayout(ANDROID, true, '')).toBe(true);
  });

  it.each(APPLE_AGENTS)('preserves the %s layout', (_name, userAgent) => {
    expect(usesAndroidSofaLayout(userAgent, false, '')).toBe(false);
    expect(usesAndroidSofaLayout(userAgent, true, '')).toBe(false);
    expect(usesAndroidSofaLayout(userAgent, false, '?layoutDevice=android')).toBe(false);
    expect(usesAndroidSofaLayout(userAgent, false, '', 5)).toBe(false);
  });

  it('covers the touch Linux user agent used by Android desktop-site mode', () => {
    const linux = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    expect(usesAndroidSofaLayout(linux, false, '', 5)).toBe(true);
    expect(usesAndroidSofaLayout(linux, false, '', 0)).toBe(false);
  });

  it('does not apply the fallback to Windows touch devices', () => {
    const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    expect(usesAndroidSofaLayout(windows, false, '', 5)).toBe(false);
  });

  it('allows explicit layout selection only in simulation', () => {
    expect(usesAndroidSofaLayout(APPLE_AGENTS[2][1], true, '?layoutDevice=android')).toBe(true);
    expect(usesAndroidSofaLayout(ANDROID, true, '?layoutDevice=apple')).toBe(false);
    expect(usesAndroidSofaLayout(ANDROID, false, '?layoutDevice=apple')).toBe(true);
  });

  it('falls back to the user agent for unknown simulation selections', () => {
    expect(usesAndroidSofaLayout(ANDROID, true, '?layoutDevice=other')).toBe(true);
    expect(usesAndroidSofaLayout(APPLE_AGENTS[2][1], true, '?layoutDevice=other')).toBe(false);
  });
});
