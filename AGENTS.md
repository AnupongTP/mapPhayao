# AGENTS.md

Read this file before editing the repository. Use the actual code and database state as the primary source of truth.

## Project

Web GIS for rice and maize land-suitability analysis in Phayao.

- Frontend: HTML, CSS, JavaScript, Leaflet, Leaflet Draw
- Backend: Node.js, Express
- Database: PostgreSQL/PostGIS (`map1`)
- Display layers: Static GeoJSON loaded by Leaflet
- Spatial analysis: Backend API + PostGIS
- Frontend/GPS/GeoJSON CRS: EPSG:4326
- Analysis CRS: EPSG:32647

Do not replace frameworks or create duplicate maps, Layer Controls, handlers, routes, or renderers.

## Display Layers

Frontend overlays use static GeoJSON only:

- Thailand provinces
- amphoe
- tambon
- basin_main
- sub_basin_display
- stream
- irrigation_canal
- rice_potential
- maize_potential

GeoJSON is for display only. Analysis data such as `soil`, `basin`, and other GIS tables must remain in PostGIS.

Overlay rules:

- Do not load overlay GeoJSON during initial page load.
- Load a layer only when the user enables it.
- Use relative URLs such as `data/layers/amphoe.geojson`.
- When disabled, abort unfinished fetches and call `clearLayers()`.
- Prevent stale responses and duplicate features.
- Optional overlays are disabled initially.
- Styles are defined in Leaflet JavaScript.
- Do not regenerate, simplify, dissolve, split, or modify GeoJSON geometry unless explicitly requested.

Frontend overlays must not use:

- `L.tileLayer.wms`
- `localhost:8080`
- GeoServer workspace/layer names
- `CQL_FILTER`
- GeoServer SLD styles

GeoServer may remain in the repository, but it is not a frontend display dependency.

## Point Analysis

Required flow:

1. User clicks the map, drags the existing marker, or uses GPS.
2. Latitude and longitude update.
3. No API call occurs yet.
4. User confirms the location.
5. Frontend calls:

`GET /api/rice-suitability/point?lat={lat}&lng={lng}`

Rules:

- Use one draggable marker.
- GPS moves the existing marker.
- Use `dragend`.
- Do not call the point API during map click, drag, GPS lookup, page load, or layer toggle.
- Use `AbortController` for overlapping confirmation requests.
- Display rice and maize results separately.

## Temporary Parcels

Temporary parcels use Leaflet Draw and frontend memory only.

- Support multiple parcels, editing, deletion, selection, and retry analysis.
- `Escape` cancels unfinished drawing only.
- Use `POST /api/area-analysis/polygon`.
- Do not use localStorage, sessionStorage, IndexedDB, or automatic database persistence.
- Frontend must not call `/api/parcels` unless explicitly requested.

## Database and GIS

- Inspect the real schema before writing SQL.
- Never guess column names.
- Use parameterized SQL.
- Input coordinates are EPSG:4326.
- Transform to EPSG:32647 before GIS analysis.
- Use `ST_MakePoint(longitude, latitude)`.
- Do not use `ST_SetSRID` instead of coordinate transformation.
- Use `ST_Covers` for polygon lookup where appropriate.
- Use `<->` for nearest ordering and `ST_Distance` for actual distance.
- Do not use `SELECT *`.
- Do not return geometry unless required.

Suitability classes:

- S1 = Highly suitable
- S2 = Moderately suitable
- S3 = Marginally suitable
- N = Not suitable

`NO_DATA` and `NO_COVERAGE` are not `N`.

For display GeoJSON:

- Suitability field: `suitabilit`
- Thai label field: `suitabil_1`

Verify actual properties before changing code.

## Security

- Never hardcode credentials.
- Frontend must not connect directly to PostgreSQL.
- Never build SQL from raw user input.
- Do not expose stack traces, connection strings, credentials, or internal paths.
- Prefer `textContent` and safe DOM creation.
- Do not use `mode: "no-cors"`.

## Working Rules

Before editing:

- Inspect the project tree and relevant files.
- Report briefly which files will change and why.

During editing:

- Make the smallest targeted change.
- Preserve existing structure, coding style, and Thai UTF-8.
- Do not modify unrelated files.
- Do not modify Backend/PostGIS for frontend display-only work.
- Do not create duplicate implementations.
- Do not use destructive Git or database commands.

After editing:

- Show changed files and relevant Git diff.
- Report what was actually tested.
- State anything not tested.
- Do not claim tests passed unless they were run.
- Do not commit, push, deploy, delete services, or change billing without explicit approval.

## Minimum Checks

- GoogleSatellite remains the active initial basemap.
- Layer Control is not duplicated.
- No overlay GeoJSON loads initially.
- Enabling a layer loads only that file.
- Disabling a layer clears its features.
- Re-enabling does not create duplicates.
- No frontend request uses GeoServer WMS or `localhost:8080`.
- GPS, marker, point analysis, parcel drawing, and polygon analysis still work.
- No new console errors.
- Thai text remains valid UTF-8.