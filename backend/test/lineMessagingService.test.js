const test = require("node:test");
const assert = require("node:assert/strict");

const lineMessagingService = require("../src/services/lineMessagingService");

const FAKE_TOKEN = "test-channel-access-token";
const FAKE_USER_ID = "U00000000000000000000000000000000";
const LONG_DETAIL_URL =
  "https://dishes-prefix-revised-whom.trycloudflare.com/mapphayao1/frontend/index.html?lat=19.039846300072156&lng=99.94005686022584";

function createFlexMessage(overrides = {}) {
  return {
    type: "flex",
    altText: "ผลความเหมาะสมพื้นที่ ต.แม่กา อ.เมืองพะเยา: ข้าว S1, ข้าวโพด S2",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [],
      },
    },
    ...overrides,
  };
}

function createResponse(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
  };
}

function createFlexMessageWithDetailUri(uri) {
  return createFlexMessage({
    contents: {
      type: "bubble",
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            action: {
              type: "uri",
              label: "ดูรายละเอียดพื้นที่",
              uri,
            },
          },
        ],
      },
    },
  });
}

function collectUriActions(value) {
  const actions = [];
  const visit = (item) => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") {
      return;
    }
    if (item.action && item.action.type === "uri") {
      actions.push(item.action);
    }
    Object.values(item).forEach(visit);
  };

  visit(value);
  return actions;
}

async function assertRejectsWithCode(fn, code) {
  await assert.rejects(
    fn,
    (error) => {
      assert.equal(error.code, code);
      assert.equal(String(error.message).includes(FAKE_TOKEN), false);
      assert.equal(String(error.message).includes("Authorization"), false);
      assert.equal(String(error.message).includes(FAKE_USER_ID), false);
      return true;
    },
  );
}

test("pushMessage sends one unchanged Flex message to the official LINE push endpoint", async () => {
  const flexMessage = createFlexMessage();
  const before = JSON.parse(JSON.stringify(flexMessage));
  const calls = [];

  const result = await lineMessagingService.pushMessage(FAKE_USER_ID, flexMessage, {
    channelAccessToken: FAKE_TOKEN,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return createResponse(200);
    },
  });

  assert.deepEqual(result, { ok: true, status: "SENT" });
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].url), lineMessagingService.LINE_PUSH_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${FAKE_TOKEN}`);

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.to, FAKE_USER_ID);
  assert.equal(body.messages.length, 1);
  assert.deepEqual(body.messages[0], flexMessage);
  assert.deepEqual(flexMessage, before);
});

test("pushMessage serializes long Flex detail URI without truncation", async () => {
  const flexMessage = createFlexMessageWithDetailUri(LONG_DETAIL_URL);
  const calls = [];

  const result = await lineMessagingService.pushMessage(FAKE_USER_ID, flexMessage, {
    channelAccessToken: FAKE_TOKEN,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return createResponse(200);
    },
  });

  assert.deepEqual(result, { ok: true, status: "SENT" });
  assert.equal(calls.length, 1);

  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.messages.length, 1);
  const detailActions = collectUriActions(body.messages[0])
    .filter((action) => action.label === "ดูรายละเอียดพื้นที่");
  assert.equal(detailActions.length, 1);
  assert.equal(detailActions[0].uri, LONG_DETAIL_URL);
  assert.equal(detailActions[0].uri.includes("..."), false);
  assert.equal(detailActions[0].uri.includes("lng=99.94005686022584"), true);
});

test("pushMessage rejects missing or empty channel access token", async () => {
  await assertRejectsWithCode(
    () => lineMessagingService.pushMessage(FAKE_USER_ID, createFlexMessage(), {
      getChannelAccessToken: () => "",
      fetchImpl: async () => { throw new Error("network should not run"); },
    }),
    "CONFIGURATION_ERROR",
  );
  await assertRejectsWithCode(
    () => lineMessagingService.pushMessage(FAKE_USER_ID, createFlexMessage(), {
      channelAccessToken: "   ",
      fetchImpl: async () => { throw new Error("network should not run"); },
    }),
    "CONFIGURATION_ERROR",
  );
});

test("pushMessage validates recipient and Flex message shape before network access", async () => {
  const fetchImpl = async () => {
    throw new Error("network should not run");
  };
  const validOptions = { channelAccessToken: FAKE_TOKEN, fetchImpl };

  await assertRejectsWithCode(
    () => lineMessagingService.pushMessage(null, createFlexMessage(), validOptions),
    "INVALID_RECIPIENT",
  );
  await assertRejectsWithCode(
    () => lineMessagingService.pushMessage("   ", createFlexMessage(), validOptions),
    "INVALID_RECIPIENT",
  );
  await assertRejectsWithCode(
    () => lineMessagingService.pushMessage(FAKE_USER_ID, null, validOptions),
    "INVALID_MESSAGE",
  );
  await assertRejectsWithCode(
    () => lineMessagingService.pushMessage(FAKE_USER_ID, "not-object", validOptions),
    "INVALID_MESSAGE",
  );
  await assertRejectsWithCode(
    () => lineMessagingService.pushMessage(FAKE_USER_ID, { type: "text", text: "hi" }, validOptions),
    "INVALID_MESSAGE",
  );
  await assertRejectsWithCode(
    () => lineMessagingService.pushMessage(FAKE_USER_ID, createFlexMessage({ altText: "" }), validOptions),
    "INVALID_MESSAGE",
  );
  await assertRejectsWithCode(
    () => lineMessagingService.pushMessage(FAKE_USER_ID, createFlexMessage({ contents: null }), validOptions),
    "INVALID_MESSAGE",
  );
});

test("pushMessage maps LINE non-success statuses to sanitized internal codes", async () => {
  const cases = [
    [400, "LINE_BAD_REQUEST"],
    [401, "LINE_UNAUTHORIZED"],
    [403, "LINE_FORBIDDEN"],
    [429, "LINE_RATE_LIMITED"],
    [500, "LINE_UPSTREAM_ERROR"],
    [418, "LINE_UPSTREAM_ERROR"],
  ];

  for (const [status, code] of cases) {
    let calls = 0;
    await assertRejectsWithCode(
      () => lineMessagingService.pushMessage(FAKE_USER_ID, createFlexMessage(), {
        channelAccessToken: FAKE_TOKEN,
        fetchImpl: async () => {
          calls += 1;
          return createResponse(status);
        },
      }),
      code,
    );
    assert.equal(calls, 1);
  }
});

test("pushMessage maps network failures and timeouts without retrying", async () => {
  let networkCalls = 0;
  await assertRejectsWithCode(
    () => lineMessagingService.pushMessage(FAKE_USER_ID, createFlexMessage(), {
      channelAccessToken: FAKE_TOKEN,
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("network down");
      },
    }),
    "LINE_NETWORK_ERROR",
  );
  assert.equal(networkCalls, 1);

  let timeoutCalls = 0;
  let clearedTimeout = null;
  await assertRejectsWithCode(
    () => lineMessagingService.pushMessage(FAKE_USER_ID, createFlexMessage(), {
      channelAccessToken: FAKE_TOKEN,
      timeoutMs: 1,
      setTimeoutImpl: (callback) => {
        callback();
        return "timeout-handle";
      },
      clearTimeoutImpl: (handle) => {
        clearedTimeout = handle;
      },
      fetchImpl: async (url, options) => {
        timeoutCalls += 1;
        if (options.signal.aborted) {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        throw new Error("expected aborted signal");
      },
    }),
    "LINE_TIMEOUT",
  );
  assert.equal(timeoutCalls, 1);
  assert.equal(clearedTimeout, "timeout-handle");
});

test("pushMessage tests use injected fetch and fake credentials only", async () => {
  let usedInjectedFetch = false;
  const result = await lineMessagingService.pushMessage(FAKE_USER_ID, createFlexMessage(), {
    channelAccessToken: FAKE_TOKEN,
    fetchImpl: async () => {
      usedInjectedFetch = true;
      return createResponse(200);
    },
  });

  assert.equal(usedInjectedFetch, true);
  assert.equal(result.status, "SENT");
});
