import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import net from "node:net";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const stateFile = path.join(root, ".sandbox", "control.json");
const controlUrl = "http://127.0.0.1:4174";
const project = `mapphayao-sandbox-${process.pid}-${randomBytes(4).toString("hex")}`;
const compose = ["compose", "-f", path.join(root, "docker-compose.e2e.yml"), "-p", project];
const expectedDb = {
  DB_HOST: "127.0.0.1",
  DB_PORT: "55432",
  DB_NAME: "mapphayao_e2e",
  DB_USER: "postgres",
  DB_PASSWORD: "postgres",
  DB_SSL: "false",
};
const serviceEnv = {
  ...process.env,
  ...expectedDb,
  NODE_ENV: "test",
  PORT: "3100",
  CORS_ORIGINS: "http://127.0.0.1:4173",
  GOOGLE_MIRROR_ENABLED: "false",
};
const migrations = [
  "/migrations/20260614_create_app_parcels.sql",
  "/e2e/bootstrap.sql",
  "/migrations/20260615_create_rice_soil_rule_framework.sql",
  "/migrations/20260716_prepare_line_user_parcel_ownership.sql",
  "/migrations/20260716_enforce_line_user_parcel_ownership.sql",
  "/migrations/20260924_create_parcel_images.sql",
];

let frontend;
let backend;
let databaseStarted = false;
let control;
let busy = false;
const controlToken = randomBytes(32).toString("hex");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, output }));
  });
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function waitForPortFree(port) {
  for (let i = 0; i < 50; i += 1) {
    if (await portIsFree(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Sandbox port ${port} did not close`);
}

async function waitFor(url) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch (error) {
      // The local service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Sandbox service did not become ready: ${url}`);
}

async function waitForPostgres() {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const logs = await capture("docker", [...compose, "logs", "--no-color", "db"]);
    if (logs.code === 0 && logs.output.includes("PostgreSQL init process complete; ready for start up.")) {
      const query = await capture("docker", [
        ...compose, "exec", "-T", "db", "psql", "-U", "postgres", "-d", "mapphayao_e2e", "-tAc", "SELECT 1",
      ]);
      if (query.code === 0 && query.output.trim() === "1") return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Disposable PostGIS did not become ready");
}

function startNode(script, args = []) {
  const child = spawn(process.execPath, [path.join(root, script), ...args], {
    cwd: root,
    env: serviceEnv,
    stdio: "inherit",
  });
  child.once("error", (error) => console.error(error));
  return child;
}

async function stopNode(child, port) {
  if (!child) return;
  if (child.exitCode === null) child.kill();
  await waitForPortFree(port);
}

async function stopServices() {
  await stopNode(frontend, 4173);
  frontend = undefined;
  await stopNode(backend, 3100);
  backend = undefined;
  if (databaseStarted) {
    await run("docker", [...compose, "down", "--volumes", "--remove-orphans"]);
    databaseStarted = false;
  }
  await waitForPortFree(55432);
}

async function startServices() {
  databaseStarted = true;
  await run("docker", [...compose, "up", "-d", "--wait"]);
  await waitForPostgres();
  for (const file of migrations) {
    await run("docker", [...compose, "exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "mapphayao_e2e", "-f", file]);
  }
  backend = startNode("scripts/e2e-backend.cjs");
  await waitFor("http://127.0.0.1:3100/api/health/database");
  frontend = startNode("scripts/e2e-static-server.mjs", ["--sandbox"]);
  await waitFor("http://127.0.0.1:4173/?liff=1&sandbox-user=a");
}

async function readState() {
  try {
    return JSON.parse(await readFile(stateFile, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function sendControl(action) {
  const state = await readState();
  if (!state) {
    if (action === "stop") {
      console.log("Manual sandbox is not running.");
      return;
    }
    throw new Error("Manual sandbox is not running; run npm run sandbox:start first");
  }
  let response;
  try {
    response = await fetch(`${controlUrl}/${action}`, {
      method: "POST",
      headers: { "X-Sandbox-Control": state.token },
      signal: AbortSignal.timeout(120000),
    });
  } catch (error) {
    throw new Error("Sandbox supervisor is unreachable; no unrelated process or Docker project was touched");
  }
  if (!response.ok) throw new Error(`Sandbox ${action} failed: ${await response.text()}`);
  console.log(await response.text());
}

async function preflight() {
  if (process.env.DATABASE_URL || process.env.NODE_ENV === "production") {
    throw new Error("Refusing production database or NODE_ENV settings");
  }
  for (const [name, expected] of Object.entries(expectedDb)) {
    if (process.env[name] && process.env[name] !== expected) {
      throw new Error(`Refusing non-sandbox ${name}`);
    }
  }
  if (await readState()) throw new Error("Sandbox state already exists; stop the existing sandbox first");
  for (const port of [4173, 3100, 55432, 4174]) {
    if (!await portIsFree(port)) throw new Error(`Sandbox port ${port} is already in use`);
  }
  await run("docker", ["info", "--format", "{{.ServerVersion}}"]).catch(() => {
    throw new Error("Docker is unavailable; the manual sandbox cannot start");
  });
}

async function startControl() {
  control = createHttpServer(async (req, res) => {
    if (req.method !== "POST" || req.headers["x-sandbox-control"] !== controlToken) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const action = req.url === "/reset" ? "reset" : req.url === "/stop" ? "stop" : null;
    if (!action) {
      res.writeHead(404).end("Not found");
      return;
    }
    if (busy) {
      res.writeHead(409).end("Sandbox operation already running");
      return;
    }
    busy = true;
    try {
      await stopServices();
      if (action === "reset") {
        await startServices();
        res.writeHead(200).end("Sandbox reset complete. User A and User B URLs are ready.");
      } else {
        await rm(stateFile, { force: true });
        res.writeHead(200).end("Sandbox stopped; its disposable database and volume were removed.");
        control.close();
      }
    } catch (error) {
      console.error(error);
      res.writeHead(500).end(error.message);
    } finally {
      busy = false;
    }
  });
  await new Promise((resolve, reject) => {
    control.once("error", reject);
    control.listen(4174, "127.0.0.1", resolve);
  });
}

async function start() {
  await preflight();
  try {
    await startServices();
    await startControl();
    await mkdir(path.dirname(stateFile), { recursive: true });
    await writeFile(stateFile, JSON.stringify({ token: controlToken, project, pid: process.pid }), { mode: 0o600 });
    console.log("Manual sandbox ready. Data persists until reset or stop.");
    console.log("User A: http://127.0.0.1:4173/?liff=1&sandbox-user=a");
    console.log("User B: http://127.0.0.1:4173/?liff=1&sandbox-user=b");
    console.log("Use npm run sandbox:reset for fresh data, or npm run sandbox:stop to clean up.");
  } catch (error) {
    control?.close();
    await stopServices();
    await rm(stateFile, { force: true });
    throw error;
  }
}

async function onSignal() {
  if (busy) return;
  busy = true;
  try {
    await stopServices();
    await rm(stateFile, { force: true });
    control?.close();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

process.on("SIGINT", () => { void onSignal(); });
process.on("SIGTERM", () => { void onSignal(); });

const command = process.argv[2];
const action = command === "start" ? start() :
  command === "stop" || command === "reset" ? sendControl(command) :
    Promise.reject(new Error("Use start, stop, or reset"));
action.catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
