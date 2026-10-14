# AGENTS.md — Map Phayao / mapphayao1

Read this file before editing the repository. Use the latest explicit user instruction and the actual current local code/database state as the primary source of truth.

## 1. Project identity

Project: Map Phayao / mapphayao1

Repository:
C:\ms4w\Apache\htdocs\mapphayao1

Production architecture:
LINE LIFF
→ Netlify frontend
→ Render Node/Express backend
→ Supabase PostgreSQL/PostGIS
→ Google Sheet mirror / Google Drive parcel photos through signed Apps Script bridge

Frontend:
- Plain HTML/CSS/JavaScript
- Leaflet 1.9.x
- Leaflet Draw
- Mobile-first, especially LINE in-app browser / LIFF

Backend:
- Node.js + Express
- PostgreSQL/PostGIS authoritative business database
- Google integration for mirror/photo storage

GIS CRS:
- Frontend/GPS/GeoJSON: EPSG:4326
- Stored parcel geometry / spatial analysis: EPSG:32647
- Parcel geometry in PostgreSQL must remain MultiPolygon SRID 32647

Do not redesign the architecture from scratch unless explicitly requested.

## 2. Source-of-truth priority

When sources disagree, use this order:

1. Latest explicit user instruction.
2. Actual current local repository files and Git state.
3. Current database schema / migrations in the working tree.
4. Current runtime behavior and logs.
5. Current remote main when relevant.
6. mapProject_memory1.md.
7. Older handoff files or chat assumptions.

Never assume a local implementation is deployed.
Never assume a passing mocked test proves production behavior.

## 3. Mandatory pre-work steps

Before editing:

1. Read this AGENTS.md.
2. Read any nested AGENTS.md applicable to files you may change.
3. Run:
   git status --short
4. Inspect the current dirty working tree.
5. Inspect the actual relevant files and tests.
6. Briefly report what you intend to change and why.

Do not assume the repository is clean.

## 4. Git safety

Do not use destructive Git commands.

Never use:
- git reset
- git clean
- git stash
- git restore
- git checkout -- .
- git add .

Do not stage, commit, push, deploy, amend, rebase, or force-push unless explicitly approved.

Preserve unrelated local changes.

When staging is later approved:
- stage exact intended files only
- review staged diff before commit

LF/CRLF warnings are not errors by themselves.

## 5. Security and ownership

Parcel APIs use verified LINE identity.

Required ownership chain:

verified LINE idToken
→ verified LINE subject
→ app.users.line_user_id
→ app.users.id UUID
→ app.parcels.owner_user_id

Rules:
- Never trust owner IDs from the frontend.
- Never trust LINE user IDs from the frontend.
- Never expose LINE IDs, idTokens, access tokens, HMAC secrets, Google credentials, or service-account keys.
- Never hardcode secrets.
- Frontend must never connect directly to PostgreSQL.
- Use parameterized SQL.
- Do not expose stack traces or internal filesystem paths to users.
- Do not use wildcard CORS.
- Do not use mode: "no-cors".

clientPhotoId is an idempotency identifier only; it is not an authorization credential.

## 6. Parcel lifecycle

### Temporary parcel

Temporary parcels live in frontend state until final save confirmation.

Current intended flow:

Draw parcel
→ confirm boundary
→ open one "รายละเอียดแปลง" form
→ enter metadata once
→ analyze
→ show analysis result
→ press Save
→ show confirmation only
→ confirm final save
→ create authenticated permanent parcel
→ upload selected photos sequentially

Temporary parcel details include:
1. ชื่อแปลง
2. ชนิดพืช
3. พันธุ์
4. วันที่ปลูก
5. รูปภาพ
6. หมายเหตุ

Rules:
- New temporary parcel planting date defaults to the device-local current calendar date.
- Reopening/editing the temporary form preserves the previously selected date.
- Do not persist a parcel before final confirmation.
- Selected photos remain temporary/local until final save.
- Maximum 5 photos per parcel.
- Note is optional.

### Saved parcel editing

Saved parcel edit form is metadata-only for now:
- parcel name
- crop type
- variety
- planting date
- note

Do not add saved-parcel photo management unless explicitly requested later.

Editing a saved parcel must not reset planting date to today.

## 7. Parcel database rules

PostgreSQL/PostGIS is authoritative for:
- users
- parcel ownership
- parcel business metadata
- parcel geometry
- note
- cleanup queue

Do not introduce active parcel-photo metadata storage in PostgreSQL.

Specifically:
- Do not create or reintroduce app.parcel_images.
- Supabase/PostgreSQL must not become the parcel-photo metadata store.

Parcel geometry storage:
- MultiPolygon
- SRID 32647

Client/API GeoJSON:
- EPSG:4326

Use ST_Transform for CRS conversion.
Do not substitute ST_SetSRID for coordinate transformation.

Do not use SELECT *.

## 8. Google Sheet mirror contract

Spreadsheet:
FarmTech

The parcels sheet exact A:P contract is:

A user_id
B display_name
C parcel_code
D parcel_name
E crop
F variety
G planting_date
H Coordinate
I geometry
J area_m2
K area_rai
L Image
M LinkImage
N note
O created_at
P updated_at

Rules:
- Do not rename, reorder, insert, or rebuild headers silently.
- Validate the exact header contract and stop/report on mismatch.
- Image and LinkImage are aligned JSON arrays.
- Image[i] must correspond to LinkImage[i].
- Business-data mirror updates must preserve photo arrays unless explicitly changing photos.
- Image append to existing row should not overwrite N:P.
- note is mirrored to column N.
- created_at / updated_at displayed in Sheet use explicit Asia/Bangkok (+07:00) representation.
- PostgreSQL timestamps remain timestamptz; do not add seven hours in SQL.

Google Sheet is a secondary mirror, not the authoritative application database.

## 9. Parcel photo architecture

Final architecture:

Actual image files:
Google Drive

Photo references:
Google Sheet Image / LinkImage

Authoritative parcel ownership:
PostgreSQL

### Upload flow

Frontend temporary photo
→ client preparation/compression
→ authenticated backend
→ owner verification
→ backend Sharp normalization
→ signed Apps Script bridge
→ Google Drive
→ Sheet Image/LinkImage update

Current browser preprocessing:
- max edge about 1600 px
- WebP around quality 0.80 when supported
- safe fallback if decode/encoding unsupported or output is worse

Backend Sharp remains authoritative:
- accepted formats according to current implementation
- raw upload maximum about 12 MB
- auto orientation
- max edge 1600
- WebP quality 75
- metadata stripped

Do not weaken backend validation because browser preprocessing exists.

### Saved photo read flow

Frontend / LIFF
→ authenticated Render endpoint
→ LINE ownership check
→ trusted Sheet Image/LinkImage lookup
→ derive Drive fileId server-side
→ signed Apps Script read
→ Drive getBlob
→ backend returns image/webp
→ frontend Blob/ObjectURL

Do not use direct Google Drive URLs as normal <img src>.
Do not add a direct Drive fallback.

### Photo limits and ordering

- Maximum 5 photos per parcel.
- Upload sequentially.
- Do not replace sequential upload with unbounded Promise.all.

## 10. Photo upload reliability

Each temporary photo has a stable clientPhotoId.

Requirements:
- assigned once when accepted
- preserved through preprocessing, analysis, reopen, save, and retry
- new photo gets a new ID
- backend validates clientPhotoId
- backend derives deterministic final filename from trusted parcel data + clientPhotoId
- frontend does not supply the trusted final filename

Retry rules:
- initial attempt + maximum 3 retries = maximum 4 attempts
- approximate delays: 500 ms / 1000 ms / 2000 ms
- retry only positively classified safe transient errors
- do not retry validation/auth/ownership/413/415/integrity errors
- successful previous photos must not be re-uploaded unnecessarily
- partial save must reuse the already-created parcel

Important:
Apps Script upload timeout/network after dispatch can be an ambiguous write.
Do not blindly replay Drive createFile() when idempotency cannot be proven safely.

Do not solve this by:
- scanning Drive
- folder.getFilesByName
- full-folder enumeration
- app.parcel_images

Do not introduce Drive filename search into normal upload or retry.

## 11. Parcel deletion and cleanup queue

User-facing delete must be fast.

Current intended flow:

authenticate owner
→ collect trusted parcelCode and Drive fileIds from server-side data
→ DB transaction:
   DELETE owned parcel
   INSERT durable cleanup job
→ COMMIT
→ return HTTP success
→ frontend removes parcel immediately
→ background cleanup continues

The authoritative delete and cleanup enqueue must be atomic.

Durable queue:
app.cleanup_jobs

The queue exists only for background cleanup work; it is not parcel-photo metadata.

Cleanup order:
1. delete Google Sheet parcel row
2. delete Drive image files sequentially

Rules:
- Sheet delete is idempotent; already-missing row is complete.
- Persist partial Drive cleanup progress.
- Retry transient failures with backoff.
- Do not hammer Apps Script.
- Keep terminal failed jobs for diagnosis.
- Use PostgreSQL claiming/locking suitable for multiple backend instances.
- Recover stale processing leases after restart.
- Do not use fire-and-forget Promise or setTimeout as the durability mechanism.

Important 404 rule:
An Apps Script bridge HTTP 404 is NOT proof that a Drive file is already absent.
Do not silently treat bridge endpoint 404 as successful file cleanup.

## 12. Current known concurrency risk

Upload-vs-delete race for the same parcel must be treated carefully.

Potential scenario:
- one request uploads a photo
- another request deletes the same parcel concurrently

Before release, test/analyze whether this can orphan a new Drive file or recreate/modify Sheet state after delete.

Do not invent a broad distributed lock unless evidence shows it is required.

If a fix is required:
- use the smallest robust fix
- preserve normal performance
- preserve no-Drive-scan rule
- preserve ownership checks

## 13. Apps Script bridge

Apps Script is a signed server-to-server bridge.

Production uses the existing /exec Web App URL.

Do not expose the bridge secret.

Current HMAC protections, timestamp/skew checks, and nonce/replay protections must not be weakened.

Opening /exec directly in a browser may produce a doGet-related message because the bridge is POST-based; do not misdiagnose that alone as failure.

When Code.gs changes:
- source changes do not imply deployment
- deploy later only with explicit approval
- preserve the existing deployment URL by publishing a new version of the existing deployment

## 14. Weather bridge

Weather currently uses Apps Script as an approved transport path when configured.

Do not redesign weather while working on parcel/photo tasks unless explicitly requested.

Do not silently fall back from Apps Script transport to direct provider calls in production.

## 15. GIS display rules

Static display overlays use frontend GeoJSON.

Do not restore GeoServer WMS as an active frontend dependency.

Do not use:
- L.tileLayer.wms for approved static overlays
- localhost:8080 frontend dependencies
- CQL_FILTER
- GeoServer SLD logic

Static overlay behavior:
- optional overlays disabled initially
- load only when enabled
- abort unfinished fetch on disable where current code supports it
- clear layer on disable
- prevent stale responses and duplicates
- do not regenerate/simplify/dissolve geometry unless explicitly requested

Google Satellite should remain the expected initial basemap unless explicitly changed.

## 16. Point analysis rules

Point flow remains explicit-confirmation based:

click/drag/GPS
→ update location
→ no immediate point API call
→ user confirms
→ call point analysis/report API

Do not trigger point analysis on every map click, drag, GPS lookup, page load, or layer toggle.

Use one draggable marker and AbortController for overlapping confirmed requests where current code does so.

## 17. Testing rules

During implementation:
- use focused tests first
- avoid unnecessary full E2E for every small change

Before release:
- run meaningful full frontend/backend regression
- run realistic CRUD/integration tests against disposable PostgreSQL/PostGIS
- run realistic browser E2E
- test retry/fault injection
- test cleanup queue persistence, lease recovery, and multi-worker behavior
- inspect migration order
- run git diff --check

Never use production Supabase, production Google Sheet, production Drive, or production Apps Script as automated E2E scratch systems.

Use synthetic/fake LIFF identity and disposable test database.

Passing mocks alone is not enough to claim production success.

## 18. Realistic CRUD expectations

Before release, test the full lifecycle:

CREATE
- create parcel
- note/date/metadata
- selected photos

READ
- list/open owned parcel
- verify note and metadata
- verify protected thumbnail/fullscreen read

UPDATE
- edit name/crop/variety/date/note
- edit note only
- clear note
- verify unrelated values remain unchanged

DELETE
- delete parcel
- verify immediate UI removal after HTTP success
- verify parcel row gone
- verify cleanup job exists
- verify worker eventually removes Sheet/Drive artifacts in test environment

## 19. Test infrastructure integrity

Test helpers and fake providers must not hide real failures.

Do not:
- globally ignore arbitrary console errors
- globally ignore failed HTTP requests
- bypass ownership in a way production cannot
- force success unconditionally

If a test deliberately injects a known 503/429/etc., assert that specific expected failure narrowly.

Clean disposable servers/containers/volumes started by tests.

## 20. Performance and scalability rules

Do not introduce:
- Drive folder scans
- Drive filename enumeration
- unbounded Promise.all
- high-frequency worker polling
- synchronous Drive cleanup in user DELETE request

Known future scalability concern:
Current Google Sheet row lookup may read broad ranges.
Treat this as a future optimization unless it causes a concrete correctness/performance failure now.

Do not redesign Sheet indexing during unrelated work.

## 21. Logging

Logs may include safe operational context such as:
- parcelId
- cleanup job id
- attempt
- remaining file count
- safe stage/category/status

Never log:
- LINE idToken
- Authorization header
- LINE user ID
- Apps Script secret/signature
- Google credentials
- image bytes/Base64
- raw sensitive request bodies

User-facing errors must remain sanitized.

## 22. Deployment and production safety

Do not:
- run production migrations without explicit approval
- change Render billing/plan
- change LINE Developers settings
- change Netlify/Render production config
- deploy Apps Script
- push Git

unless explicitly instructed.

Release preparation order should normally be:

1. final review
2. focused fixes
3. rerun regression
4. stage exact files
5. review staged diff
6. commit
7. apply approved migrations in correct order
8. deploy backend/frontend/Apps Script if required
9. push as explicitly instructed
10. verify production runtime
11. test real LINE LIFF on phone

Exact order may be adjusted based on deployment mechanics, but never skip review and migration safety.

## 23. Current uncommitted milestone context

At the time this draft was prepared, the local working tree contains uncommitted Round 1–3 work:

Round 1:
- one-time parcel details form
- max 5 photos
- note end-to-end
- Sheet +07:00 timestamp rendering

Round 2:
- clientPhotoId
- deterministic filenames
- safe upload retry
- partial-save protection
- no Drive filename search

Round 3:
- durable app.cleanup_jobs queue
- atomic delete + enqueue
- background Sheet/Drive cleanup
- lease/retry/backoff

Also:
- saved parcel edit form already supports note
- saved-parcel photo management is intentionally deferred

Do not assume these changes are committed or deployed until Git/deployment state proves it.

## 24. Minimum release checks

Before claiming the system is ready:

- no staged surprises
- git diff --check passes
- migrations apply cleanly to disposable DB
- frontend tests pass
- backend tests pass
- relevant/full E2E passes
- no new console errors
- Thai UTF-8 text remains valid
- ownership isolation still works
- point analysis still works
- parcel draw/analyze/save/edit/delete still works
- max 5 photos enforced
- protected photo read still works
- upload retry behavior is bounded and safe
- delete HTTP no longer waits for Drive cleanup
- cleanup job is durable and recoverable
- no Drive scan/search introduced
- no app.parcel_images introduced
- no direct Drive image fallback introduced

## 25. Final working rule

Make the smallest targeted change that satisfies the request.

Preserve:
- existing architecture
- existing security model
- GIS CRS discipline
- owner isolation
- protected photo architecture
- current dirty working tree

When uncertain:
inspect the actual code, schema, logs, or runtime instead of guessing.

Do not claim success for anything not actually tested or verified.
