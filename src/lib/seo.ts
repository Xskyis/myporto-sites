import { PROFILE } from '../data/profile';
import { SOCIALS } from '../data/socials';

export const PROFILE_DESCRIPTION = `${PROFILE.name} is a ${PROFILE.headline} based in ${PROFILE.location}. Explore featured projects, engineering skills, and verified milestones.`;

interface PageSchemaOptions {
  site: URL | string;
  pathname: string;
  title: string;
  description: string;
  project?: { name: string; description: string; keywords: string[] };
}

export function createPageSchema({ site, pathname, title, description, project }: PageSchemaOptions): {
  '@context': string;
  '@graph': Record<string, unknown>[];
} {
  const homeURL = new URL('/', site).href;
  const pageURL = new URL(pathname, site).href;
  const personId = `${homeURL}#person`;
  const projectId = `${pageURL}#project`;
  const person = {
    '@type': 'Person',
    '@id': personId,
    name: PROFILE.name,
    alternateName: PROFILE.nickname,
    jobTitle: PROFILE.role,
    email: PROFILE.email,
    description: PROFILE_DESCRIPTION,
    url: homeURL,
    sameAs: SOCIALS.filter((social) => /^https?:\/\//.test(social.url)).map((social) => social.url),
    knowsAbout: ['Frontend Development', 'Next.js', 'React', 'TypeScript', 'Tailwind CSS', 'Three.js'],
  };
  const page = {
    '@type': 'WebPage',
    '@id': `${pageURL}#webpage`,
    url: pageURL,
    name: title,
    description,
    inLanguage: 'en',
    author: { '@id': personId },
    mainEntity: { '@id': project ? projectId : personId },
  };
  const graph: Record<string, unknown>[] = [person, page];
  if (project) {
    graph.push({
        '@type': 'CreativeWork',
        '@id': projectId,
        name: project.name,
        description: project.description,
        keywords: project.keywords,
        url: pageURL,
        creator: { '@id': personId },
      });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** JSON-LD is raw script text: HTML must never be able to close the script element. */
export function serializeJsonLd(value: ReturnType<typeof createPageSchema>): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function createRobotsTxt(site: URL | string): string {
  const sitemapURL = new URL('/sitemap-index.xml', site);
  return `User-agent: *\nAllow: /\n\nSitemap: ${sitemapURL.href}\n`;
}
