const test = require("node:test");
const assert = require("node:assert/strict");

const appUserService = require("../src/services/appUserService");

const INSERTED_USER_ID = "11111111-1111-4111-8111-111111111111";
const EXISTING_USER_ID = "22222222-2222-4222-8222-222222222222";

function createFakeClient(responses) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text, params });
      const response = responses.shift();
      if (response instanceof Error) {
        throw response;
      }
      return response || { rows: [] };
    },
  };
}

test("findOrCreateLineUser inserts a new LINE subject and returns only the app user id", async () => {
  const client = createFakeClient([
    { rows: [{ id: INSERTED_USER_ID, line_user_id: "U-line-user" }] },
  ]);

  const user = await appUserService.findOrCreateLineUser(" U-line-user ", { client });

  assert.deepEqual(user, { id: INSERTED_USER_ID });
  assert.equal(client.calls.length, 1);
  assert.match(client.calls[0].text, /INSERT INTO app\.users \(line_user_id\)/i);
  assert.match(client.calls[0].text, /ON CONFLICT \(line_user_id\) DO NOTHING/i);
  assert.match(client.calls[0].text, /RETURNING id/i);
  assert.deepEqual(client.calls[0].params, ["U-line-user"]);
  assert.equal(Object.prototype.hasOwnProperty.call(user, "line_user_id"), false);
});

test("findOrCreateLineUser resolves an existing LINE subject after an insert conflict", async () => {
  const client = createFakeClient([
    { rows: [] },
    { rows: [{ id: EXISTING_USER_ID, line_user_id: "U-line-user" }] },
  ]);

  const user = await appUserService.findOrCreateLineUser("U-line-user", { client });

  assert.deepEqual(user, { id: EXISTING_USER_ID });
  assert.equal(client.calls.length, 2);
  assert.match(client.calls[1].text, /SELECT id\s+FROM app\.users\s+WHERE line_user_id = \$1\s+LIMIT 1/is);
  assert.deepEqual(client.calls[1].params, ["U-line-user"]);
});

test("findOrCreateLineUser is safe for first-request races through ON CONFLICT", async () => {
  const clients = [
    createFakeClient([{ rows: [{ id: INSERTED_USER_ID }] }]),
    createFakeClient([{ rows: [] }, { rows: [{ id: INSERTED_USER_ID }] }]),
  ];

  const users = await Promise.all([
    appUserService.findOrCreateLineUser("U-race-user", { client: clients[0] }),
    appUserService.findOrCreateLineUser("U-race-user", { client: clients[1] }),
  ]);

  assert.deepEqual(users, [{ id: INSERTED_USER_ID }, { id: INSERTED_USER_ID }]);
  for (const client of clients) {
    assert.match(client.calls[0].text, /ON CONFLICT \(line_user_id\) DO NOTHING/i);
    assert.deepEqual(client.calls[0].params, ["U-race-user"]);
  }
});

test("findOrCreateLineUser rejects missing verified subjects before SQL", async () => {
  const client = createFakeClient([]);

  await assert.rejects(
    () => appUserService.findOrCreateLineUser("  ", { client }),
    { statusCode: 400 },
  );
  assert.equal(client.calls.length, 0);
});

test("findOrCreateLineUser SQL is parameterized and stores no LINE tokens or profile data", async () => {
  const client = createFakeClient([
    { rows: [] },
    { rows: [{ id: EXISTING_USER_ID }] },
  ]);

  await appUserService.findOrCreateLineUser("U-token-check", { client });

  const sql = client.calls.map((call) => call.text).join("\n");
  assert.equal(client.calls.every((call) => call.params.length === 1), true);
  assert.equal(client.calls.every((call) => call.params[0] === "U-token-check"), true);
  assert.doesNotMatch(sql, /\b(id_token|idtoken|access_token|refresh_token|channel_access_token|profile|display_name|picture_url|status_message)\b/i);
});
