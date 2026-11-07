# Images

Drop files here and they appear on the site automatically. Until a file exists,
the page shows a dashed "Add image" tile naming the exact path.

| What | Where | Size |
|---|---|---|
| Headshot | `public/images/headshot.jpg` | square, about 600 × 600 |
| Research figures | `public/images/research/<slug>/<file>` | about 1600 px wide, PNG/JPG/WebP |
| Project images | `public/images/projects/<slug>/<file>` | same |

The file names each page expects are in its `.mdx` frontmatter (`cover:` and
`images:`). Rename freely; just keep the frontmatter in sync. Every image needs
`alt` text; `caption` is optional.

Never put raw MRI, DICOM, or anything showing a face here.
