# Parked GitHub Actions workflows

These run CI and the GitHub Pages deploy automatically on every push. They're
parked here because the GitHub login used to create the repo lacks the
`workflow` scope. To turn them on:

    gh auth refresh -h github.com -s workflow
    git mv ops/github-workflows/*.yml .github/workflows/
    git commit -m "Enable CI and Pages workflows" && git push

Then in the repo settings, set Pages → Source to "GitHub Actions".
Until then, deploy with `npm run deploy:pages` (builds the public site and
pushes it to the gh-pages branch).
