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
HOUSE_VOTE_SCAN_LIMIT=10
HOUSE_VOTE_SESSIONS=119:2
```

For deployment, set `VITE_API_BASE_URL` to the hosted Flask API URL and set `CORS_ORIGINS` to the hosted frontend origin. Use comma-separated origins when more than one frontend host needs access.

Congress.gov currently exposes beta House roll-call vote data through `/house-vote`; Senate votes are not available from that API. The backend builds a cached `bioguideId -> votes` index from the scanned House sessions, then reuses it for fast member lookups. Keep `HOUSE_VOTE_SCAN_LIMIT` and `HOUSE_VOTE_SESSIONS` small for responsive local use; increase them only when you need deeper history.

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
