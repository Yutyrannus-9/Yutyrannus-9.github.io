// Production gate (brief §1.3 and §10): fail the build while anything is still
// a placeholder. Run by `npm run build`; `npm run build:draft` skips it.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

for (const file of walk(path.join(ROOT, 'src/content'))) {
  if (path.basename(file).startsWith('_')) continue; // templates
  const rel = path.relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  if (file.endsWith('.json')) {
    for (const item of JSON.parse(text)) {
      if (item.source === 'placeholder') problems.push(`${rel}: "${item.id}" is a placeholder`);
    }
  } else {
    const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
    if (/^source:\s*placeholder\s*$/m.test(fm)) problems.push(`${rel}: source is placeholder`);
    for (const m of text.matchAll(/src:\s*'(\/images\/[^']+)'/g)) {
      if (!existsSync(path.join(ROOT, 'public', m[1]))) problems.push(`${rel}: image not added yet: public${m[1]}`);
    }
    const todos = text.match(/<Todo>/g)?.length ?? 0;
    if (todos) problems.push(`${rel}: ${todos} <Todo> block(s) left`);
  }
}

for (const file of walk(path.join(ROOT, 'src/pages'))) {
  const todos = readFileSync(file, 'utf8').match(/<Todo>/g)?.length ?? 0;
  if (todos) problems.push(`${path.relative(ROOT, file)}: ${todos} <Todo> block(s) left`);
}

const site = readFileSync(path.join(ROOT, 'src/data/site.ts'), 'utf8');
if (!existsSync(path.join(ROOT, 'public/images/headshot.jpg'))) problems.push('public/images/headshot.jpg not added yet (an icon shows instead)');
for (const m of site.matchAll(/(\w+):\s*\{\s*value:[^}]*source:\s*'placeholder'/g)) {
  problems.push(`src/data/site.ts: profile.${m[1]} is a placeholder`);
}
if (/contactForm[^=]*=\s*\{\s*value:\s*null,\s*source:\s*'placeholder'/.test(site)) {
  problems.push('src/data/site.ts: contactForm (Formspree ID) not set; set it or mark it confirmed to use mailto only');
}
// D2: MRI slices may be published only after a professional read of the scan.
if (/export const mri = \{\s*enabled:\s*true,\s*professionalRead:\s*false/.test(site)) {
  problems.push('src/data/site.ts: mri.enabled is true but professionalRead is false. Publish MRI slices only after a radiologist or your study team has read the scan (brief D2), or set enabled: false');
}
const mriReady = /export const mri = \{\s*enabled:\s*true,\s*professionalRead:\s*true/.test(site);
if (!mriReady && existsSync(path.join(ROOT, 'public/brain/mri'))) {
  problems.push('public/brain/mri exists but MRI slices are not cleared for publishing: delete the folder or set mri.enabled and mri.professionalRead to true');
}
if (!process.env.SITE_URL) problems.push('SITE_URL is not set (needed for canonical URLs, sitemap, and Open Graph)');

if (problems.length) {
  console.error(`\n${problems.length} placeholder(s) must be resolved before a production build:\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error('\nUse `npm run build:draft` for a preview build that keeps placeholders visible.\n');
  if (!process.env.ALLOW_PLACEHOLDERS) process.exit(1);
} else {
  console.log('No placeholders. OK for production.');
}
