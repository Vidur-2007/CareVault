// UI spec section 3: text contrast at least 4.5:1. Checks every text/background token pair the UI uses.
import { describe, expect, it } from 'vitest';

const T = {
  ground: '#F2F6F6',
  surface: '#FFFFFF',
  surfaceMuted: '#F7FAFA',
  ink: '#12302F',
  ink2: '#33504F',
  ink3: '#5B7372',
  teal: '#0B6E6E',
  tealDark: '#0F3B3A',
  tealTint: '#DDF1EE',
  tealInk: '#0B5553',
  blueTint: '#E4EFFB',
  blueInk: '#174A7C',
  amberTint: '#FFF3DC',
  amberInk: '#7A4A00',
  redTint: '#FDE8E1',
  redInk: '#8A2C0D',
  greyTint: '#EBEFF0',
  greyInk: '#33504F',
  white: '#FFFFFF',
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS: [string, keyof typeof T, keyof typeof T][] = [
  ['body text on the page', 'ink2', 'ground'],
  ['headings on the page', 'ink', 'ground'],
  ['secondary text on the page', 'ink3', 'ground'],
  ['secondary text on cards', 'ink3', 'surface'],
  ['secondary text in inner panels', 'ink3', 'surfaceMuted'],
  ['links and quiet buttons', 'teal', 'surface'],
  ['links on the page', 'teal', 'ground'],
  ['primary button text', 'white', 'teal'],
  ['dark panel text', 'white', 'tealDark'],
  ['confirmed pill, active nav', 'tealInk', 'tealTint'],
  ['added pill', 'blueInk', 'blueTint'],
  ['changed / needs confirmation pill', 'amberInk', 'amberTint'],
  ['review / duplicate pill', 'redInk', 'redTint'],
  ['stopped / unchanged pill', 'greyInk', 'greyTint'],
  ['"Check this" outline pill on cards', 'amberInk', 'surface'],
  ['error text on cards', 'redInk', 'surface'],
  ['secondary button text', 'tealInk', 'surface'],
];

describe('colour contrast (WCAG AA, 4.5:1)', () => {
  for (const [use, fg, bg] of PAIRS) {
    it(`${use}: ${fg} on ${bg}`, () => {
      expect(contrast(T[fg], T[bg])).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('secondary grey text is never placed on grey tint (it would be 4.4:1)', () => {
    expect(contrast(T.ink3, T.greyTint)).toBeLessThan(4.5);
  });
});
