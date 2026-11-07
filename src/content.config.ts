import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { TAGS } from './data/site';

const status = z.enum(['completed', 'ongoing', 'coursework', 'independent', 'conceptual', 'future']);
const source = z.enum(['resume', 'github', 'confirmed', 'placeholder']);
const tags = z.array(z.enum(TAGS)).default([]);

// Only set where the link to anatomy is factual (brief §4.3): a slice the
// project is anchored to in /projects, or DK regions a study actually measured.
const brainAnchor = z
  .union([
    z.object({ mode: z.literal('section'), slice: z.number() }),
    z.object({ mode: z.literal('atlas'), regions: z.array(z.string()) }),
  ])
  .optional();

const links = z
  .object({
    code: z.string().url(),
    poster: z.string(),
    paper: z.string().url(),
    slides: z.string(),
    documentation: z.string(),
  })
  .partial()
  .optional();

// Images live in public/images/<collection>/<slug>/ (see public/images/README.md).
const images = z
  .array(z.object({ src: z.string(), alt: z.string(), caption: z.string().optional() }))
  .default([]);

const base = {
  title: z.string(),
  summary: z.string(),
  status,
  source,
  tags,
  brainAnchor,
  links,
  order: z.number().default(100),
  /** Free-form period, for example "2026" or "Spring 2026". */
  period: z.string().optional(),
  /** Card thumbnail and page header image. */
  cover: z.object({ src: z.string(), alt: z.string() }).optional(),
  /** Figures shown in a gallery on the detail page. */
  images,
};

const research = defineCollection({
  loader: glob({ pattern: '**/[!_]*.mdx', base: './src/content/research' }),
  schema: z.object({
    ...base,
    question: z.string(),
    role: z.string(),
    dataType: z.string(),
    tools: z.array(z.string()).default([]),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/[!_]*.mdx', base: './src/content/projects' }),
  schema: z.object({
    ...base,
    why: z.string(),
    stack: z.array(z.string()).default([]),
    visibility: z.enum(['public', 'private']).default('public'),
  }),
});

const notes = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/notes' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    date: z.coerce.date(),
    source,
    tags,
    kind: z.enum(['learning', 'paper', 'concept', 'experiment', 'reflection', 'how-to']),
  }),
});

const timeline = defineCollection({
  loader: file('src/content/timeline.json'),
  schema: z.object({
    date: z.string(),
    kind: z.enum(['education', 'research', 'project', 'coursework', 'presentation', 'milestone', 'goal']),
    title: z.string(),
    detail: z.string().optional(),
    status,
    source,
    href: z.string().optional(),
  }),
});

const interests = defineCollection({
  loader: file('src/content/interests.json'),
  schema: z.object({
    label: z.string(),
    why: z.string(),
    source,
  }),
});

const links_ = defineCollection({
  loader: file('src/content/links.json'),
  schema: z.object({
    label: z.string(),
    href: z.string(),
    kind: z.enum(['github', 'linkedin', 'email', 'resume', 'other']),
    source,
  }),
});

export const collections = { research, projects, notes, timeline, interests, links: links_ };
