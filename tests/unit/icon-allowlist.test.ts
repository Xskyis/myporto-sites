import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(p: string) {
  return readFileSync(join(root, p), 'utf-8');
}

describe('icon allowlist (astro.config.mjs)', () => {
  const config = read('astro.config.mjs');

  it('does not use wildcard includes', () => {
    expect(config).not.toMatch(/lucide:\s*\[\s*['"]\*['"]\s*\]/);
    expect(config).not.toMatch(/'simple-icons':\s*\[\s*['"]\*['"]\s*\]/);
  });

  it('explicitly lists lucide and simple-icons', () => {
    expect(config).toContain('lucide: [');
    expect(config).toContain("'simple-icons': [");
  });

  it('parses the allowlist from astro.config.mjs', () => {
    const lucideMatch = config.match(/lucide:\s*\[([^\]]+)\]/);
    const simpleMatch = config.match(/'simple-icons':\s*\[([^\]]+)\]/);
    expect(lucideMatch, 'lucide allowlist missing').not.toBeNull();
    expect(simpleMatch, 'simple-icons allowlist missing').not.toBeNull();

    const extract = (s: string) =>
      [...s.matchAll(/['"]([a-z0-9-]+)['"]/g)].map((m) => m[1]);
    const lucide = extract(lucideMatch![1]);
    const simple = extract(simpleMatch![1]);

    // Sorted, no duplicates, non-empty
    expect(lucide.length).toBeGreaterThan(10);
    expect(simple.length).toBeGreaterThan(10);
    expect(new Set(lucide).size).toBe(lucide.length);
    expect(new Set(simple).size).toBe(simple.length);
    expect([...lucide].sort()).toEqual(lucide.sort());
    expect([...simple].sort()).toEqual(simple.sort());
  });

  it('covers every <Icon name="…"> used in src components/pages', () => {
    // Static Icon usages: name="lucide:xxx" | name="simple-icons:xxx"
    const files = [
      'src/components/Hero.astro',
      'src/components/About.astro',
      'src/components/ProjectList.astro',
      'src/components/TechStack.astro',
      'src/components/Footer.astro',
      'src/components/Navbar.astro',
      'src/components/SplashScreen.astro',
      'src/components/PortraitParticles.astro',
      'src/components/BallPit.astro',
      'src/components/CustomCursor.astro',
      'src/pages/index.astro',
      'src/pages/projects/[slug].astro',
      'src/layouts/BaseLayout.astro',
    ];

    const used = new Set<string>();
    for (const f of files) {
      if (!existsSync(join(root, f))) continue;
      const content = read(f);
      for (const m of content.matchAll(/(?:lucide|simple-icons):[a-z0-9-]+/g)) {
        used.add(m[0]);
      }
    }

    // Data-driven icons (techstack.ts, socials.ts) are covered by data-invariants tests,
    // but also scan them here so the allowlist stays honest.
    for (const f of ['src/data/techstack.ts', 'src/data/socials.ts']) {
      const content = read(f);
      for (const m of content.matchAll(/(?:lucide|simple-icons):[a-z0-9-]+/g)) {
        used.add(m[0]);
      }
    }

    const config = read('astro.config.mjs');
    for (const icon of used) {
      const name = icon.split(':')[1];
      expect(config.includes(name), `Icon "${icon}" used in src but missing from astro.config.mjs allowlist`).toBe(true);
    }
  });

  it('has no unused allowlist entries (allowlist ⊆ used)', () => {
    const files = [
      'src/components/Hero.astro',
      'src/components/About.astro',
      'src/components/ProjectList.astro',
      'src/components/Footer.astro',
      'src/components/Navbar.astro',
      'src/pages/projects/[slug].astro',
    ];
    const used = new Set<string>();
    for (const f of files) {
      const content = read(f);
      for (const m of content.matchAll(/(?:lucide|simple-icons):[a-z0-9-]+/g)) {
        used.add(m[0].split(':')[1]);
      }
    }
    for (const f of ['src/data/techstack.ts', 'src/data/socials.ts']) {
      const content = read(f);
      for (const m of content.matchAll(/(?:lucide|simple-icons):[a-z0-9-]+/g)) {
        used.add(m[0].split(':')[1]);
      }
    }

    const lucideMatch = config.match(/lucide:\s*\[([^\]]+)\]/)!;
    const simpleMatch = config.match(/'simple-icons':\s*\[([^\]]+)\]/)!;
    const extract = (s: string) => [...s.matchAll(/['"]([a-z0-9-]+)['"]/g)].map((m) => m[1]);
    const allowed = [...extract(lucideMatch[1]), ...extract(simpleMatch[1])];

    for (const name of allowed) {
      expect(used.has(name), `Allowlist entry "${name}" is never used — remove it or use it`).toBe(true);
    }
  });
});
