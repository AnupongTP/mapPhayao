# Manual local sandbox

This is a disposable local-only environment for manually testing saved parcels. It uses synthetic LINE users and synthetic GIS fixtures, not production services. Map tiles are blank by design; enable a local boundary overlay if you need orientation. Do not use real personal data.

## Start, reset, stop

Prerequisites: Node.js/npm, repository dependencies (`npm install` and `cd backend; npm install`), and Docker Desktop with Linux containers running. From the repository root:

```powershell
npm run sandbox:start
```

Keep that terminal open. The command starts PostGIS, applies the existing migrations and E2E GIS bootstrap, then starts the local backend and frontend. Open either URL in a normal browser, not Playwright:

- User A: http://127.0.0.1:4173/?liff=1&sandbox-user=a
- User B: http://127.0.0.1:4173/?liff=1&sandbox-user=b

The page shows a `LOCAL SANDBOX · USER A` or `USER B` badge. Only these two fixed synthetic tokens are accepted. The backend verifies them and assigns parcel ownership through `app.users`; the browser never chooses an owner ID. Use separate tabs or private windows when switching users. Do not run automated E2E while the sandbox owns ports 4173, 3100, and 55432.

In another terminal, return to empty synthetic data with:

```powershell
npm run sandbox:reset
```

Reset removes only this sandbox's Docker project and volume, reapplies migrations and fixtures, and leaves the same A/B URLs running. It deletes saved sandbox parcels. To finish:

```powershell
npm run sandbox:stop
```

Stop closes the sandbox frontend/backend and removes only its disposable database and volume. Closing the start terminal with Ctrl+C also cleans up. Never use these commands to manage production services. If startup fails because a port is occupied or Docker is unavailable, the sandbox does not fall back to another database.

## Manual checklist

### A. User A

1. Open the User A URL and confirm the `LOCAL SANDBOX · USER A` badge and saved-parcel control.
2. Start parcel drawing. Add a point, pan, add another, undo, then add again. Cancel once and start a new drawing.
3. Add at least three points, finish the polygon, name it `MANUAL-A-PARCEL`, and analyze it.
4. Save it, open **My Parcels**, and confirm it appears. Reload the page and confirm it is still there.
5. Expand the saved parcel card, edit its name or other supported metadata, save, reload, and confirm the change.
6. Use **วิเคราะห์ใหม่** (reanalyze) on the saved parcel and confirm a new result appears.
7. To test existing boundary editing, expand the card and choose **แก้ไขขอบเขต**. Drag a vertex, save the boundary, reanalyze if prompted, reload, and confirm the saved shape. Cancel a second edit to confirm the original remains.

### B. User B

1. Open the User B URL and confirm the `LOCAL SANDBOX · USER B` badge.
2. Open **My Parcels**. User A's parcel must not appear.
3. Draw, analyze, and save `MANUAL-B-PARCEL`. Confirm it appears after a reload.

### C. Return to User A

1. Reopen the User A URL. **My Parcels** must show A's parcel but not B's.
2. Delete A's parcel through its card and confirmation dialog. Reload; it must remain absent. B's parcel must still be visible only to User B.

### D. Mobile UI

1. Use a narrow browser viewport or browser device emulation on the same machine. Open/close the layer drawer with its close button and scrim.
2. Enable a local GeoJSON boundary overlay, disable it, and confirm features clear. Expand/collapse the hazard legend.
3. Check the drawing HUD: centered reticle, add, undo, finish, and cancel. Confirm controls remain visible and the page has no horizontal overflow.

### E. Optional LINE summary

1. As User A, confirm a map location and press the LINE summary action.
2. Inspect http://127.0.0.1:3100/__e2e__/messages in a browser. The last recipient should be `U_E2E_USER_A`. The test backend records the message locally; it never pushes to LINE.

The sandbox is not a real LINE WebView. Its database contains only minimal deterministic GIS fixtures, so suitability and hazard results are not production-grade. The existing backend and browser network guards prevent external weather, GISTDA, LINE, Render, Netlify, and Supabase calls during application use.
