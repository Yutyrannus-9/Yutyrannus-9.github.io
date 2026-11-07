# Personal Brain Atlas

A neuroimaging portfolio you navigate like a viewer. The centerpiece is my own cortex, reconstructed with FreeSurfer 7.4.1 from a research T1 MRI and rendered live in the browser. Each page is a real operation on the same surface:

| Route | Brain state | What happens |
|---|---|---|
| `/` | Surface | Pial surface, curvature shading, slow idle rotation |
| `/research` | Deep | Glass cortex, subcortical meshes, and an MRI slice that follows scroll; Axial / Coronal / Sagittal buttons under the brain |
| `/projects` | Section | Axial clipping plane follows page scroll; the cut face shows the cortical ribbon (pial minus white) and the inside of the white surface |
| `/about` | Atlas | Desikan–Killiany colors; click a region or use the text list |
| `/explore` | Viewer | Glass/solid/hidden cortex, 21 deep-structure meshes you can select, and an MRI slice plane (axial/coronal/sagittal) you move with the scroll wheel, a two-finger swipe, or the slider |
| `/timeline`, `/notes`, `/methods`, `/contact`, case studies | Docked | Reading layout, optional light mode; the brain shrinks to a minimap, or the MRI sits beside the text |

### Backdrop switch

The top bar has **Backdrop: 3D · MRI · Still**, and the choice is remembered in the visitor's browser.

- **3D:** the live cortex. This is the default on Home, Projects, About, and Explore.
- **MRI:** slices of the brain-only T1, resampled to 1.5 mm and drawn in a navy color map at reduced opacity. This is the default on Research and Methods, where the slice follows the scroll position. Each page picks a plane: sagittal on Home, coronal with labels on About, axial elsewhere. Visitors can change the plane, the slice, and the labels in the HUD.
- **Still:** only the poster image; nothing heavy loads.

Behind everything is a faint (16%) recolored fluorescence micrograph of cultured neurons (CC BY-SA 4.0, credited in the footer and on `/methods`). It loads after the page does, so it never delays first paint.

It's an anatomical visualization, not a medical image or a diagnosis. No health information is published (see `/methods`).

## Quick start

```bash
npm install
npm run dev          # http://localhost:4321
```

| Script | What it does |
|---|---|
| `npm run dev` | Astro dev server |
| `npm run brain` | Rebuild the GLBs (`build-brain.mjs`) and all still images (`render-images.mjs`) from `assets-src/brain` |
| `npm run data:local` | Rebuild the 1.5 mm MRI volume, the deep-structure meshes, and the background. Needs the git-ignored source volumes in `assets-src/brain/web_volumes/`; the outputs in `public/` are committed |
| `npm run build` | Production build. **Fails while any placeholder remains** or `SITE_URL` is unset |
| `npm run build:draft` | Preview build that keeps placeholders visible (dashed outlines) |
| `npm run check` | TypeScript check |
| `npm run check:content` | List every remaining placeholder |
| `npm run check:links` | Internal link check over `dist/` |
| `npm run fonts` | Re-copy IBM Plex from `@fontsource` into `public/fonts` |

Add `?perf` to any URL to render continuously and show a live fps / p95 frame-time meter in the HUD.

## Architecture

- **Astro 5 + React islands + TypeScript + Tailwind v4**, static output on Vercel. Content pages ship almost no JavaScript.
- **The brain is one persisted island.** `src/layouts/Base.astro` wraps the stage in `transition:persist`, and `<ClientRouter />` swaps pages around it. The route sets `html[data-brain]`; the island reads it after each swap and animates to the new state. Real URLs and the back button keep working.
- **Viewer** (`src/components/viewer/`):
  - `Viewer.tsx`: island root. Detects the tier and lazy-loads `Scene.tsx` (three.js) only when needed.
  - `Scene.tsx`: R3F canvas (`frameloop="demand"`, DPR ≤ 1.5), morphs, section stencil capping, picking, camera, and orientation/scale updates.
  - `material.ts`: `MeshStandardMaterial` patched via `onBeforeCompile`: sulc/curv shading, atlas palette, thickness ramp, selection, fresnel rim.
  - `Hud.tsx`: all HUD elements are real DOM: readout, view controls, scale bar, orientation letters, legends, slice scrubber, region card.
  - `store.ts`: zustand store shared with `AtlasPanel.tsx` on `/about`.
- **Tiers** (`tier.ts`):
  - **A.** Desktop with WebGL2: everything.
  - **B.** Phones, ≤ 4 GB memory, or Save-Data: 3D is opt-in ("Load 3D view"), with no idle rotation and pre-rendered slices instead of the live cut.
  - **C.** No WebGL2 or "Skip 3D": poster image plus the 2D SVG atlas.
- **Content** lives in `src/content/` (MDX and JSON) with Zod schemas in `src/content.config.ts`. Every entry has `status` and `source`; tags come from an allow-list in `src/data/site.ts`.

### Brain asset pipeline (build time)

`assets-src/brain/web_ico6/` holds the only brain data in this repo: FreeSurfer surfaces resampled to icosahedron order 6 (40,962 vertices per hemisphere) and per-vertex JSON.

1. `scripts/build-brain.mjs` writes `public/brain/{lh,rh}.glb`:
   - pial base mesh, with `inflated` and `white` morph targets (display offsets baked in)
   - one packed `_DATA` attribute (uint8 × 4): DK index, sulc, thickness, curv
   - 14-bit quantization plus meshopt compression
   - also writes `src/data/brain/meta.json`: regions, center, sizes, content hash for cache-busting
2. `scripts/render-images.mjs` runs a small software rasterizer (no GPU) that renders:
   - the poster (LCP image and no-WebGL fallback)
   - the 2D atlas SVG (region contours via `d3-contour`)
   - axial cross-sections of the pial and white surfaces for Tier B
   - the Open Graph image and favicons
3. Region descriptions come from `src/data/brain/region-notes.json`, which uses conservative "involved in" wording.

Camera views for both the live viewer and the poster are in `src/data/brain/views.json`.

### MRI and deep structures (build time, local)

- `scripts/build-volume.mjs` takes the brain-only T1 (face removed) and FreeSurfer labels at 1 mm and writes 1.5 mm versions: `public/brain/mri/{t1,labels}.u8.gz`, about 0.75 MB together. The 1 mm source never enters the repo.
- `scripts/build-deep.mjs` turns FreeSurfer's subcortical labels into meshes (surface nets, Taubin smoothing, meshopt): `public/brain/deep.glb`, 209 KB, 21 structures.
- `scripts/build-background.mjs` crops and recolors the GFP neuron image into `public/sky*.{avif,webp}`.
- **Publishing gate (D2).** `mri.enabled` in `src/data/site.ts` shows the slices in dev and draft builds. `npm run build` fails until `mri.professionalRead` is `true`, meaning a radiologist or your study team has read the scan. To launch without slices, set `enabled: false`: the MRI option disappears and the Explore plane is hidden.

### Privacy

- Only the resampled surface files are in the repo. Raw MRI, DICOM, NIfTI, MGZ, annot, and GIfTI files are git-ignored, and they must never be copied here.
- MRI slices are brain-only, face removed, and resampled to 1.5 mm. They're published only once `mri.professionalRead` is set (D2). The Projects section cut is still filled from the surfaces themselves.
- No normative scores, percentiles, brain age, or findings about my brain (D3). The scan date is shown as a year only (D7).

## Performance and accessibility report

Measured on 2026-09-30 with Lighthouse 13 against the production build (`astro preview`). Mobile runs use simulated slow 4G and 4× CPU throttling.

| Page | Form factor | Perf | A11y | Best practices | SEO | LCP | CLS | TBT | Transfer |
|---|---|---|---|---|---|---|---|---|---|
| `/` | mobile | 97 | 100 | 100 | 100 | 2.3 s | 0.002 | 0 ms | 190 KB |
| `/research` | mobile | 97 | 100 | 100 | 100 | 2.4 s | 0 | 0 ms | 189 KB |
| `/projects` | mobile | 97 | 100 | 100 | 100 | 2.3 s | 0 | 0 ms | 253 KB |
| `/about` | mobile | 99 | 100 | 100 | 100 | 1.8 s | 0 | 0 ms | 244 KB |
| `/timeline` | mobile | 97 | 100 | 100 | 100 | 2.3 s | 0.001 | 0 ms | 159 KB |
| `/notes` | mobile | 99 | 100 | 100 | 100 | 2.1 s | 0.024 | 0 ms | 158 KB |
| `/methods` | mobile | 96 | 100 | 100 | 100 | 2.4 s | 0.001 | 0 ms | 184 KB |
| `/contact` | mobile | 99 | 100 | 100 | 100 | 1.7 s | 0.024 | 0 ms | 159 KB |
| case study | mobile | 99 | 100 | 100 | 100 | 1.8 s | 0.001 | 0 ms | 185 KB |
| `/` | desktop | 100 | 100 | 100 | 100 | 0.5 s | 0.007 | 20 ms | 1.87 MB |
| `/projects` | desktop | 100 | 100 | 100 | 100 | 0.5 s | 0 | 20 ms | 1.87 MB |
| `/methods` | desktop | 100 | 100 | 100 | 100 | 0.5 s | 0.008 | 0 ms | 214 KB |

Against the budgets in the brief (§11):

- **Met:**
  - Performance ≥ 90 on content pages and ≥ 80 on `/`.
  - Accessibility 100, Best Practices 100, SEO 100 on every page tested.
  - CLS < 0.05, and TBT < 200 ms.
  - 3D code and assets load only after the page is idle.
  - 3D assets are 1.44 MB for both GLBs (budget 1.5 MB).
- **Not met: mobile LCP ≤ 2.0 s.** Simulated mobile LCP is 1.7–2.4 s. In the unthrottled trace, the page paints at about 40 ms. A bare HTML page scores 0.8 s in the same setup. The remaining gap is Lighthouse's network model counting the web fonts and router script, which arrive before first paint on localhost. Re-check with PageSpeed Insights once the site is deployed.
- **Not measured: frame rate.** It couldn't be measured in the headless or hidden preview used during development. Open `/?perf` on an integrated-GPU laptop and on a phone (after "Load 3D view") and record the numbers here.

Bundle sizes:

| File | Size | Gzipped | When it loads |
|---|---|---|---|
| Poster | 34 KB AVIF, 46 KB WebP | n/a | First paint |
| React runtime | 207 KB | 65 KB | On idle |
| Viewer island | 22 KB | 6 KB | On idle |
| three.js + R3F scene chunk | 1.03 MB | 277 KB | Tier A, or Tier B after opt-in |
| GLBs (both hemispheres) | 1.44 MB | 1.06 MB | With the scene chunk |

The GLBs have a largest position error of 0.017 mm in a sampled round-trip check.

Accessibility notes:

- The HUD is DOM, and every control is a button or link.
- The canvas is `aria-hidden`, with a text alternative in `#brain-alt`.
- Atlas regions are also a keyboard-operable list.
- `prefers-reduced-motion` turns off idle rotation and makes transitions instant.
- Legends pair every color with a text label.

## Deployment (Vercel)

1. Push this repo to GitHub as `Yutyrannus-9/portfolio`.
2. In Vercel, choose **Add New → Project** and import the repo. `vercel.json` already sets `npm run build` and the `dist` output.
3. Under **Settings → Environment Variables**, add `SITE_URL`: your domain, or the `*.vercel.app` URL at first.
4. The production build fails until every placeholder is resolved (`npm run check:content` lists them). That's intentional. To share a preview earlier, set the build command to `npm run build:draft` temporarily, and keep it off your public domain.
5. **Custom domain:** under **Settings → Domains**, add the domain, create the DNS records Vercel shows (an A record for the apex, a CNAME for `www`), then update `SITE_URL`.

## Deviations from the brief, with reasons

- **Sphere morph target dropped.** No route uses it, and dropping it keeps both GLBs under 1.5 MB.
- **Per-vertex data packed.** It's one `_DATA` uint8 × 4 attribute instead of `_REGION`/`_SULC`/`_THICK`, because meshopt needs a byte stride that's a multiple of 4.
- **Section cap shows the cortical ribbon.** The cut face uses the white surface as a second stencil instead of a flat bone color. It's still real data, with no MRI slices.
- **Tier B 3D is opt-in instead of an automatic ico5 mesh.** Auto-loading 1.7 MB and compiling shaders on phones broke the mobile TBT budget (3.2 s measured).
- **No mouse-wheel zoom.** The wheel scrolls the page, so zoom is in HUD buttons. This avoids scroll-jacking.
- **No `motion` or drei.** CSS transitions and three.js's own OrbitControls cover what's needed.
- **Fonts are self-hosted and non-blocking.** Text paints in the system font first.
- **Astro 5, as specified.** Astro 7 is out; upgrading is a separate task.

## Credits

- IBM Plex fonts: SIL Open Font License 1.1.
- Lucide icons: ISC.
- three.js, React Three Fiber, glTF-Transform, meshoptimizer, d3-contour: MIT or similar permissive licenses.
- Surfaces reconstructed with FreeSurfer 7.4.1.
