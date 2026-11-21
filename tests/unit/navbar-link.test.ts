import { describe, expect, it } from 'vitest';
import { getSamePageHash } from '../../src/lib/scroll/navbar-link';

describe('navbar same-page fragment routing', () => {
  it('intercepts an unmodified fragment link on the current document', () => {
    expect(getSamePageHash('#projects', 'https://portfolio.example/?view=all')).toBe('#projects');
    expect(getSamePageHash('/projects/detail#contact', 'https://portfolio.example/projects/detail')).toBe('#contact');
  });

  it('leaves links to another path, query, origin, or without a fragment native', () => {
    const current = 'https://portfolio.example/projects/detail';
    expect(getSamePageHash('/#contact', current)).toBeNull();
    expect(getSamePageHash('?view=all#projects', current)).toBeNull();
    expect(getSamePageHash('https://other.example/projects/detail#contact', current)).toBeNull();
    expect(getSamePageHash('/projects/other', current)).toBeNull();
  });

  it('handles malformed URLs without intercepting browser navigation', () => {
    expect(getSamePageHash('http://[', 'https://portfolio.example')).toBeNull();
  });
});
