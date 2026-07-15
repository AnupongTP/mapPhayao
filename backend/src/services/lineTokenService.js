const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const LINE_VERIFY_TIMEOUT_MS = 10000;

function createServiceError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function verifyIdToken(idToken) {
  const channelId = String(process.env.LINE_LOGIN_CHANNEL_ID || "").trim();
  if (!channelId) {
    throw createServiceError(500, "LINE login channel is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LINE_VERIFY_TIMEOUT_MS);

  try {
    const response = await fetch(LINE_VERIFY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        id_token: idToken,
        client_id: channelId,
      }),
      signal: controller.signal,
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }

    if (!response.ok) {
      throw createServiceError(401, "Invalid LINE ID token");
    }

    const audience = payload?.aud || payload?.client_id;
    if (audience !== channelId) {
      throw createServiceError(401, "Invalid LINE ID token audience");
    }

    const userId = typeof payload?.sub === "string" ? payload.sub.trim() : "";
    if (!userId) {
      throw createServiceError(401, "Invalid LINE ID token subject");
    }

    return {
      userId,
      audience,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw createServiceError(502, "LINE verification timed out");
    }
    if (error.statusCode) {
      throw error;
    }
    throw createServiceError(502, "LINE verification service unavailable");
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  verifyIdToken,
};
