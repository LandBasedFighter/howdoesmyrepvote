# how did your rep vote?

look up your members of congress by address, district, or name and see how they voted on recent house and senate roll calls, plus the bills they sponsored.

**live:** https://howdoesmyrepvote.us

## overview

enter an address, district, or representative name to find your house member and senators. each member shows recent roll-call votes with plain-language context, sponsored and cosponsored bills, and an optional ai policy profile. all data comes from official government sources.

## architecture

- **frontend** - react + vite static site on github pages (`https://howdoesmyrepvote.us`).
- **backend** - flask api hosted separately so civic api keys stay server-side and rotate without a frontend rebuild. it geocodes addresses, resolves members, caches upstream data, and serves votes and legislation.
- **data** - congress.gov (house roll calls), senate.gov roll-call xml, census geocoding, and optional google gemini for policy explanations.
- **ci/cd** - frontend lint/test/build, backend pytest, github pages deploy, and a production api health check.

## configuration

frontend variables in `rep-tracker\.env`:

```env
VITE_API_BASE_URL=http://localhost:5000
VITE_PUBLIC_BASE_PATH=/
```

for production pages builds, set the repo secret `PAGES_API_BASE_URL` to the hosted api origin (no trailing slash). the workflow passes it to vite as `VITE_API_BASE_URL`.

backend variables in `rep-tracker\backend\.env`:

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

`*_SCAN_LIMIT` sets how many recent roll calls are scanned per chamber and session, `HOUSE_VOTE_WORKERS` sets concurrent house detail fetches, and `STANCE_EVIDENCE_LIMIT` caps votes sent to gemini. with a `GEMINI_API_KEY`, gemini flash writes a cautious, voter-facing policy summary; without one, the app says ai reasoning is unavailable. keep `CORS_ORIGINS` scoped to `https://howdoesmyrepvote.us` in production (no wildcards).

## deployment

the frontend is a static vite build on github pages. deploy the flask backend from `rep-tracker\backend` on any python host:

- working dir: `rep-tracker\backend`
- install (from repo root): `pip install -r requirements.txt`
- start: `python app.py`
- health check: `/health`
- secrets: `CONGRESS_CIVIC_API_KEY` (required), `GEMINI_API_KEY` (optional)

then set the repo secret `PAGES_API_BASE_URL` to the backend origin and push to `master` (or run the `Deploy GitHub Pages` workflow) to rebuild the frontend against it.

## api reference

- `GET /health`
- `GET /representatives`
- `POST /reps` with `{ "address": "..." }` (address lookup; kept out of query-string logs)
- `POST /reps` with `{ "lat": 40.75, "lon": -73.98 }` ("use my location"; kept out of query-string logs)
- `GET /reps?state=NY&district=12`
- `GET /reps?representative=Alexandria%20Ocasio-Cortez`
- `GET /member/<bioguide_id>/votes`
- `GET /member/<bioguide_id>/legislation`

## local development

needs node.js + npm, python 3, and a `CONGRESS_CIVIC_API_KEY`.

```bash
npm install                      # from rep-tracker
pip install -r requirements.txt  # from repo root
copy .env.example .env
copy backend\.env.example backend\.env
python app.py                    # backend, from rep-tracker\backend
npm run dev                      # frontend, from rep-tracker
```

checks:

```bash
npm run lint && npm run build && npm test   # from rep-tracker
python -m pytest rep-tracker\backend        # from repo root
```

## project layout

- `src\` - react frontend (vite).
- `backend\app.py` - flask api: geocoding, member lookup, caching, votes and legislation.
- `package.json` - frontend scripts and deps.
- `..\requirements.txt` - backend python deps.
