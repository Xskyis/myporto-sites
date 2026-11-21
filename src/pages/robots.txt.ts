import type { APIRoute } from 'astro';
import { createRobotsTxt } from '../lib/seo';
import { SITE_URL } from '../site';

export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const content = createRobotsTxt(site ?? SITE_URL);
  return new Response(content, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
