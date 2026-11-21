import { describe, expect, it } from 'vitest';
import { PROFILE } from '../../src/data/profile';
import { SOCIALS } from '../../src/data/socials';
import { createPageSchema, createRobotsTxt, PROFILE_DESCRIPTION, serializeJsonLd } from '../../src/lib/seo';

describe('page structured data', () => {
  it('keeps the person identity stable and describes project pages as project work', () => {
    const schema = createPageSchema({
      site: 'https://example.com',
      pathname: '/projects/sample',
      title: 'Sample Project',
      description: 'A useful sample project.',
      project: { name: 'Sample Project', description: 'A useful sample project.', keywords: ['Astro', 'TypeScript'] },
    });
    const [person, page, project] = schema['@graph'];

    expect(person.url).toBe('https://example.com/');
    expect(person.email).toBe(PROFILE.email);
    expect(person.description).toBe(PROFILE_DESCRIPTION);
    expect(person.sameAs).toEqual(SOCIALS.filter((social) => social.url.startsWith('https://')).map((social) => social.url));
    expect((page.mainEntity as { '@id': string })['@id']).toBe(project['@id']);
    expect(project.url).toBe('https://example.com/projects/sample');
    expect(project.creator).toEqual({ '@id': person['@id'] });
    expect(person.name).toBe(PROFILE.name);
  });

  it('links the home page to the person and safely serializes script-closing text', () => {
    const schema = createPageSchema({
      site: 'https://example.com',
      pathname: '/',
      title: '</script><script>alert(1)</script>',
      description: 'Portfolio',
    });
    const serialized = serializeJsonLd(schema);

    expect((schema['@graph'][1].mainEntity as { '@id': string })['@id']).toBe(schema['@graph'][0]['@id']);
    expect(serialized).not.toContain('</script>');
    expect(JSON.parse(serialized)['@graph'][1].name).toContain('</script>');
  });

  it('uses the active deployment origin for the sitemap in robots.txt', () => {
    expect(createRobotsTxt('https://preview.example.dev')).toContain(
      'Sitemap: https://preview.example.dev/sitemap-index.xml'
    );
  });
});
