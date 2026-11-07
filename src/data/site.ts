// Site-wide facts. Every field records where it came from (brief §10):
//   resume | github | confirmed | placeholder
// `npm run build` fails while any field or content entry is still "placeholder"
// (scripts/check-placeholders.mjs). `npm run dev` and `npm run build:draft` show
// placeholders with a dashed outline so they are easy to spot.

export type Source = 'resume' | 'github' | 'confirmed' | 'placeholder';
export interface Fact<T = string> {
  value: T;
  source: Source;
}

export const profile = {
  name: { value: 'Joel Jaramillo', source: 'resume' },
  role: { value: 'Biomedical engineering undergraduate', source: 'resume' },
  program: { value: 'B.E. Biomedical Engineering · The City College of New York · expected May 2028', source: 'resume' },
  headline: { value: 'Biomedical Engineering · Computational Neuroscience · Neural Imaging', source: 'resume' },
  // First sentence of the résumé summary. Swap for one of positioningOptions if you prefer.
  positioning: {
    value: 'Biomedical engineering undergraduate moving toward computational neuroscience and neural imaging.',
    source: 'resume',
  },
  // Drop a square photo at public/images/headshot.jpg (about 600 × 600). Until it
  // exists, an icon stands in.
  headshot: { value: '/images/headshot.jpg', source: 'confirmed' },
  // GitHub, LinkedIn, email, and résumé live in src/content/links.json.
  // Month and year only (D7). The month is not confirmed yet.
  scanDate: { value: '2026', source: 'confirmed' },
} satisfies Record<string, Fact>;

// Positioning options for §5, each defensible from the résumé or the MRI case study.
export const positioningOptions = [
  'Biomedical engineering undergraduate moving toward computational neuroscience and neural imaging.',
  "I analyze neuroimaging data with open-source tools, and I care about showing what the data can and can't say.",
  'Undergraduate researcher building MRI pipelines and machine-learning analyses of brain data.',
  'I ran my own MRI through twenty open-source pipelines to see how much they agree.',
  'From head models to hippocampi: I work on the engineering side of neuroscience.',
];

// Formspree form ID for /contact (D6). Until it exists the page shows a mailto
// link with a copy button instead of the form.
export const contactForm: Fact<string | null> = { value: null, source: 'placeholder' };

// Tag allow-list (brief §10). Only tags listed here pass schema validation.
// Proposed from verified work; trim or extend before launch.
export const TAGS = [
  'neuroimaging',
  'structural-mri',
  'freesurfer',
  'segmentation',
  'reproducibility',
  'foundation-models',
  'visualization',
  'webgl',
  'python',
  'statistics',
  'eeg',
  'spike-sorting',
  'tooling',
  'machine-learning',
  'bci',
  'neuromodulation',
  'head-modeling',
  'fea',
] as const;

// Background photograph (D8). Must be a real, openly licensed image, credited in
// the footer and on /methods. `null` renders the plain night-sky ground.
export interface BackgroundImage {
  /** Path under /public, without extension; .avif and .webp are expected. */
  src: string;
  subject: string;
  creator: string;
  creatorUrl: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  /** Required by CC licenses when the image was cropped, recolored, or otherwise changed. */
  changes: string | null;
  /** 0.12–0.25 per brief §8. */
  opacity: number;
}
// Chosen by Joel (2026-09-30). CC BY-SA 4.0: the adapted files in public/sky*
// are shared under the same license, and the credit says so.
export const background: BackgroundImage | null = {
  src: '/sky',
  subject: 'rat cortical neurons expressing GFP',
  creator: 'ManuelSchottdorf',
  creatorUrl: 'https://commons.wikimedia.org/wiki/User:ManuelSchottdorf',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  sourceUrl: 'https://commons.wikimedia.org/wiki/File:GFP_Neurons.png',
  changes: 'cropped, converted to grayscale, and recolored; this adaptation is also CC BY-SA 4.0',
  opacity: 0.16,
};

// MRI slices (D2). The brief allows brain-only slices, downsampled to at least
// 1.5 mm, only after a radiologist or the study team has read the scan.
// `enabled` shows them in dev and draft builds; the production build fails
// until `professionalRead` is true.
export const mri = {
  enabled: true,
  professionalRead: false,
};

export const site = {
  title: 'Personal Brain Atlas',
  methodsTag: 'My cortex · FreeSurfer 7.4.1 · T1 MRI · non-diagnostic',
  brainLabel:
    "This is my brain's cortical surface, reconstructed from a research MRI with FreeSurfer 7.4.1. It's an anatomical visualization, not a medical image or a diagnosis.",
};

export const isPlaceholder = (f: { source: Source }) => f.source === 'placeholder';

/**
 * Public build (PUBLIC_SITE=1, used by the GitHub Pages deploy): hides
 * placeholder entries, <Todo> notes, and image slots whose files don't exist yet,
 * and keeps MRI slices off until mri.professionalRead is true.
 */
export const PUBLIC = import.meta.env.PUBLIC_SITE === '1';
export const shown = (d: { source: Source }) => !PUBLIC || d.source !== 'placeholder';
export const mriOn = mri.enabled && (!PUBLIC || mri.professionalRead);
