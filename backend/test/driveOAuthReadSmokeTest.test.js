const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable } = require("node:stream");
const { run } = require("../scripts/driveOAuthReadSmokeTest");

const env = {
  GOOGLE_DRIVE_OAUTH_CLIENT_ID: "secret-client-id",
  GOOGLE_DRIVE_OAUTH_CLIENT_SECRET: "secret-client-secret",
  GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN: "secret-refresh-token",
  GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID: "secret-folder-id",
};

function harness({ tokenError, folderError, files } = {}) {
  const calls = [];
  const output = [];
  const stream = Readable.from([Buffer.from("abc"), Buffer.from("def")]);
  class OAuth2 {
    constructor(clientId, clientSecret) {
      assert.equal(clientId, env.GOOGLE_DRIVE_OAUTH_CLIENT_ID);
      assert.equal(clientSecret, env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET);
    }
    setCredentials(credentials) {
      assert.equal(credentials.refresh_token, env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN);
    }
    async getAccessToken() {
      calls.push("token refresh");
      if (tokenError) throw tokenError;
      return { token: "secret-access-token" };
    }
  }
  const drive = {
    about: { async get(params) {
      calls.push("about.get");
      assert.deepEqual(params, { fields: "kind" });
      return { data: { kind: "drive#about" } };
    } },
    files: {
      async get(params, options) {
        if (params.fileId === env.GOOGLE_DRIVE_PARCEL_IMAGE_FOLDER_ID) {
          calls.push("files.get(folder)");
          assert.equal(params.fields, "id,name,mimeType");
          if (folderError) throw folderError;
          return { data: { mimeType: "application/vnd.google-apps.folder" } };
        }
        if (params.alt === "media") {
          calls.push("files.get(media)");
          assert.equal(params.fileId, "private-image-id");
          assert.deepEqual(options, { responseType: "stream" });
          return { data: stream };
        }
        calls.push("files.get(metadata)");
        assert.deepEqual(params, { fileId: "private-image-id", fields: "id,name,mimeType,size" });
        return { data: { id: "private-image-id", mimeType: "image/webp", size: "6" } };
      },
      async list(params) {
        calls.push("files.list");
        assert.deepEqual(params, {
          q: "'secret-folder-id' in parents and trashed = false",
          pageSize: 5,
          fields: "files(id,name,mimeType,size)",
        });
        return { data: { files: files ?? [
          { id: "private-image-id", name: "photo.webp", mimeType: "image/webp", size: "6" },
        ] } };
      },
    },
  };
  const google = { auth: { OAuth2 }, drive(options) {
    calls.push("drive client");
    assert.equal(options.version, "v3");
    assert.ok(options.auth instanceof OAuth2);
    return drive;
  } };
  return { google, calls, output, stream, log: (line) => output.push(line) };
}

test("read-only OAuth smoke test refreshes, lists at most five, and closes the image stream", async () => {
  const fake = harness();
  assert.equal(await run({ env, google: fake.google, log: fake.log }), 0);
  assert.deepEqual(fake.calls, ["token refresh", "drive client", "about.get",
    "files.get(folder)", "files.list", "files.get(metadata)", "files.get(media)"]);
  assert.deepEqual(fake.output, ["PASS OAuth authentication", "PASS Drive API", "PASS folder access",
    "PASS image found", "PASS metadata read", "PASS binary stream read (bytesRead: 3)"]);
  assert.equal(fake.stream.destroyed, true);
  assert.doesNotMatch(fake.output.join("\n"),
    /secret-|private-image-id|photo\.webp|authorization|Bearer|abc|def/i);
});

test("missing OAuth environment fails without constructing a Google client", async () => {
  const fake = harness();
  assert.equal(await run({ env: {}, google: fake.google, log: fake.log }), 1);
  assert.deepEqual(fake.output, ["FAIL oauth_config"]);
  assert.deepEqual(fake.calls, []);
});

test("invalid_grant and folder permission errors are sanitized", async () => {
  const invalid = harness({ tokenError: Object.assign(new Error("secret-refresh-token"), {
    response: { data: { error: "invalid_grant", secret: env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET } },
  }) });
  assert.equal(await run({ env, google: invalid.google, log: invalid.log }), 1);
  assert.deepEqual(invalid.output, ["FAIL invalid_grant"]);

  const denied = harness({ folderError: Object.assign(new Error("secret-folder-id"), {
    response: { status: 403, data: { secret: env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN } },
  }) });
  assert.equal(await run({ env, google: denied.google, log: denied.log }), 1);
  assert.deepEqual(denied.output, ["PASS OAuth authentication", "PASS Drive API", "FAIL permission_denied"]);
  assert.doesNotMatch([...invalid.output, ...denied.output].join("\n"), /secret-|private-image-id/);
});

test("an empty first page reports no image without attempting file or media reads", async () => {
  const fake = harness({ files: [] });
  assert.equal(await run({ env, google: fake.google, log: fake.log }), 1);
  assert.equal(fake.output.at(-1), "FAIL no_image");
  assert.deepEqual(fake.calls.slice(-2), ["files.get(folder)", "files.list"]);
});
