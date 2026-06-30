# Production Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Launch "How Did Your Rep Vote?" as a product-ready public full-stack civic app with a GitHub Pages frontend, separately hosted Flask API, CI/CD, smoke checks, and portfolio-quality documentation.

**Architecture:** The Vite/React frontend deploys as static assets to GitHub Pages at `howdoesmyrepvote.us`. The production backend API base URL is injected at build time from the GitHub secret `PAGES_API_BASE_URL`, while backend runtime secrets stay only in the backend host or GitHub secrets. GitHub Actions gates deployment with frontend lint/tests/build, backend pytest, and a health smoke check against the configured API URL.

**Tech Stack:** React 19, Vite 8, Vitest, ESLint, Playwright, Flask, pytest, GitHub Actions, GitHub Pages.

## Global Constraints

- Frontend custom domain: `howdoesmyrepvote.us`.
- Production backend API URL must not be hardcoded; use GitHub secret `PAGES_API_BASE_URL`.
- Frontend production origin for backend CORS: `https://howdoesmyrepvote.us`.
- Keep address lookup as `POST /reps` so full addresses are not exposed in query strings.
- Keep district and representative lookup as GET routes.
- Do not commit API keys or backend secrets.
- Use existing test tools only: `npm run lint`, `npm test`, `npm run build`, `python -m pytest rep-tracker\backend`, existing Playwright tests.
- Do not change core product behavior unless required for deployment compatibility.

---

## File Structure

- Create `.github\workflows\pages.yml`: Runs frontend/backend checks, validates required secrets, builds the Vite app with production API configuration, uploads Pages artifact, deploys to GitHub Pages, and smoke-checks the production API health endpoint.
- Modify `rep-tracker\vite.config.js`: Adds explicit base-path handling through `VITE_PUBLIC_BASE_PATH`, defaulting to `/` for the custom domain.
- Create `rep-tracker\public\CNAME`: Publishes the GitHub Pages custom domain `howdoesmyrepvote.us`.
- Modify `rep-tracker\.env.example`: Documents local API URL plus production-only build variables.
- Modify `rep-tracker\backend\.env.example`: Documents production CORS origin and deployment-oriented runtime settings.
- Modify `rep-tracker\README.md`: Adds live demo, architecture, GitHub Pages deployment, backend deployment recipe, GitHub secrets, smoke checks, and resume-facing operating notes.

---

### Task 1: Frontend Pages Build Configuration

**Files:**
- Create: `rep-tracker\vite.config.test.js`
- Modify: `rep-tracker\vite.config.js`
- Create: `rep-tracker\public\CNAME`
- Modify: `rep-tracker\.env.example`

**Interfaces:**
- Consumes: GitHub Pages custom domain `howdoesmyrepvote.us`; GitHub Actions will provide `VITE_API_BASE_URL` and optionally `VITE_PUBLIC_BASE_PATH`.
- Produces: Vite config with `base` set from `process.env.VITE_PUBLIC_BASE_PATH || '/'`, a public `CNAME`, and frontend env docs.

- [ ] **Step 1: Write the failing configuration test**

Create `rep-tracker\vite.config.test.js` with this content:

```js
import { describe, expect, it, vi } from 'vitest'

describe('vite config', () => {
  it('defaults to root base path for custom-domain GitHub Pages', async () => {
    vi.resetModules()
    delete process.env.VITE_PUBLIC_BASE_PATH

    const config = (await import('./vite.config.js')).default

    expect(config.base).toBe('/')
  })

  it('allows repository-path Pages deployments through VITE_PUBLIC_BASE_PATH', async () => {
    vi.resetModules()
    process.env.VITE_PUBLIC_BASE_PATH = '/howdoesmyrepvote/'

    const config = (await import('./vite.config.js')).default

    expect(config.base).toBe('/howdoesmyrepvote/')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run from `rep-tracker`:

```powershell
npm test -- vite.config.test.js
```

Expected: FAIL because `config.base` is undefined.

- [ ] **Step 3: Implement Vite base-path configuration**

Replace `rep-tracker\vite.config.js` with this content:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const publicBasePath = process.env.VITE_PUBLIC_BASE_PATH || '/'

// https://vite.dev/config/
export default defineConfig({
  base: publicBasePath,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    setupFiles: './src/setupTests.js',
  },
})
```

- [ ] **Step 4: Add the GitHub Pages custom domain file**

Create `rep-tracker\public\CNAME` with this exact content:

```text
howdoesmyrepvote.us
```

- [ ] **Step 5: Document frontend environment variables**

Replace `rep-tracker\.env.example` with this content:

```env
VITE_API_BASE_URL=http://localhost:5000

# Production builds on GitHub Pages set VITE_API_BASE_URL from the
# PAGES_API_BASE_URL GitHub secret.
# Keep this as "/" for the custom domain https://howdoesmyrepvote.us.
VITE_PUBLIC_BASE_PATH=/
```

- [ ] **Step 6: Run the targeted test to verify it passes**

Run from `rep-tracker`:

```powershell
npm test -- vite.config.test.js
```

Expected: PASS with both Vite config tests passing.

- [ ] **Step 7: Commit**

```powershell
git add rep-tracker\vite.config.js rep-tracker\vite.config.test.js rep-tracker\public\CNAME rep-tracker\.env.example
git commit -m "Configure frontend for GitHub Pages"
```

---

### Task 2: GitHub Pages CI/CD Workflow

**Files:**
- Create: `.github\workflows\pages.yml`

**Interfaces:**
- Consumes: `PAGES_API_BASE_URL` GitHub secret containing the production backend API base URL.
- Produces: GitHub Actions workflow named `Deploy GitHub Pages` with jobs `checks`, `deploy`, and `smoke`.

- [ ] **Step 1: Write the workflow file**

Create `.github\workflows\pages.yml` with this content:

```yaml
name: Deploy GitHub Pages

on:
  push:
    branches:
      - master
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  checks:
    name: Test frontend and backend
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: rep-tracker/package-lock.json

      - name: Install frontend dependencies
        working-directory: rep-tracker
        run: npm ci

      - name: Lint frontend
        working-directory: rep-tracker
        run: npm run lint

      - name: Test frontend
        working-directory: rep-tracker
        run: npm test

      - name: Build frontend with local API default
        working-directory: rep-tracker
        run: npm run build

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.13"
          cache: pip

      - name: Install backend dependencies
        run: pip install -r requirements.txt

      - name: Test backend
        run: python -m pytest rep-tracker/backend

  deploy:
    name: Build and deploy Pages
    needs: checks
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Require production API secret
        env:
          PAGES_API_BASE_URL: ${{ secrets.PAGES_API_BASE_URL }}
        run: |
          if [ -z "$PAGES_API_BASE_URL" ]; then
            echo "PAGES_API_BASE_URL GitHub secret is required for production Pages builds."
            exit 1
          fi

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: rep-tracker/package-lock.json

      - name: Install frontend dependencies
        working-directory: rep-tracker
        run: npm ci

      - name: Build frontend for GitHub Pages
        working-directory: rep-tracker
        env:
          VITE_API_BASE_URL: ${{ secrets.PAGES_API_BASE_URL }}
          VITE_PUBLIC_BASE_PATH: /
        run: npm run build

      - name: Configure GitHub Pages
        uses: actions/configure-pages@v5

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: rep-tracker/dist

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4

  smoke:
    name: Smoke check production API
    needs: deploy
    runs-on: ubuntu-latest
    steps:
      - name: Require production API secret
        env:
          PAGES_API_BASE_URL: ${{ secrets.PAGES_API_BASE_URL }}
        run: |
          if [ -z "$PAGES_API_BASE_URL" ]; then
            echo "PAGES_API_BASE_URL GitHub secret is required for the production API smoke check."
            exit 1
          fi
          echo "API_BASE_URL=$PAGES_API_BASE_URL" >> "$GITHUB_ENV"

      - name: Check API health
        run: |
          curl --fail --show-error --silent "$API_BASE_URL/health"
```

- [ ] **Step 2: Validate workflow content locally**

Run from the repository root:

```powershell
$text = Get-Content .github\workflows\pages.yml -Raw
$required = @(
  'name: Deploy GitHub Pages',
  'secrets.PAGES_API_BASE_URL',
  'actions/deploy-pages@v4',
  'curl --fail --show-error --silent "$API_BASE_URL/health"'
)
foreach ($value in $required) {
  if (-not $text.Contains($value)) {
    throw "Missing workflow content: $value"
  }
}
Write-Host 'workflow content ok'
```

Expected: `workflow content ok`.

- [ ] **Step 3: Commit**

```powershell
git add .github\workflows\pages.yml
git commit -m "Add GitHub Pages deployment workflow"
```

---

### Task 3: Backend Production Configuration Documentation

**Files:**
- Modify: `rep-tracker\backend\.env.example`
- Modify: `rep-tracker\README.md`

**Interfaces:**
- Consumes: Frontend production origin `https://howdoesmyrepvote.us`; backend health endpoint `GET /health`; GitHub secret `PAGES_API_BASE_URL`.
- Produces: Copy-pasteable backend environment guidance and deployment recipe for a dedicated Flask API host.

- [ ] **Step 1: Update backend environment example**

Replace `rep-tracker\backend\.env.example` with this content:

```env
CONGRESS_CIVIC_API_KEY=your_api_key_here
CACHE_TTL_SECONDS=900
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://howdoesmyrepvote.us
REQUEST_TIMEOUT_SECONDS=10
GEMINI_TIMEOUT_SECONDS=30
HOUSE_VOTE_SCAN_LIMIT=30
HOUSE_VOTE_SESSIONS=119:2
HOUSE_VOTE_WORKERS=6
SENATE_VOTE_SCAN_LIMIT=30
SENATE_VOTE_SESSIONS=119:2
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.0-flash,gemini-2.5-flash-lite
GEMINI_ATTEMPTS=2
STANCE_EVIDENCE_LIMIT=20
```

- [ ] **Step 2: Add backend deployment documentation to README**

In `rep-tracker\README.md`, replace the existing `## Configuration` through `## Running locally` sections with content that includes:

````markdown
## Live deployment

- Frontend: `https://howdoesmyrepvote.us`
- Backend API: configured at build time through the `PAGES_API_BASE_URL` GitHub secret.
- Health check: `<PAGES_API_BASE_URL>/health`

The frontend is a static Vite build hosted on GitHub Pages. The Flask backend is hosted separately so API keys remain server-side and can be rotated without rebuilding the frontend.

## Configuration

Frontend variables in `rep-tracker\.env`:

```env
VITE_API_BASE_URL=http://localhost:5000
VITE_PUBLIC_BASE_PATH=/
```

For production GitHub Pages builds, set the repository secret `PAGES_API_BASE_URL` to the hosted Flask API origin. Do not include a trailing slash. The Pages workflow passes that value to Vite as `VITE_API_BASE_URL`.

Backend variables in `rep-tracker\backend\.env`:

```env
CONGRESS_CIVIC_API_KEY=your_api_key_here
CACHE_TTL_SECONDS=900
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,https://howdoesmyrepvote.us
REQUEST_TIMEOUT_SECONDS=10
GEMINI_TIMEOUT_SECONDS=30
HOUSE_VOTE_SCAN_LIMIT=30
HOUSE_VOTE_SESSIONS=119:2
HOUSE_VOTE_WORKERS=6
SENATE_VOTE_SCAN_LIMIT=30
SENATE_VOTE_SESSIONS=119:2
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.0-flash,gemini-2.5-flash-lite
GEMINI_ATTEMPTS=2
STANCE_EVIDENCE_LIMIT=20
```

For production, set `CORS_ORIGINS` to `https://howdoesmyrepvote.us` plus any temporary preview origins that need access. Avoid wildcard CORS in production.

House votes are loaded from Congress.gov roll-call data, and Senate votes are loaded from Senate.gov roll-call XML. The backend builds cached vote indexes, then reuses them for fast member lookups. `HOUSE_VOTE_SCAN_LIMIT` and `SENATE_VOTE_SCAN_LIMIT` control how many recent roll calls are scanned per chamber/session; `HOUSE_VOTE_WORKERS` controls concurrent House roll-call detail fetches; `STANCE_EVIDENCE_LIMIT` controls how many substantive policy votes are sent to Gemini for reasoning.

Policy profiles use deterministic vote classification to select substantive evidence. If `GEMINI_API_KEY` is configured with a Google AI Studio key, the backend asks Gemini Flash to produce a cautious, voter-facing explanation from the classified evidence. Without a Gemini key, the app reports that AI reasoning is unavailable.

## Running locally

Start the Flask API from `rep-tracker\backend`:

```bash
python app.py
```

Start the Vite dev server from `rep-tracker`:

```bash
npm run dev
```

Useful API endpoints:

- `GET /health`
- `GET /representatives`
- `POST /reps` with JSON `{ "address": "..." }` for address lookup, so addresses are not written to normal request logs as query strings
- `GET /reps?state=NY&district=12`
- `GET /reps?representative=Alexandria%20Ocasio-Cortez`
- `GET /member/<bioguide_id>/votes`
- `GET /member/<bioguide_id>/legislation`

## Backend deployment recipe

Deploy the Flask API from `rep-tracker\backend` on a host that supports Python web services.

Use these settings:

- Working directory: `rep-tracker\backend`
- Install command from repository root: `pip install -r requirements.txt`
- Start command from `rep-tracker\backend`: `python app.py`
- Health check path: `/health`
- Required runtime secret: `CONGRESS_CIVIC_API_KEY`
- Optional runtime secret: `GEMINI_API_KEY`
- Production CORS origin: `https://howdoesmyrepvote.us`

After the backend is hosted, set the GitHub repository secret `PAGES_API_BASE_URL` to the backend origin, such as the host-provided HTTPS URL. Push to `master` or run the `Deploy GitHub Pages` workflow manually to rebuild the frontend against that API.
````

- [ ] **Step 3: Verify README contains production launch details**

Run from the repository root:

```powershell
$text = Get-Content rep-tracker\README.md -Raw
$required = @(
  'https://howdoesmyrepvote.us',
  'PAGES_API_BASE_URL',
  'Backend deployment recipe',
  'Production CORS origin: `https://howdoesmyrepvote.us`',
  'Health check path: `/health`'
)
foreach ($value in $required) {
  if (-not $text.Contains($value)) {
    throw "Missing README content: $value"
  }
}
Write-Host 'readme deployment docs ok'
```

Expected: `readme deployment docs ok`.

- [ ] **Step 4: Commit**

```powershell
git add rep-tracker\backend\.env.example rep-tracker\README.md
git commit -m "Document production backend deployment"
```

---

### Task 4: Full Validation and Release Handoff

**Files:**
- Modify: `rep-tracker\README.md`

**Interfaces:**
- Consumes: Tasks 1-3 files and workflow behavior.
- Produces: Final validation evidence and a README resume story section.

- [ ] **Step 1: Add resume-facing project summary to README**

Append this section to `rep-tracker\README.md` before `## Checks`:

````markdown
## Resume story

This project demonstrates a production-ready full-stack civic data app:

- React/Vite frontend deployed to GitHub Pages at `https://howdoesmyrepvote.us`.
- Separately hosted Flask API with production CORS and server-side civic API keys.
- Privacy-aware address lookup using `POST /reps`.
- Congress.gov, Census geocoding, Senate.gov roll-call XML, and optional Gemini policy explanations.
- Automated frontend lint/tests/build, backend pytest, GitHub Pages deploy, and production API health smoke check.
````

- [ ] **Step 2: Run frontend lint**

Run from `rep-tracker`:

```powershell
npm run lint
```

Expected: PASS with no ESLint errors.

- [ ] **Step 3: Run frontend unit tests**

Run from `rep-tracker`:

```powershell
npm test
```

Expected: PASS with existing React/Vitest tests and the new Vite config tests.

- [ ] **Step 4: Run frontend production build**

Run from `rep-tracker`:

```powershell
$env:VITE_API_BASE_URL='https://example.test'; $env:VITE_PUBLIC_BASE_PATH='/'; npm run build
```

Expected: PASS and `rep-tracker\dist\CNAME` exists with `howdoesmyrepvote.us`.

- [ ] **Step 5: Run backend tests**

Run from the repository root:

```powershell
python -m pytest rep-tracker\backend
```

Expected: PASS with backend tests passing.

- [ ] **Step 6: Run Playwright e2e tests**

Run from `rep-tracker`:

```powershell
npx playwright test
```

Expected: PASS because API calls are mocked in `rep-tracker\e2e\lookup.spec.js`.

- [ ] **Step 7: Check git status**

Run from the repository root:

```powershell
git --no-pager status --short
```

Expected: only the README change from this task is uncommitted.

- [ ] **Step 8: Commit**

```powershell
git add rep-tracker\README.md
git commit -m "Add production launch resume summary"
```

