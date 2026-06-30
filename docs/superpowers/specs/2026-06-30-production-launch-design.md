# Production Launch Design

## Goal

Make "How Did Your Rep Vote?" resume-worthy as a public, product-ready full-stack civic app by launching the React frontend on GitHub Pages and connecting it to a separately hosted Flask API at a dedicated backend domain.

The work should demonstrate production deployment, CI/CD, environment management, API boundary design, privacy-aware address handling, and clear operating documentation. It should not change the core product experience unless a deployment issue requires a small compatibility fix.

## Architecture

The frontend remains a static Vite/React application deployed with GitHub Pages. It will be reachable from the project's public frontend domain or GitHub Pages URL and will build with the production `VITE_API_BASE_URL` pointing at the hosted Flask API.

The backend remains a Flask service deployed separately at the user's dedicated API domain. It owns all calls to Congress.gov, Census geocoding, Senate.gov XML, and Gemini when configured. Secrets such as `CONGRESS_CIVIC_API_KEY` and `GEMINI_API_KEY` stay only in backend host settings or GitHub secrets, never in the frontend bundle.

The production request boundary stays the same:

1. Browser renders the GitHub Pages frontend.
2. Frontend calls the hosted Flask API domain.
3. Backend validates requests, calls upstream civic data providers, normalizes and caches results.
4. Frontend renders representative lookup results, recent votes, sponsored legislation, and policy profile summaries.

Address lookup continues using `POST /reps` so full street addresses are not exposed as query strings. District and representative lookups continue using GET routes because they do not contain the same privacy-sensitive address data.

## Components and Configuration

### GitHub Pages frontend

Add production-ready Pages configuration for the Vite frontend:

- A GitHub Actions workflow that installs dependencies, runs the frontend checks, builds the app, and publishes the generated static assets to GitHub Pages.
- Vite/base-path handling that works for the selected Pages setup. If the frontend uses a custom domain at the site root, the base path should remain `/`. If it uses the repository Pages URL, the base path should be `/howdoesmyrepvote/`.
- A Pages `CNAME` file when a custom frontend domain is chosen.
- Production build configuration that sets `VITE_API_BASE_URL` to the dedicated backend domain.

### Dedicated Flask API domain

Document the backend deployment recipe rather than forcing one hosting provider. The recipe must cover:

- Required environment variables.
- Start command and working directory.
- CORS configuration locked to the production frontend origin.
- Health check URL using `GET /health`.
- How to rotate or update API keys without rebuilding the frontend.

### CI/CD and smoke checks

Add automation that makes the deployment story credible:

- Frontend CI runs lint, unit tests, build, and GitHub Pages deployment.
- Backend validation runs the existing pytest suite.
- A lightweight smoke check verifies the configured production API health endpoint when the backend URL is available.

The smoke check should fail loudly when the API is unreachable or unhealthy. It should not silently skip a configured production backend URL.

## Error Handling and Safety

Frontend API failures should remain user-facing. If the hosted backend is down or blocked by CORS, the app should show the existing local/API connection error pattern rather than appearing empty or successful.

Backend upstream failures should remain explicit. Congress.gov, Census, Senate.gov, and Gemini errors should continue to produce clear API errors or unavailable-analysis states rather than fabricated data.

CORS should be permissive only for local development or explicitly configured production origins. Production deployment should avoid wildcard CORS unless there is a documented reason.

Secrets must not be committed. The frontend receives only public configuration such as the backend base URL. Backend API keys live in the backend host settings or repository secrets used by CI.

## Testing Strategy

Use the existing test stack rather than adding new tooling:

- `npm run lint` from `rep-tracker`.
- `npm test` from `rep-tracker`.
- `npm run build` from `rep-tracker`.
- `python -m pytest rep-tracker\backend` from the repository root.
- Existing Playwright lookup tests with API calls mocked, so the deployment work does not depend on live civic APIs.
- A production smoke check against `GET /health` once the hosted backend domain is configured.

The implementation is successful when a fresh push can build and publish the frontend through GitHub Actions, the README tells a recruiter how to open the live demo, and the frontend can call the dedicated backend domain with production CORS in place.

## Resume Story

After this work, the project can be described as:

"Built and deployed a full-stack civic data app with a React/Vite frontend on GitHub Pages, a separately hosted Flask API, CI/CD deployment, production CORS and environment configuration, automated frontend/backend tests, and privacy-aware representative lookup using Congress.gov, Census, Senate roll-call data, and optional Gemini-generated policy explanations."

