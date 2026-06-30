# How Did Your Rep Vote?

A React and Flask app for looking up congressional representatives by address, then viewing recent House roll-call votes and sponsored legislation from Congress.gov.

## Project layout

- `src\` - React frontend built with Vite.
- `backend\app.py` - Flask API for geocoding addresses, finding members of Congress, caching upstream data, and fetching member votes/legislation.
- `package.json` - frontend scripts and dependencies.
- `..\requirements.txt` - backend Python dependencies.

## Requirements

- Node.js and npm
- Python 3
- A Congress.gov API key set as `CONGRESS_CIVIC_API_KEY`

## Setup

Install frontend dependencies from `rep-tracker`:

```bash
npm install
```

Install backend dependencies from the repository root:

```bash
pip install -r requirements.txt
```

Copy example environment files and fill in the API key:

```bash
copy .env.example .env
copy backend\.env.example backend\.env
```

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

## Resume story

This project demonstrates a production-ready full-stack civic data app:

- React/Vite frontend deployed to GitHub Pages at `https://howdoesmyrepvote.us`.
- Separately hosted Flask API with production CORS and server-side civic API keys.
- Privacy-aware address lookup using `POST /reps`.
- Congress.gov, Census geocoding, Senate.gov roll-call XML, and optional Gemini policy explanations.
- Automated frontend lint/tests/build, backend pytest, GitHub Pages deploy, and production API health smoke check.

## Checks

Frontend checks from `rep-tracker`:

```bash
npm run lint
npm run build
npm test
```

Backend tests from the repository root:

```bash
python -m pytest rep-tracker\backend
```
