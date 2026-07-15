const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const DEFAULT_TIMEOUT_MS = 8000;

const ERROR_STATUS_CODES = {
  CONFIGURATION_ERROR: 503,
  INVALID_RECIPIENT: 400,
  INVALID_MESSAGE: 400,
  LINE_BAD_REQUEST: 502,
  LINE_UNAUTHORIZED: 502,
  LINE_FORBIDDEN: 502,
  LINE_RATE_LIMITED: 503,
  LINE_UPSTREAM_ERROR: 502,
  LINE_TIMEOUT: 502,
  LINE_NETWORK_ERROR: 502,
};

function createLineMessagingError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = ERROR_STATUS_CODES[code] || 502;
  return error;
}

function getChannelAccessToken() {
  return String(process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();
}

function validateChannelAccessToken(token) {
  if (!token) {
    throw createLineMessagingError(
      "CONFIGURATION_ERROR",
      "LINE messaging is not configured",
    );
  }
}

function validateRecipient(userId) {
  if (typeof userId !== "string" || !userId.trim()) {
    throw createLineMessagingError(
      "INVALID_RECIPIENT",
      "LINE recipient is invalid",
    );
  }
}

function validateFlexMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw createLineMessagingError("INVALID_MESSAGE", "LINE message is invalid");
  }
  if (message.type !== "flex") {
    throw createLineMessagingError("INVALID_MESSAGE", "LINE message must be a Flex message");
  }
  if (typeof message.altText !== "string" || !message.altText.trim()) {
    throw createLineMessagingError("INVALID_MESSAGE", "LINE Flex message altText is required");
  }
  if (!message.contents || typeof message.contents !== "object" || Array.isArray(message.contents)) {
    throw createLineMessagingError("INVALID_MESSAGE", "LINE Flex message contents are required");
  }
}

function mapLineStatus(status) {
  if (status === 400) {
    return "LINE_BAD_REQUEST";
  }
  if (status === 401) {
    return "LINE_UNAUTHORIZED";
  }
  if (status === 403) {
    return "LINE_FORBIDDEN";
  }
  if (status === 429) {
    return "LINE_RATE_LIMITED";
  }
  return "LINE_UPSTREAM_ERROR";
}

async function pushMessage(userId, message, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const setTimeoutImpl = options.setTimeoutImpl || setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;
  const AbortControllerImpl = options.AbortControllerImpl || AbortController;
  const channelAccessToken = typeof options.getChannelAccessToken === "function"
    ? String(options.getChannelAccessToken() || "").trim()
    : String(options.channelAccessToken || getChannelAccessToken()).trim();

  validateChannelAccessToken(channelAccessToken);
  validateRecipient(userId);
  validateFlexMessage(message);

  const controller = new AbortControllerImpl();
  const timeoutId = setTimeoutImpl(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(LINE_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        to: userId.trim(),
        messages: [message],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const code = mapLineStatus(response.status);
      throw createLineMessagingError(code, "LINE messaging service returned an error");
    }

    return {
      ok: true,
      status: "SENT",
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw createLineMessagingError("LINE_TIMEOUT", "LINE messaging request timed out");
    }
    if (error.code && ERROR_STATUS_CODES[error.code]) {
      throw error;
    }
    throw createLineMessagingError("LINE_NETWORK_ERROR", "LINE messaging service is unavailable");
  } finally {
    clearTimeoutImpl(timeoutId);
  }
}

module.exports = {
  LINE_PUSH_URL,
  DEFAULT_TIMEOUT_MS,
  createLineMessagingError,
  pushMessage,
};
