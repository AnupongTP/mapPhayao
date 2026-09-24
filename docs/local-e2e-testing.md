# Local E2E testing

The E2E suite runs the current local frontend, Express backend, and a disposable PostGIS database. It does not use real LINE accounts, production Supabase, or deployment services. It does not deploy anything.

## Prerequisites

- Node.js and npm
- Docker Desktop with a running Linux container engine
- Playwright Chromium and WebKit browsers installed outside this repository

Install dependencies and browsers:

```powershell
npm install
npx playwright install chromium webkit
cd backend
npm install
cd ..
```

Run the complete suite from the repository root:

```powershell
npm run test:e2e
```

For an interactive browser or Playwright UI:

```powershell
npm run test:e2e:headed
npm run test:e2e:ui
```

The runner owns ports `4173` (frontend), `3100` (backend), and `55432` (PostGIS). It refuses conflicting ports and nonlocal database settings. It creates a uniquely named Docker Compose project, applies the checked-in parcel migrations and E2E-only GIS bootstrap, and removes that project's volume when done, including after a failed test. To retain the disposable database for debugging, set `E2E_KEEP_DB=1` before running. The runner prints the retained project name; remove it afterward with `docker compose -f docker-compose.e2e.yml -p <printed-project-name> down --volumes`.

The static frontend server replaces only the four Leaflet and Leaflet Draw CDN asset URLs in the served HTML with the same npm versions. Map tiles are supplied by the Playwright harness. Browser requests to any host other than `127.0.0.1`, apart from intercepted tile URLs, fail the network gate. The backend test process rejects outbound fetches, so LINE and external weather/GISTDA calls cannot occur. The server uses the real Express routes, services, parameterized SQL, and PostGIS queries.

Playwright injects a small LIFF object before page scripts run. It supplies `e2e-line-token-user-a` or `e2e-line-token-user-b` in the same places as a real ID token. The test-only verifier maps those tokens to `U_E2E_USER_A` and `U_E2E_USER_B`. Parcel requests still use `Authorization: Bearer`; the LINE summary still sends `idToken` in its JSON body. A test-only in-memory message recorder replaces LINE push delivery. No browser-provided user ID is trusted for ownership.

The database bootstrap contains only synthetic GIS polygons, lines, and hazard rows around the map's initial location. Parcel owners and parcels are created by application requests during the test. The default run starts with a new database. Run `npm run test:e2e` a second time to verify a fresh bootstrap and reproducibility.

Reports and failure artifacts are written to `playwright-report/` and `test-results/`; both are ignored by Git. Open a completed HTML report with `npx playwright show-report`. Playwright's mobile profiles validate responsive behavior but do not emulate the exact LINE WebView implementation.
