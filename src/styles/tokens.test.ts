import { describe, expect, it } from 'vitest';
import indexHtml from '../../index.html?raw';
import viteConfig from '../../vite.config.ts?raw';
import { AA_TEXT_CONTRAST, AA_UI_CONTRAST, contrastRatio } from '@/lib/color';
import tokensCss from './tokens.css?raw';

type Theme = 'light' | 'dark';

/** Reads the hex `--color-*` tokens; dark values override the light defaults. */
function readColorTokens(css: string): Record<Theme, Record<string, string>> {
  const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
  expect(darkStart).toBeGreaterThan(0);
  const read = (block: string) =>
    Object.fromEntries(
      [...block.matchAll(/(--color-[\w-]+):\s*(#[\da-f]{3,6})\s*;/gi)].map(([, name, value]) => [
        name,
        value,
      ]),
    ) as Record<string, string>;
  const light = read(css.slice(0, darkStart));
  return { light, dark: { ...light, ...read(css.slice(darkStart)) } };
}

const tokens = readColorTokens(tokensCss);
const themes: Theme[] = ['light', 'dark'];
const backgrounds = ['--color-bg', '--color-surface', '--color-surface-2'];
const textColors = [
  '--color-text',
  '--color-text-muted',
  '--color-accent-text',
  '--color-made-text',
  '--color-miss-text',
  '--color-stat-text',
  '--color-danger-text',
];
const fills = ['accent', 'made', 'miss', 'stat', 'danger', 'inverse'];

function color(theme: Theme, name: string): string {
  const value = tokens[theme][name];
  if (!value) throw new Error(`Missing hex token ${name} (${theme})`);
  return value;
}

describe.each(themes)('%s theme tokens meet WCAG AA', (theme) => {
  it.each(textColors.flatMap((text) => backgrounds.map((bg) => [text, bg] as const)))(
    '%s on %s',
    (text, bg) => {
      expect(contrastRatio(color(theme, text), color(theme, bg))).toBeGreaterThanOrEqual(
        AA_TEXT_CONTRAST,
      );
    },
  );

  it.each(fills)('text on the %s fill', (fill) => {
    expect(
      contrastRatio(color(theme, `--color-on-${fill}`), color(theme, `--color-${fill}`)),
    ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
  });

  it.each(backgrounds)('focus ring on %s', (bg) => {
    expect(contrastRatio(color(theme, '--color-focus'), color(theme, bg))).toBeGreaterThanOrEqual(
      AA_UI_CONTRAST,
    );
  });

  it.each(backgrounds)('form field outline on %s', (bg) => {
    expect(
      contrastRatio(color(theme, '--color-border-strong'), color(theme, bg)),
    ).toBeGreaterThanOrEqual(AA_UI_CONTRAST);
  });

  it('text on the selected segment', () => {
    expect(
      contrastRatio(color(theme, '--color-text'), color(theme, '--color-thumb')),
    ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
  });

  it('toast action on the inverse fill', () => {
    expect(
      contrastRatio(color(theme, '--color-on-inverse-accent'), color(theme, '--color-inverse')),
    ).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
  });
});

describe('index.html', () => {
  it.each(themes)('uses the %s background as its theme-color', (theme) => {
    const meta = new RegExp(
      `<meta name="theme-color" content="(#[\\da-f]{6})" media="\\(prefers-color-scheme: ${theme}\\)"`,
      'i',
    ).exec(indexHtml);
    expect(meta?.[1]).toBe(color(theme, '--color-bg'));
  });
});

describe('web app manifest', () => {
  it('uses the dark background for its theme and splash colors', () => {
    const constant = /const DARK_BACKGROUND = '(#[\da-f]{6})';/i.exec(viteConfig);
    expect(constant?.[1]).toBe(color('dark', '--color-bg'));
  });
});
