"use strict";

const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const db = require("../src/config/database");
const gistdaClient = require("../src/services/gistdaClient");
const { refreshFloodDataset } = require("./floodRecurrenceAtomicRefresh");

async function main() {
  if (process.argv.includes("--dry-run")) {
    const sample = await gistdaClient.requestJson("/features/flood-freq", {
      query: { pv_idn: 56, limit: 1, offset: 0 },
      accept: "application/geo+json",
    });
    console.log(JSON.stringify({
      mode: "dry-run",
      provinceId: 56,
      numberMatched: Number(sample.body.numberMatched || 0),
      firstGeometryType: sample.body.features?.[0]?.geometry?.type || null,
      propertyFields: Object.keys(sample.body.features?.[0]?.properties || {}),
    }));
    return;
  }
  const client = await db.pool.connect();
  try {
    const result = await refreshFloodDataset({
      client,
      gistdaClient,
      allowDataReduction: process.argv.includes("--allow-data-reduction"),
    });
    console.log(JSON.stringify({
      done: true,
      generation: result.generation,
      downloaded: result.downloaded,
      staged: result.staged,
      quality: result.quality,
    }));
  } finally {
    client.release();
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ error: error.message }));
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
