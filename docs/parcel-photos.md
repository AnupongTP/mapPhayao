# Parcel photos (local-first)

PostgreSQL/PostGIS remains authoritative. Apply `database/migrations/20260924_create_parcel_images.sql` after the existing ownership migrations before enabling uploads. The migration adds nullable `app.users.display_name` without changing `picture_url`, plus `app.parcel_images` with `ON DELETE CASCADE`.

Set these backend-only variables when real Google integration is approved:

- `GOOGLE_MIRROR_ENABLED=true`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (JSON credential; never commit it)
- `GOOGLE_SHEETS_SPREADSHEET_ID` = the prepared FarmTech spreadsheet ID
- `GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID` = the prepared parcel-image folder ID

Grant the service account access to spreadsheet `17zLOFxEaiGDzRrXWMNLtWcBq7gboLwlC67uGo0G3gJg` and Drive folder `1vNMWJy5E00UUDxWRjUJ9RY1h4j1B5Zyk`. Existing tab names and headers must be preserved. No sharing permissions are changed by the app. Browser image display uses an authenticated backend proxy, so Drive files need not be public. Keep `GOOGLE_MIRROR_ENABLED=false` until credentials, access, and migration are ready.

The users sheet stores internal app UUID, verified LINE display name, created_at, updated_at. It never stores LINE user ID or `picture_url`. The parcels tab has the exact A-P contract: `user_id`, `display_name`, `parcel_code`, `parcel_name`, `crop`, `variety`, `planting_date`, `Coordinate`, `geometry`, `area_m2`, `area_rai`, `Image`, `LinkImage`, `note`, `created_at`, `updated_at`. `user_id` is the internal app.users UUID. `display_name` comes from app.users and is human-readable mirror data only, never an authorization identity. Neither LINE user ID nor `picture_url` is exported. The mirror checks the existing A-P header before parcel writes/deletes and reports a mismatch without changing headers.

`Coordinate` is reserved for a plain-text WGS84/EPSG:4326 point in latitude, longitude order with six decimal places, for example `19.191926, 99.818955`. The application currently has no canonical persisted parcel point, so this cell remains empty; the polygon centroid, first vertex and GPS origin are not substituted. `geometry` remains the complete parcel-boundary GeoJSON text in EPSG:4326. The application also has no persisted parcel note/remark field, so `note` remains empty. Supporting note entry later requires a defined field in the parcel DB schema, API and UI. `Image` and `LinkImage` are JSON arrays ordered from the same `sort_order, created_at, id` image list. An empty list is `[]` in both cells.

Uploads accept decoded JPEG, PNG, WebP and HEIF when supported by the installed Sharp runtime. Each request is limited to 12 MB. The backend auto-orients, shrinks without enlargement to a 1600 px maximum long edge, writes WebP at quality 75, and omits EXIF metadata. Names are generated from parcel code, UTC timestamp and a random suffix. Originals and separate thumbnails are not stored in Drive.

The parcel is created before any image upload. A failed photo upload does not roll back the parcel; the open save sheet reports the failed count and retries only pending photos. Google Sheet failures are logged and do not roll back PostgreSQL. This version has no durable mirror retry/outbox. Drive deletion after parcel deletion is best-effort. If Drive upload succeeds but DB insertion fails, the uploaded file is deleted best-effort.

## Local verification

`npm run sandbox:start` uses disposable local PostGIS and fake LINE/Google services. Open `http://127.0.0.1:4173/?liff=1&sandbox-user=a`. Draw a parcel, choose several local images in the naming panel, remove one, analyze, then save. Reopen its saved analysis and check the gallery. Test the same flow without photos, then use User B at `http://127.0.0.1:4173/?liff=1&sandbox-user=b` to check ownership. The fake Google state is available locally at `http://127.0.0.1:3100/__e2e__/google`; no real Google API is called. Stop with `npm run sandbox:stop`, which removes the disposable DB and its images.
