import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const frontendRoot = path.join(root, "frontend");
const sandboxMode = process.argv.includes("--sandbox");
if (sandboxMode && (
  process.env.DB_HOST !== "127.0.0.1" ||
  process.env.DB_PORT !== "55432" ||
  process.env.DB_NAME !== "mapphayao_e2e" ||
  process.env.DB_SSL !== "false" ||
  process.env.DATABASE_URL
)) {
  throw new Error("Refusing to serve the manual sandbox without the local E2E database configuration");
}
const sandboxTokens = {
  a: "e2e-line-token-user-a",
  b: "e2e-line-token-user-b",
};
const blankTile = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4////fwAJ+wP+ZQmR7wAAAABJRU5ErkJggg==",
  "base64",
);
const assetRoots = {
  leaflet: path.join(root, "node_modules", "leaflet", "dist"),
  "leaflet-draw": path.join(root, "node_modules", "leaflet-draw", "dist"),
};
const cdnAssets = new Map([
  ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "/__e2e_assets/leaflet/leaflet.css"],
  ["https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "/__e2e_assets/leaflet/leaflet.js"],
  ["https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css", "/__e2e_assets/leaflet-draw/leaflet.draw.css"],
  ["https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js", "/__e2e_assets/leaflet-draw/leaflet.draw.js"],
]);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
};

function resolveLocalFile(rootDirectory, requestPath) {
  const filePath = path.resolve(rootDirectory, `.${requestPath}`);
  if (filePath !== rootDirectory && !filePath.startsWith(`${rootDirectory}${path.sep}`)) {
    return null;
  }
  return filePath;
}

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, "http://127.0.0.1");
    const pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname.includes("\0") || pathname.includes("\\")) {
      res.writeHead(400).end();
      return;
    }
    if (sandboxMode && /^\/__sandbox_tiles\/\d+\/\d+\/\d+\.png$/.test(pathname)) {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" }).end(blankTile);
      return;
    }
    const sandboxUser = requestUrl.searchParams.get("sandbox-user");
    if (sandboxMode && ["/", "/index.html"].includes(pathname) && (!Object.hasOwn(sandboxTokens, sandboxUser) || requestUrl.searchParams.get("liff") !== "1")) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
        .end("Use the printed User A or User B sandbox URL.");
      return;
    }
    const assetMatch = pathname.match(/^\/__e2e_assets\/(leaflet|leaflet-draw)(\/.*)$/);
    const directory = assetMatch ? assetRoots[assetMatch[1]] : frontendRoot;
    const relativePath = assetMatch ? assetMatch[2] : pathname === "/" ? "/index.html" : pathname;
    const filePath = resolveLocalFile(directory, relativePath);
    if (!filePath) {
      res.writeHead(403).end();
      return;
    }
    const metadata = await stat(filePath);
    if (!metadata.isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader("Content-Type", mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream");
    if (filePath === path.join(frontendRoot, "index.html")) {
      let html = await readFile(filePath, "utf8");
      for (const [remote, local] of cdnAssets) {
        html = html.replaceAll(remote, local);
      }
      html = html.replace(
        "https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap",
        "/vendor/sarabun/sarabun.css",
      );
      if (sandboxMode) {
        const token = sandboxTokens[sandboxUser];
        const label = sandboxUser === "a" ? "A" : "B";
        const bootstrap = `<script>
window.__MAP_PHAYAO_E2E_CONFIG__ = { apiBaseUrl: "http://127.0.0.1:3100/api" };
window.liff = {
  init: async () => {},
  isLoggedIn: () => true,
  isInClient: () => true,
  getIDToken: () => ${JSON.stringify(token)},
  closeWindow: () => {},
};
document.addEventListener("DOMContentLoaded", () => {
  const badge = document.createElement("div");
  badge.id = "local-sandbox-badge";
  badge.textContent = "LOCAL SANDBOX · USER ${label}";
  badge.style.cssText = "position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:10000;padding:4px 8px;background:#fff;color:#111;border:1px solid #111;font:12px Sarabun,sans-serif;pointer-events:none";
  document.body.appendChild(badge);
});
</script>`;
        html = html.replace("<head>", `<head>${bootstrap}`);
        res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:3100; img-src 'self' data: blob:; font-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Cache-Control", "no-store");
      }
      res.end(html);
      return;
    }
    if (sandboxMode && filePath === path.join(frontendRoot, "js", "layers.js")) {
      const source = await readFile(filePath, "utf8");
      res.setHeader("Cache-Control", "no-store");
      res.end(source
        .replace("https://tile.openstreetmap.org/{z}/{x}/{y}.png", "/__sandbox_tiles/{z}/{x}/{y}.png")
        .replace("https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}", "/__sandbox_tiles/{z}/{x}/{y}.png"));
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 400).end();
  }
});

server.listen(4173, "127.0.0.1", () => console.log("E2E frontend ready on 127.0.0.1:4173"));
process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());
