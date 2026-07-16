const db = require("../config/database");
const createHttpError = require("../utils/httpError");

function normalizeLineUserId(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function mapAppUserRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
  };
}

async function findOrCreateLineUser(lineUserId, options = {}) {
  const normalizedLineUserId = normalizeLineUserId(lineUserId);
  if (!normalizedLineUserId) {
    throw createHttpError(400, "Verified LINE user is required");
  }

  const queryRunner = options.client || db;

  const inserted = await queryRunner.query(
    `
    INSERT INTO app.users (line_user_id)
    VALUES ($1)
    ON CONFLICT (line_user_id) DO NOTHING
    RETURNING id;
    `,
    [normalizedLineUserId],
  );

  const insertedUser = mapAppUserRow(inserted.rows[0]);
  if (insertedUser) {
    return insertedUser;
  }

  const existing = await queryRunner.query(
    `
    SELECT id
    FROM app.users
    WHERE line_user_id = $1
    LIMIT 1;
    `,
    [normalizedLineUserId],
  );

  const existingUser = mapAppUserRow(existing.rows[0]);
  if (!existingUser) {
    throw createHttpError(500, "Unable to resolve application user");
  }

  return existingUser;
}

module.exports = {
  findOrCreateLineUser,
  _private: {
    normalizeLineUserId,
    mapAppUserRow,
  },
};
