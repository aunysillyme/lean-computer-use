# Website builder

## What and why

The builder turns repository documentation into the product page and its documentation pages.
It keeps editable words in `content.mjs`, page routes and source assignments in `pages.mjs`,
and page shells in the two templates. The output uses local assets and the reference Google Fonts stylesheet.
Only fonts.googleapis.com and fonts.gstatic.com may supply external font resources.
The navigation script handles copying the install command, marking sections and the mobile accordion.
It makes no network calls. The site has no analytics.

## Trigger

Run the builder after changing its content, sources, templates or assets.
A deploy is Git-triggered: every push to `main` rebuilds the site. `--live` is the only difference between a noindex preview build and the public discovery build.
The Vercel environment variable `SITE_LIVE=1` selects the live build; without it the site stays noindex with a `Disallow` robots.txt and no sitemap, `llms.txt` or `sameAs` links.
Set `SITE_LIVE=1` once the repository is public and the package is published, so the linked GitHub and npm pages exist.

## Invocation chain

`node website/build.mjs [--live]` reads and checks facts, validates the page map,
renders and checks every page in memory, then replaces `website/dist/`.
`vercel.json` runs `npm --prefix website ci`, then the builder and `website/check.mjs`, with `--live` on both when `SITE_LIVE=1`. A failed check leaves the previous deployment in place.

## Dependencies

Node.js as specified in `package.json`, Git for the source commit when
`VERCEL_GIT_COMMIT_SHA` is absent, and the local assets, including the owner-supplied trailer files. The website package has no dependencies.
The builder imports the fact helpers in `facts.mjs`; it checks source parity directly because
the older mock validator describes the earlier single-page mock.
To refresh `assets/social-preview.png`, render `assets/social-preview.svg` with `rsvg-convert`.
Rendering is a separate asset preparation step, outside the site build.

## Reads

The package metadata, `REPO_SETTINGS.md`, the README, proof receipts, `tools.json`,
the sources named in `pages.mjs`, the templates and local assets.
It reads only the commit variable named above; it writes no environment values other than that validated commit.
An optional `website/release.json` with a version and `"verified": true` supplies the displayed release.
An absent file or `"verified": false` leaves the package version labelled "not released yet".
The builder reads no network sources.
`pins.json` records the reviewed GitHub About text, README lead, install command,
package description and owner-selected headline. The builder and checker reject
source or rendered-page drift from these pins. Refresh pins only after reviewing
the canonical GitHub and npm copy.

## Writes

Only `website/dist/` in normal use. Both modes write HTML, local assets, `robots.txt`
and `build-info.json`. The build information records the commit, build time, package version,
mode and page count. Live mode also writes the sitemap, Markdown page twins,
`llms.txt` and `llms-full.txt`. The default mode uses noindex and disallows crawling.
The error page always uses noindex.

## The closed loop

Watcher: nothing. The calling process checks the exit status, output and build information.
The next checker stage will gate the deployment command. Its runtime is UNVERIFIED until that stage exists.
Build failures exit with a diagnostic and status 1. Input checks run before existing output is replaced.
Once output writing starts, a filesystem error can leave a partial output directory; rerun after fixing it.

## Failure modes

| Failure | Next action |
|---|---|
| Package description differs from the About row | Reconcile the source metadata, then build again. |
| Proof has expired or has an invalid value | Refresh the package receipts through the package workflow. |
| Tool assignment is missing or repeated | Assign each tool to its page in `pages.mjs`. |
| Source or asset is missing | Restore the named input. |
| Commit is missing or invalid | Run from a Git checkout or supply the full commit through the build environment. |
| Release JSON is invalid | Correct the JSON and verified version. |
| Output cannot be written | Restore filesystem access, then rerun the builder. |
| Golden mock differs after a content change | Regenerate the saved default landing at the fixed all-zero test commit. |
| Older facts tests reject the new mock | Update their earlier mock contract before treating them as site acceptance. |

Source HTML is treated as data. The renderer builds a limited set of tags, removes raw active blocks,
and accepts only safe link schemes. Included repository sources link to site routes;
other repository files link to their GitHub source. Images are limited to the named local assets.
Documentation text remains source-backed, including contradictions that need an owner correction in the source.

## Run and verify by hand

From the repository root:

```sh
npm --prefix website ci
node website/build.mjs
node --test test/website-build.test.mjs
node website/build.mjs --live
```

Inspect the landing and documentation HTML, the local assets and `build-info.json`.
Check that default output has noindex on every HTML page, a Disallow rule and no discovery files.
Check that live output has the matching Markdown twins, canonical URLs and sitemap routes.
Run `node website/check.mjs` in default mode or append `--live` for discovery mode. Compare default `index.html` with `website/mock/index.html`
using the same source commit. The tests use temporary output directories.
Remove the generated output when finished.

`pages.mjs` and the repository sources are the content map and source of truth.
`test/website-build.test.mjs` checks the builder contract. No deployment is verified here.
