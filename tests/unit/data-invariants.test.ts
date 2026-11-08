import { describe, it, expect } from 'vitest';
import { PROFILE } from '../../src/data/profile';
import { SOCIALS } from '../../src/data/socials';
import { TIMELINE } from '../../src/data/timeline';
import { HONORS } from '../../src/data/honors';
import { TECH_STACK, TECH_CATEGORIES } from '../../src/data/techstack';
import { PROJECT_COVER_METAS, getProjectCoverMeta } from '../../src/data/project-assets';
import { SITE_URL } from '../../src/site';

describe('PROFILE', () => {
  it('has required identity fields', () => {
    expect(PROFILE.name.length).toBeGreaterThan(0);
    expect(PROFILE.email).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    expect(PROFILE.bio.length).toBeGreaterThan(0);
    expect(PROFILE.stats.length).toBeGreaterThan(0);
    expect(PROFILE.languages.length).toBeGreaterThan(0);
  });

  it('stats have numeric values', () => {
    for (const s of PROFILE.stats) {
      expect(typeof s.value).toBe('number');
      expect(s.value).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('SOCIALS', () => {
  it('has at least GitHub + LinkedIn + Email', () => {
    const names = SOCIALS.map((s) => s.name);
    expect(names).toContain('GitHub');
    expect(names).toContain('LinkedIn');
    expect(names).toContain('Email');
  });

  it('all urls are absolute or mailto', () => {
    for (const s of SOCIALS) {
      expect(s.url.match(/^https?:\/\/|^mailto:/)).not.toBeNull();
      expect(s.icon).toMatch(/^(lucide|simple-icons):/);
    }
  });
});

describe('TIMELINE & HONORS', () => {
  it('timeline ids are unique', () => {
    const ids = TIMELINE.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('honors ids are unique', () => {
    const ids = HONORS.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('timeline items have skills', () => {
    for (const t of TIMELINE) expect(t.skills.length).toBeGreaterThan(0);
  });
});

describe('TECH_STACK', () => {
  it('every item belongs to a declared category', () => {
    for (const item of TECH_STACK) {
      expect(TECH_CATEGORIES).toContain(item.category);
    }
  });

  it('every item has an icon in a supported collection', () => {
    for (const item of TECH_STACK) {
      expect(item.icon).toMatch(/^(lucide|simple-icons):[a-z0-9-]+$/);
    }
  });

  it('names are unique within the stack', () => {
    const names = TECH_STACK.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('PROJECT_COVER_METAS', () => {
  it('every meta has positive dimensions and consistent aspect', () => {
    for (const [key, m] of Object.entries(PROJECT_COVER_METAS)) {
      expect(m.width).toBeGreaterThan(0);
      expect(m.height).toBeGreaterThan(0);
      expect(m.aspectRatio).toBeCloseTo(m.width / m.height, 6);
      expect(key).toMatch(/^\/projects\/.*\.webp$/);
      expect(m.previewWebp).toContain('/previews/');
      expect(m.avif).toMatch(/\.avif$/);
    }
  });

  it('getProjectCoverMeta returns null for unknown path', () => {
    expect(getProjectCoverMeta('/nonexistent.webp')).toBeNull();
    expect(getProjectCoverMeta(undefined)).toBeNull();
    expect(getProjectCoverMeta()).toBeNull();
  });
});

describe('SITE_URL', () => {
  it('is a valid https URL without trailing slash', () => {
    expect(() => new URL(SITE_URL)).not.toThrow();
    expect(SITE_URL.startsWith('https://')).toBe(true);
    expect(SITE_URL.endsWith('/')).toBe(false);
  });
});
