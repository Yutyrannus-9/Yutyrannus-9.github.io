# How to add a research project

1. **Create the file.** Copy `src/content/research/one-brain-twenty-pipelines.mdx` to `src/content/research/<short-slug>.mdx`. The slug becomes the URL: `/research/<short-slug>`.

2. **Fill in the frontmatter.** Every field is checked by the schema in `src/content.config.ts`:
   - `title`, `summary`, `question`, `role`, `dataType`, `tools`
   - `status`: one of `completed`, `ongoing`, `coursework`, `independent`, `conceptual`, or `future`
   - `source`: `resume`, `github`, or `confirmed` once the facts are real. Use `placeholder` only while drafting; the production build fails on it.
   - `tags`: only tags in the `TAGS` allow-list in `src/data/site.ts`. Add a new tag there first if it's true.
   - `order`: lower numbers appear first.
   - `links`: optional `code`, `poster`, `paper`, `slides`, `documentation`.
   - `brainAnchor`: only if the study actually measured specific Desikan–Killiany regions, for example `{ mode: 'atlas', regions: ['L:superiorfrontal'] }`.

3. **Write the body** in the case-study order: plain-language summary, methods, findings or status, what you learned, limitations, next steps. Write for a scientist first. Never publish health information. Use `<Todo>…</Todo>` for anything you still need to fill in.

4. **Check it:**

   ```bash
   npm run dev              # look at /research/<short-slug>
   npm run check:content    # lists placeholders and <Todo> blocks
   npm run build:draft && npm run check:links
   ```

5. **Add it to the timeline** in `src/content/timeline.json`, with `href: "/research/<short-slug>"`. Then commit and push; Vercel deploys `main` automatically.
