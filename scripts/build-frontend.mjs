import { copyFile, mkdir, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const tailwindCli = path.join(
  projectRoot,
  "node_modules",
  "@tailwindcss",
  "cli",
  "dist",
  "index.mjs",
);
const inputCss = path.join(projectRoot, "frontend", "css", "tailwind.input.css");
const outputCss = path.join(projectRoot, "frontend", "css", "ui.generated.css");

const buildResult = spawnSync(
  process.execPath,
  [tailwindCli, "-i", inputCss, "-o", outputCss, "--minify"],
  { cwd: projectRoot, encoding: "utf8", stdio: "inherit" },
);

if (buildResult.error) {
  throw buildResult.error;
}
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const fontAwesomeRoot = path.join(
  projectRoot,
  "node_modules",
  "@fortawesome",
  "fontawesome-free",
);
const iconCssDir = path.join(projectRoot, "frontend", "vendor", "fontawesome", "css");
const iconFontDir = path.join(projectRoot, "frontend", "vendor", "fontawesome", "webfonts");
const iconVendorDir = path.join(projectRoot, "frontend", "vendor", "fontawesome");
await mkdir(iconCssDir, { recursive: true });
await mkdir(iconFontDir, { recursive: true });

await Promise.all([
  copyFile(
    path.join(fontAwesomeRoot, "css", "fontawesome.min.css"),
    path.join(iconCssDir, "fontawesome.min.css"),
  ),
  copyFile(
    path.join(fontAwesomeRoot, "css", "solid.min.css"),
    path.join(iconCssDir, "solid.min.css"),
  ),
  copyFile(
    path.join(fontAwesomeRoot, "webfonts", "fa-solid-900.woff2"),
    path.join(iconFontDir, "fa-solid-900.woff2"),
  ),
  copyFile(
    path.join(fontAwesomeRoot, "LICENSE.txt"),
    path.join(iconVendorDir, "LICENSE.txt"),
  ),
]);

const vendorRoot = path.join(projectRoot, "frontend", "vendor");
const assetCopies = [
  ["leaflet/dist/leaflet.js", "leaflet/leaflet.js"],
  ["leaflet/dist/leaflet.css", "leaflet/leaflet.css"],
  ["leaflet/LICENSE", "leaflet/LICENSE"],
  ["chart.js/dist/chart.umd.min.js", "chartjs/chart.umd.min.js"],
  ["chart.js/LICENSE.md", "chartjs/LICENSE.md"],
  ["leaflet.markercluster/dist/leaflet.markercluster.js", "leaflet-markercluster/leaflet.markercluster.js"],
  ["leaflet.markercluster/dist/MarkerCluster.css", "leaflet-markercluster/MarkerCluster.css"],
  ["leaflet.markercluster/dist/MarkerCluster.Default.css", "leaflet-markercluster/MarkerCluster.Default.css"],
  ["leaflet.markercluster/MIT-LICENCE.txt", "leaflet-markercluster/MIT-LICENCE.txt"],
];
for (const image of await readdir(path.join(projectRoot, "node_modules", "leaflet", "dist", "images"))) {
  assetCopies.push([`leaflet/dist/images/${image}`, `leaflet/images/${image}`]);
}
await Promise.all(assetCopies.map(async ([source, destination]) => {
  const target = path.join(vendorRoot, destination);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(projectRoot, "node_modules", source), target);
}));
