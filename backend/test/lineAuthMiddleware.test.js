const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AUTH_ERROR_MESSAGE,
  createLineAuthMiddleware,
  _private,
} = require("../src/middleware/lineAuthMiddleware");

function createMockResponse() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function runMiddleware({ authorization, tokenService }) {
  const headers = {};
  if (authorization !== undefined) {
    headers.authorization = authorization;
  }

  const req = {
    headers,
    get(name) {
      return headers[String(name).toLowerCase()];
    },
  };
  const res = createMockResponse();
  let nextCalls = 0;
  let nextError = null;
  const middleware = createLineAuthMiddleware({ lineTokenService: tokenService });

  await middleware(req, res, (error) => {
    nextCalls += 1;
    nextError = error || null;
  });

  return { req, res, nextCalls, nextError };
}

test("LINE auth middleware rejects missing or malformed bearer tokens with one sanitized response", async () => {
  const tokenService = {
    verifyIdToken: async () => {
      throw new Error("token service should not be called");
    },
  };

  for (const authorization of [
    undefined,
    "",
    "Bearer",
    "Bearer ",
    "Basic id-token",
    "bearer id-token",
    "Bearer one two",
  ]) {
    const { res, nextCalls } = await runMiddleware({ authorization, tokenService });

    assert.equal(nextCalls, 0);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
      success: false,
      error: AUTH_ERROR_MESSAGE,
    });
  }
});

test("LINE auth middleware attaches only the verified LINE subject from token verification", async () => {
  const calls = [];
  const tokenService = {
    verifyIdToken: async (idToken) => {
      calls.push(idToken);
      return {
        sub: " verified-line-subject ",
        audience: "channel-id",
        idToken: "should-not-be-copied",
        profile: { displayName: "should-not-be-copied" },
      };
    },
  };

  const { req, res, nextCalls, nextError } = await runMiddleware({
    authorization: "Bearer signed-id-token",
    tokenService,
  });

  assert.deepEqual(calls, ["signed-id-token"]);
  assert.equal(res.statusCode, null);
  assert.equal(nextCalls, 1);
  assert.equal(nextError, null);
  assert.deepEqual(req.lineIdentity, { lineUserId: "verified-line-subject" });
  assert.equal(JSON.stringify(req.lineIdentity).includes("signed-id-token"), false);
  assert.equal(JSON.stringify(req.lineIdentity).includes("should-not-be-copied"), false);
});

test("LINE auth middleware accepts existing verified userId adapter output without copying token data", async () => {
  const tokenService = {
    verifyIdToken: async () => ({ userId: "verified-line-user", audience: "channel-id" }),
  };

  const { req, nextCalls } = await runMiddleware({
    authorization: "Bearer signed-id-token",
    tokenService,
  });

  assert.equal(nextCalls, 1);
  assert.deepEqual(req.lineIdentity, { lineUserId: "verified-line-user" });
});

test("LINE auth middleware sanitizes invalid, expired, and missing-subject token results", async () => {
  const cases = [
    async () => {
      const error = new Error("Invalid LINE ID token signed-id-token");
      error.statusCode = 401;
      error.rawResponse = "{\"error\":\"secret upstream body\"}";
      throw error;
    },
    async () => {
      const error = new Error("Expired token");
      error.statusCode = 401;
      throw error;
    },
    async () => ({ sub: "" }),
    async () => ({ profile: { displayName: "No subject" } }),
  ];

  for (const verifyIdToken of cases) {
    const { res, nextCalls } = await runMiddleware({
      authorization: "Bearer signed-id-token",
      tokenService: { verifyIdToken },
    });

    assert.equal(nextCalls, 0);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
      success: false,
      error: AUTH_ERROR_MESSAGE,
    });
    assert.equal(JSON.stringify(res.body).includes("signed-id-token"), false);
    assert.equal(JSON.stringify(res.body).includes("secret upstream body"), false);
    assert.equal(JSON.stringify(res.body).includes("Expired token"), false);
  }
});

test("LINE auth middleware does not log tokens, LINE subjects, or upstream error bodies", async () => {
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const entries = [];

  console.log = (...args) => entries.push(["log", args]);
  console.info = (...args) => entries.push(["info", args]);
  console.warn = (...args) => entries.push(["warn", args]);
  console.error = (...args) => entries.push(["error", args]);

  try {
    await runMiddleware({
      authorization: "Bearer signed-id-token",
      tokenService: {
        verifyIdToken: async () => ({ sub: "verified-line-subject" }),
      },
    });
    await runMiddleware({
      authorization: "Bearer bad-id-token",
      tokenService: {
        verifyIdToken: async () => {
          const error = new Error("bad-id-token upstream body verified-line-subject");
          error.statusCode = 401;
          error.rawResponse = "upstream secret";
          throw error;
        },
      },
    });
  } finally {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }

  assert.deepEqual(entries, []);
});

test("LINE auth middleware parser keeps bearer handling narrow and predictable", () => {
  assert.equal(_private.parseBearerToken("Bearer token"), "token");
  assert.equal(_private.parseBearerToken(" Bearer token "), "token");
  assert.equal(_private.parseBearerToken("Bearer token extra"), null);
  assert.equal(_private.parseBearerToken("bearer token"), null);
  assert.equal(_private.getVerifiedLineUserId({ sub: " U1 " }), "U1");
  assert.equal(_private.getVerifiedLineUserId({ userId: " U2 " }), "U2");
  assert.equal(_private.getVerifiedLineUserId({ sub: "" }), null);
});
