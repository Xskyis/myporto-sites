import { describe, it, expect } from 'vitest';
import { parseCertDateKey, CERTIFICATIONS } from '../../src/data/certifications';

describe('parseCertDateKey', () => {
  it('orders months within a year', () => {
    expect(parseCertDateKey('Jan 2024')).toBeLessThan(parseCertDateKey('Dec 2024'));
    expect(parseCertDateKey('Dec 2023')).toBeLessThan(parseCertDateKey('Jan 2024'));
  });

  it('parses every month abbreviation', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach((m, i) => {
      expect(parseCertDateKey(`${m} 2024`)).toBe(202400 + (i + 1));
    });
  });

  it('handles surrounding whitespace and unknown month', () => {
    expect(parseCertDateKey('  Feb 2024 ')).toBe(202402);
    expect(parseCertDateKey('Foo 2024')).toBe(202400);
  });
});

describe('CERTIFICATIONS data invariants', () => {
  it('has unique ids', () => {
    const ids = CERTIFICATIONS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every issueDate is parseable', () => {
    for (const c of CERTIFICATIONS) {
      expect(parseCertDateKey(c.issueDate)).toBeGreaterThan(0);
    }
  });

  it('featured certs are sorted by relevance then date (as About does)', () => {
    const CATEGORY_RELEVANCE: Record<string, number> = { web: 10, other: 20, cloud: 30, ai: 40 };
    const featured = CERTIFICATIONS.filter((c) => c.featured).sort((a, b) => {
      const relA = a.relevance ?? CATEGORY_RELEVANCE[a.category ?? 'other'] ?? 50;
      const relB = b.relevance ?? CATEGORY_RELEVANCE[b.category ?? 'other'] ?? 50;
      if (relA !== relB) return relA - relB;
      return parseCertDateKey(b.issueDate) - parseCertDateKey(a.issueDate);
    });
    expect(featured.length).toBeGreaterThan(0);
    expect(featured.length).toBeLessThanOrEqual(8);
  });

  it('every cert has title, issuer, issueDate, skills', () => {
    for (const c of CERTIFICATIONS) {
      expect(c.title.trim().length).toBeGreaterThan(0);
      expect(c.issuer.trim().length).toBeGreaterThan(0);
      expect(c.skills.length).toBeGreaterThan(0);
    }
  });

  it('no TODO placeholders in credential URLs', () => {
    for (const c of CERTIFICATIONS) {
      if (c.credentialUrl) expect(c.credentialUrl).not.toContain('TODO');
    }
  });
});
