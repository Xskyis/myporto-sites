import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const readSource = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const css = readSource('src/styles/global.css');

function tokensFor(selector: RegExp): Record<string, string> {
  const declarations = css.match(selector)?.[1];
  if (!declarations) throw new Error(`Palette block missing: ${selector}`);
  return Object.fromEntries(
    [...declarations.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [
      match[1],
      match[2].trim(),
    ])
  );
}

function resolveColor(tokens: Record<string, string>, name: string, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`Circular token: ${name}`);
  seen.add(name);
  const value = tokens[name];
  if (!value) throw new Error(`Color token missing: ${name}`);
  const alias = value.match(/^var\((--[\w-]+)\)$/)?.[1];
  if (alias) return resolveColor(tokens, alias, seen);
  if (!/^#[\da-f]{6}$/i.test(value)) throw new Error(`Unsupported color: ${value}`);
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = hex.slice(1).match(/../g)!.map((part) => {
    const channel = parseInt(part, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

const palettes = [
  ['mono light', tokensFor(/:root\s*\{([^}]+)\}/)],
  ['mono dark', tokensFor(/:root\.dark:not\(\[data-palette="color"\]\)\s*\{([^}]+)\}/)],
  ['poster color', tokensFor(/html\[data-palette="color"\]\.dark\s*\{([^}]+)\}/)],
] as const;

describe('accessible text palette tokens', () => {
  it.each(palettes)('%s keeps normal and accent text readable on its surfaces', (_, tokens) => {
    for (const foreground of ['--text-primary', '--text-muted', '--accent-text']) {
      for (const background of ['--bg-primary', '--bg-surface', '--bg-surface-soft']) {
        expect(
          contrast(resolveColor(tokens, foreground), resolveColor(tokens, background)),
          `${foreground} on ${background}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(palettes)('%s keeps small CTA labels readable on the accent fill', (_, tokens) => {
    expect(
      contrast(resolveColor(tokens, '--accent-contrast'), resolveColor(tokens, '--accent-primary'))
    ).toBeGreaterThanOrEqual(4.5);
  });
});
