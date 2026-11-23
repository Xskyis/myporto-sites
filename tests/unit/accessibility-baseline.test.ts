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

function composite(foreground: string, background: string, opacity: number): string {
  const channels = (hex: string) => hex.slice(1).match(/../g)!.map((part) => parseInt(part, 16));
  const back = channels(background);
  return `#${channels(foreground).map((value, index) =>
    Math.round(value * opacity + back[index] * (1 - opacity)).toString(16).padStart(2, '0')
  ).join('')}`;
}

// Token contrast alone misses fading a whole readable row. Inspect normal/hover states
// as well as the active state so a later full-opacity rule cannot hide a failing state.
function lowestRowOpacity(source: string, selectors: string[]): number {
  const rules = source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g);
  const opacities = [1];
  for (const [, selectorList, declarations] of rules) {
    if (!selectorList.split(',').some((selector) => selectors.includes(selector.trim()))) continue;
    const opacity = declarations.match(/(?:^|;)\s*opacity:\s*([\d.]+)/)?.[1];
    if (opacity !== undefined) opacities.push(Number(opacity));
  }
  return Math.min(...opacities);
}

const readableRows = [
  ['honors', css, ['.honor-row', '.honor-row:hover', '.honor-row:focus-within', '.honor-row[data-active="true"]']],
  ['certificates', css, ['.cert-curated-row', '.certs-curated-list:hover .cert-curated-row']],
  ['projects', readSource('src/components/ProjectList.astro'), ['.project-row', ".project-list[data-engaged='true'] .project-row:not([data-active='true'])"]],
] as const;

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

  it.each(palettes)('%s keeps readable row text above 4.5:1 after opacity is applied', (_, tokens) => {
    for (const [name, source, selectors] of readableRows) {
      const opacity = lowestRowOpacity(source, [...selectors]);
      for (const foreground of ['--text-primary', '--text-muted']) {
        for (const surface of ['--bg-primary', '--bg-surface', '--bg-surface-soft']) {
          const background = resolveColor(tokens, surface);
          const color = composite(resolveColor(tokens, foreground), background, opacity);
          expect(contrast(color, background), `${name}: ${foreground} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe('layout and navbar invariants', () => {
  it('keeps main focusable without drawing a full-page inset ring border', () => {
    const layout = readSource('src/layouts/BaseLayout.astro');
    const mainTag = layout.match(/<main\b[\s\S]*?>/)?.[0] ?? '';
    expect(mainTag).toContain('id="main-content"');
    expect(mainTag).toContain('tabindex="-1"');
    expect(mainTag).toContain('focus:outline-none');
    expect(mainTag).not.toContain('focus-visible:ring-');
    expect(mainTag).not.toContain('ring-inset');
  });

  it('places unprefixed backdrop-filter after -webkit-backdrop-filter so CSS minifiers keep standard blur', () => {
    for (const file of ['src/components/Navbar.astro', 'src/components/BallPit.astro']) {
      const source = readSource(file);
      const webkitIndex = source.indexOf('-webkit-backdrop-filter:');
      const standardIndex = source.search(/(^|[^-])backdrop-filter:/m);
      expect(webkitIndex, `${file} should declare -webkit-backdrop-filter`).toBeGreaterThan(-1);
      expect(standardIndex, `${file} should declare standard backdrop-filter`).toBeGreaterThan(webkitIndex);
    }
  });

  it('marks all primary home sections with data-nav-section', () => {
    for (const section of [
      'src/components/Hero.astro',
      'src/components/About.astro',
      'src/components/ProjectList.astro',
      'src/components/TechStack.astro',
      'src/components/Footer.astro',
    ]) {
      expect(readSource(section), `${section} should have data-nav-section`).toContain('data-nav-section');
    }
  });
});
