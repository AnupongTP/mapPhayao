import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const composeFile = path.join(root, "docker-compose.e2e.yml");
const project = `mapphayao-e2e-${process.pid}`;
const compose = ["compose", "-f", composeFile, "-p", project];
const dbEnv = {
  ...process.env,
  NODE_ENV: "test",
  DB_HOST: "127.0.0.1",
  DB_PORT: "55432",
  DB_NAME: "mapphayao_e2e",
  DB_USER: "postgres",
  DB_PASSWORD: "postgres",
  DB_SSL: "false",
  PORT: "3100",
  CORS_ORIGINS: "http://127.0.0.1:4173",
  GOOGLE_MIRROR_ENABLED: "false",
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
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

async function waitForFinalPostgres() {
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
  throw new Error("Final PostGIS server did not become ready");
}

async function waitFor(url) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch (error) {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Service did not become ready: ${url}`);
}

function startNode(script) {
  const child = spawn(process.execPath, [path.join(root, script)], {
    cwd: root,
    env: dbEnv,
    stdio: "inherit",
  });
  child.once("error", (error) => console.error(error));
  child.once("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`${script} exited ${code}`);
  });
  return child;
}

async function main() {
  if (
    (process.env.DB_HOST && !["127.0.0.1", "localhost"].includes(process.env.DB_HOST)) ||
    (process.env.DB_PORT && process.env.DB_PORT !== "55432") ||
    (process.env.DB_NAME && process.env.DB_NAME !== "mapphayao_e2e") ||
    process.env.DATABASE_URL
  ) {
    throw new Error("Refusing to run E2E against a non-local database");
  }
  for (const port of [4173, 3100, 55432]) {
    if (!await portIsFree(port)) throw new Error(`E2E port ${port} is already in use`);
  }
  await run("docker", ["info", "--format", "{{.ServerVersion}}"]).catch(() => {
    throw new Error("Docker is unavailable; local PostGIS E2E is blocked");
  });

  let databaseStarted = false;
  let backend;
  let frontend;
  try {
    databaseStarted = true;
    await run("docker", [...compose, "up", "-d", "--wait"]);
    await waitForFinalPostgres();
    const sqlFiles = [
      "/migrations/20260614_create_app_parcels.sql",
      "/e2e/bootstrap.sql",
      "/migrations/20260615_create_rice_soil_rule_framework.sql",
      "/migrations/20260716_prepare_line_user_parcel_ownership.sql",
      "/migrations/20260716_enforce_line_user_parcel_ownership.sql",
      "/migrations/20260924_create_parcel_images.sql",
    ];
    for (const file of sqlFiles) {
      await run("docker", [...compose, "exec", "-T", "db", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "mapphayao_e2e", "-f", file]);
    }
    console.log("E2E database bootstrap complete");
    backend = startNode("scripts/e2e-backend.cjs");
    await waitFor("http://127.0.0.1:3100/api/health/database");
    frontend = startNode("scripts/e2e-static-server.mjs");
    await waitFor("http://127.0.0.1:4173/");
    const cli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
    const playwrightArgs = process.argv.slice(2);
    await run(process.execPath, [cli, "test", ...playwrightArgs], {
      env: { ...dbEnv, E2E_HEADED_MODE: playwrightArgs.includes("--headed") ? "1" : "0" },
    });
  } finally {
    frontend?.kill();
    backend?.kill();
    if (databaseStarted) {
      if (process.env.E2E_KEEP_DB === "1") {
        console.log(`Retained local E2E Docker project: ${project}`);
      } else {
        await run("docker", [...compose, "down", "--volumes", "--remove-orphans"]);
      }
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
