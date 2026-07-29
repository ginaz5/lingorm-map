# Notion Data Source Deployment Workflow

This is the canonical workflow for deploying Lingorm Map with:

```text
DATA_SOURCE=notion
```

## What `notion` means at runtime

Notion is the system of record, but the deployed site does not query Notion
on each request.

```text
Notion
  → export
data/locations.csv
  → validate and commit
Netlify build
  → bundle snapshot with /api/locations
Browser
```

`/api/locations` reads the committed `data/locations.csv` snapshot when
`DATA_SOURCE=notion`. Updating Notion alone does not update the site; every
data change must go through export, validation, preview, and deployment.

## Current synchronization model

There is no automatic Notion-to-production synchronization in the current
committed-snapshot MVP. A successful edit in Notion is not live until the
snapshot has completed the manual workflow in this document.

The local exporter uses `NOTION_API_KEY` (the sole Notion credential as of the
2026-07-21 single-source cutover — see README "Environment variables") against
an allowlisted formal data source ID. It validates the current 20-property
schema before reading any rows and has no Notion write path.

Future automation work:

- Add a scheduled export, validation, and deployment workflow.
- Add export-failure and stale-snapshot alerts.
- Retain timestamped snapshots and complete a one-week failure-free soak.

This automation is a post-migration operational TODO and does not block the
committed-snapshot cutover.

Do not confuse runtime and export configuration:

| Variable | Purpose |
|---|---|
| `DATA_SOURCE=notion` | Selects the committed Notion snapshot at build/runtime (the only supported value — see README) |
| `NOTION_API_KEY` | Lets the local exporter (and all location-verification tooling) read and write the formal Locations data source |

## Netlify environment contexts

Configure environment variables under **Project configuration → Environment
variables**. Values may differ between Deploy Previews and Production.

| Variable | Deploy Preview | Production |
|---|---|---|
| `DATA_SOURCE` | `notion` | `notion` (the only supported value) |
| `HERE_API_KEY` | Required | Required |
| `GOOGLE_MAPS_KEY` | Optional | Optional |
| `GOOGLE_MAP_ID` | Required when `GOOGLE_MAPS_KEY` is set | Required when `GOOGLE_MAPS_KEY` is set |

Use scopes that include both **Builds** and **Functions**, or use **All scopes**.
The Deploy Preview value does not automatically become the Production value.

Netlify references:

- [Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/)
- [Environment variable contexts](https://docs.netlify.com/build/environment-variables/overview/#value-per-deploy-context)
- [Production deploys](https://docs.netlify.com/deploy/deploy-types/production-deploy/)

## Standard deployment workflow

### 1. Update Notion

Make and review location changes in the Notion Locations data source. Preserve
each existing row's `Slug`; it is the stable ID used by browser favorites and
shared `?favs=` URLs. Assign a supported `Country Code` and `Destination Key`
before changing a row to `Published`. The supported country codes are `TH`,
`VN`, `TW`, `HK`, and `MO`; Taiwan uses `taipei`, `taichung`, `kaohsiung`,
`tainan`, or `hualien`, while Hong Kong and Macau use `hong-kong` and `macau`.

### 2. Export the snapshot

Create a candidate file with the formal read-only integration:

```bash
npm run locations:export:notion -- --output data/locations.next.csv

node scripts/validate-location-snapshot.mjs data/locations.next.csv
node scripts/validate-favorite-compatibility.mjs \
  data/locations.next.csv data/legacy-favorite-ids.json

mv data/locations.next.csv data/locations.csv
npm run location:verify -- validate --all
```

The Notion integration reads the formal Locations data source. Never commit
`NOTION_API_KEY`. Exporting to a candidate file first preserves the
last-known-good `data/locations.csv` if the Notion request, schema preflight,
snapshot validation, or favorite compatibility gate fails.

`validate --all` is read-only. Before promotion it reports the expected
Notion-versus-committed-snapshot drift; after `locations.next.csv` is promoted,
the committed-snapshot layer must reconcile cleanly, alongside the schema,
protected-Slug policy, and live row invariants.

If no raw integration token is available, use the approved Notion connector or
manual export bridge. The required final artifact is still
`data/locations.csv` using the stable 17-column schema, including
`Country Code`, `Destination Key`, `Type`, and `Slug`.

### 3. Validate locally

Load the local environment, then run the same validation path used by Netlify:

```bash
set -a
source .env
set +a

npm test
npm run typecheck
bash build.sh
npm run build
```

With `DATA_SOURCE=notion`, `build.sh` enforces:

- The stable CSV header contract.
- The expected snapshot row count.
- Every published row has a supported, matching country/destination pair.
- Non-empty, unique Notion slugs.
- Preservation of all spreadsheet-derived legacy favorite IDs.
- Availability of the map-provider configuration.

Do not update `data/legacy-favorite-ids.json` merely to make a renamed or
removed slug pass. A deliberate replacement requires an explicit maintainer
decision and must record the old and new IDs in the manifest source metadata.
The approved `by` → `plantiful-sukhumvit-61` replacement intentionally does
not preserve the old favorite ID.

### 4. Commit on a feature branch

Do not push Notion snapshot changes directly to `main`.

```bash
git switch -c <feature-branch>
git add data/locations.csv
git commit -m "Update Notion location snapshot"
git push -u origin <feature-branch>
```

Include any code, validator, or documentation changes required by the same
snapshot in the same PR.

### 5. Open a PR and wait for the Deploy Preview

Netlify builds a separate preview URL for the PR. The build command is:

```text
bash build.sh && npm run build
```

The build must stop before deployment if the snapshot or favorites
compatibility checks fail.

### 6. Verify the Deploy Preview

Complete this checklist on the preview URL:

- The Netlify deploy check is successful.
- `/api/locations` returns HTTP 200 and `text/csv`.
- The CSV header includes `Slug`.
- The expected public location count is shown.
- Map markers and cards load.
- Search, category, language, and map/list controls work.
- A production favorites URL works on preview:

  ```text
  https://deploy-preview-N--lingorm-map.netlify.app/?favs=id-1,id-2
  ```

- Clicking **My Favorites** shows the expected locations.
- Reopening the preview root restores the preview's saved favorites.

Production and preview are different browser origins, so their `localStorage`
is not shared. The `?favs=` URL is the correct cross-origin compatibility test.
After merge, production keeps the same origin and retains existing production
favorites automatically.

### 7. Merge and deploy production

Before merging the production cutover, confirm the Netlify **Production**
context has:

```text
DATA_SOURCE=notion
```

Then merge the approved PR into `main`. The production deployment reruns the
same build and validation gates before replacing `lingorm-map.netlify.app`.

After deployment, verify:

- `https://lingorm-map.netlify.app/api/locations`
- Location count and representative locations.
- A saved production favorites list.
- Map-provider loading and Netlify Functions.

## Future Notion data updates

Repeat this cycle for every Notion change:

```text
Edit Notion
→ export data/locations.csv
→ validate locally
→ commit feature branch
→ PR Deploy Preview
→ verify
→ merge to main
→ verify production
```

There is no live Notion-to-production synchronization in the current
architecture.

## Rollback drill and emergency rollback

The legacy Google Sheet rollback path (`DATA_SOURCE=sheet`) is retired as of
the 2026-07-21 three-status cutover — `normalizeStatus()` no longer maps
legacy `verified`/`needs review` to `Published`, so it would render zero
public locations. `DATA_SOURCE=notion` is the only supported value; `build.sh`
refuses `DATA_SOURCE=sheet` outright.

`data/locations.csv` is the sole runtime data source, so rollback is a normal
git revert:

1. Identify the last known-good commit to `data/locations.csv` (`git log --
   data/locations.csv`).
2. Revert or fix-forward that file on a feature branch, then run the standard
   validation path (`npm test`, `npm run typecheck`, `bash build.sh`,
   `npm run build`).
3. Open a PR, verify the Deploy Preview, then merge to `main` for production.

There is no environment-variable toggle for rollback anymore — every recovery
goes through the same commit → Deploy Preview → merge flow as a normal
snapshot update.

## Related files

| File | Responsibility |
|---|---|
| `scripts/export-snapshot.mjs` | Notion API → stable CSV snapshot |
| `data/locations.csv` | Versioned runtime snapshot |
| `data/legacy-favorite-ids.json` | Protected favorite IDs plus explicit maintainer-approved replacements |
| `scripts/validate-location-snapshot.mjs` | Schema, row count, and slug validation |
| `scripts/validate-favorite-compatibility.mjs` | Legacy favorite-ID deploy gate |
| `netlify/functions/locations.mjs` | Serves the committed Notion snapshot at `/api/locations` (the retired Sheet proxy code path is unreachable in production — `build.sh` refuses `DATA_SOURCE=sheet`) |
| `build.sh` | Netlify predeploy validation |
| `netlify.toml` | Build, publish, Functions, and redirect configuration |
