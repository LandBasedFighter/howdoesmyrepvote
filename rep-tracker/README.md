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

## Configuration

Frontend variables in `rep-tracker\.env`:

```env
VITE_API_BASE_URL=http://localhost:5000
```

Backend variables in `rep-tracker\backend\.env`:

```env
CONGRESS_CIVIC_API_KEY=your_api_key_here
CACHE_TTL_SECONDS=900
CORS_ORIGINS=http://localhost:5173
REQUEST_TIMEOUT_SECONDS=10
HOUSE_VOTE_SCAN_LIMIT=30
HOUSE_VOTE_SESSIONS=119:2
HOUSE_VOTE_WORKERS=6
SENATE_VOTE_SCAN_LIMIT=30
SENATE_VOTE_SESSIONS=119:2
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
STANCE_EVIDENCE_LIMIT=20
```

For deployment, set `VITE_API_BASE_URL` to the hosted Flask API URL and set `CORS_ORIGINS` to the hosted frontend origin. Use comma-separated origins when more than one frontend host needs access.

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
- `GET /reps?address=...`
- `GET /member/<bioguide_id>/votes`
- `GET /member/<bioguide_id>/legislation`

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
