import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    /** Optional shorter title used only in the home-page project list. */
    shortTitle: z.string().optional(),
    subtitle: z.string().optional(),
    /** One short descriptor for the project list (sentence case, ~6 words). */
    tagline: z.string().max(60).optional(),
    /** At most three key technologies shown in the project list; `tags` keeps the full stack. */
    stackShort: z.array(z.string()).min(1).max(3).optional(),
    description: z.string(),
    tags: z.array(z.string()),
    year: z.string(),
    role: z.string(),
    repoUrl: z.string().optional(),
    liveUrl: z.string().optional(),
    cover: z.string().optional(),
    featured: z.boolean().default(false),
    order: z.number().default(99),
  }),
});

export const collections = {
  projects,
};
