# What I still need to provide

`npm run check:content` prints the live list. The production build fails until it's empty.

## Done from the résumé (review the wording)

Name, program, headline, and positioning; LinkedIn and email; the ZVR Lab and Bikson Lab entries; NeuroForge and Lectern Pro; the timeline; research interests; skills; honors; and the About bio. These are marked `source: resume`. Your phone number and street address are not used anywhere on the site.

## Still open

- [ ] **MRI slices (D2): the big one.** Have a radiologist or your study team read the scan, then set `mri.professionalRead = true` in `src/data/site.ts` and remove `public/brain/mri/` from `.gitignore`. Until then the slices work only on your machine. They can't be committed, and the production build refuses them. To launch without slices, set `mri.enabled = false` and delete `public/brain/mri/`.
- [ ] **Résumé PDF.** Export a public version from Word (consider removing the phone number) and save it as `public/resume.pdf`. The link checker flags it as missing until then.
- [ ] **Email.** The site uses the résumé address (`Jjarami001@citymail.cuny.edu`). Swap it in `src/content/links.json` if you'd rather publish a different one.
- [ ] **Contact form (D6).** Add a Formspree form ID to `contactForm` in `src/data/site.ts`, or set `{ value: null, source: 'confirmed' }` to keep the email link only.
- [ ] **About.** Two sentences in your own voice: why neuroscience, and what position you're looking for.
- [ ] **ZVR Lab.** What the lab allows you to share: a results summary, the poster, and how to credit the lab.
- [ ] **Bikson Lab.** What "EC stimulation" refers to, whether any figures can be shown, and what you've learned.
- [ ] **NeuroForge.** Is it the private `eeg-cross-subject` repo? If it can be public, add the code link. A within-session versus leave-one-subject-out accuracy figure would help.
- [ ] **Memento Operating Loop.** Why you built it, the stack, and what you learned. Or delete the entry.
- [ ] **spike-sorting.** Describe it or delete `src/content/projects/spike-sorting.mdx`.
- [ ] **MRI case study.** "What I learned", which scripts to open-source, and which figures to approve.
- [ ] **Tags.** Approve the allow-list in `src/data/site.ts`.
- [ ] **Scan month** (optional, D7).

## Deployment

- [ ] Domain choice, and `SITE_URL` set in Vercel.
- [ ] Measure frame rate with `/?perf` on a laptop and a phone, and add the numbers to the README.
