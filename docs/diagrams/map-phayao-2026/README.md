# Map Phayao system diagrams (2026)

These diagrams summarize the repository's committed architecture for an A4 landscape academic document. They are documentation only; they do not describe a verified production deployment.

- `01-system-framework.html` — five-phase development framework and workflow. The third phase keeps Web GIS, the public FarmTeach Dashboard, and FarmerAI as separate service branches.
- `02-system-architecture.html` — application, Google data, public Dashboard, and separately documented FarmerAI paths. Supabase/PostGIS is authoritative for users, ownership, parcel metadata, and geometry; Google Sheets is a secondary mirror; Google Drive stores private image files.
- `03-framework-reference-style.html` — portrait revision that follows the supplied `Framework.png` composition: five stacked pale-green panels, the Phase 1 2×2 infrastructure grid and large PostGIS card, the Phase 2 four-column card matrix, the layered FarmerAI section, the Phase 4 two-column list, and three Phase 5 result cards. Its matching `.svg` is a scalable export. It intentionally uses more cards than the skill's usual overview budget to preserve the requested reference layout.
- `04-framework-academic-final.html` — academic print revision of the same portrait composition. Its secondary Thai text has larger type and stronger contrast. The SVG is a standalone vector export. The HTML includes an A4 portrait print rule; actual one-page PDF output has not been rendered or verified in this environment.

Each HTML file is self-contained, with an inline accessible SVG. The `.svg` files are standalone exports. All diagrams use the locally available TH Sarabun New font stack, with Tahoma fallback. Browser/GeoJSON coordinates are EPSG:4326; stored parcel geometry is MultiPolygon EPSG:32647.

## Evidence and limits

The verified paths come from committed `frontend/index.html`, `frontend/dashboard.html`, `frontend/js/dashboard.js`, `backend/src/server.js`, `backend/src/routes/`, `backend/src/services/googleParcelIntegration.js`, `dashboardSheetService.js`, `serviceAccountDriveRead.js`, and parcel services. The current checkout contains uncommitted changes; these were not treated as deployed behavior.

The backend supports configurable Drive read providers. The diagrams show the Service Account / Drive API read path requested for the current architecture, but repository inspection alone does not verify the active Render configuration. FarmerAI, Hermes Gateway, Azure VM, Cloudflare Tunnel, and model runtime were not found in this repository; the FarmerAI branch is therefore labeled as a separate subsystem, and the old image's infrastructure details remain unverified. The diagrams deliberately omit upload retry mechanics, cleanup queue operations, weather transport, and individual GIS overlays to keep the system-level relationships legible.

The public Dashboard uses a normalized Sheet snapshot and protected image route. Public parcel responses do not carry raw Drive IDs or `LinkImage` values.

The portrait revision labels historical FarmerAI infrastructure and AI steps as unverified. Its HTML and SVG passed static format checks, but a browser render and PNG export were not performed because local-page access was blocked by the browser security policy in this task.

## Claim status in the academic revision

These statuses describe committed source code, not verified production runtime:

| Function | Status and evidence |
|---|---|
| Point/location analysis | Implemented in `riceSuitabilityService.js` and `locationReportService.js`; depends on the GIS tables populated in the target database. The report can return partial errors for unavailable hazard, suitability, or weather sources. |
| Parcel analysis | Implemented in `areaAnalysisService.js`, including area, representative point, administrative intersections, rice/maize potential overlays, soil summary, hazard history, and weather. Results depend on GIS tables and providers. |
| Soil suitability rules | Conditional: `soilSuitabilityEvaluator.js` evaluates only active, verified rule sets. It returns `NO_RULE`, `RULE_SET_INACTIVE`, `NO_DATA`, or `PARTIAL_DATA` when evaluation is unavailable. A soil data display is not proof of an evaluated suitability class. |
| Rice and maize potential | Spatial overlay code exists for `gis.rice_potential` and `gis.maize_potential`. A result requires the relevant database layers and coverage. |
| Flood and drought history | GISTDA-backed services are called by point and parcel analysis. Data availability and provider responses determine whether a result can be shown. Parcel drought history is a tambon-level summary, not a within-parcel drought boundary. |
| Weather | `weatherService.js` can return `AVAILABLE`, `UNAVAILABLE`, or `OUTSIDE_SERVICE_AREA`; availability depends on configuration and the upstream provider. |
| Public Dashboard statistics | `dashboardSheetService.js` builds read-only counts and daily series from the Google Sheet snapshot. It requires the Sheets integration and source rows; it does not confirm a deployed Dashboard. |
| FarmerAI messaging and image analysis | Historical/reference only in this repository. No current runtime, tunnel, VM, Hermes configuration, model provider, or integration with the Map Phayao Dashboard was verified. |

In the diagram, `*` means the result depends on configured data or external services. `†` marks FarmerAI information carried from the supplied reference. The older reference's Cloudflare Tunnel, Azure VM, Hermes, model, and image processing details are not asserted as current production architecture. The current HTML/SVG preserve the reference layout; visual Thai rendering and PNG/PDF export still require manual review because the browser security restriction blocks local rendering here.

For manual print review, open `04-framework-academic-final.html` in your own browser and use Print → Save as PDF with A4 portrait and background graphics enabled. Confirm one page and inspect Thai marks at 100%. For a PNG, open `04-framework-academic-final.svg` in a trusted vector editor and export a 2480 × 3508 px A4 portrait canvas while preserving the artwork's aspect ratio; inspect the resulting Thai text before publication. These are manual instructions, not verified exports.
