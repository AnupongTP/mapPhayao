const GISTDA_BASE_URL = "https://api-gateway.gistda.or.th/api/2.0/resources";
const DEFAULT_TIMEOUT_MS = 10000;

function createGistdaError(code, message, statusCode) {
  const error = new Error(message);
  error.code = code;
  if (statusCode) {
    error.statusCode = statusCode;
  }
  return error;
}

function getApiKey() {
  const apiKey = String(process.env.GISTDA_API_KEY || "").trim();
  if (!apiKey) {
    throw createGistdaError("MISSING_API_KEY", "GISTDA API key is not configured");
  }
  return apiKey;
}

function buildUrl(path, query) {
  const url = new URL(`${GISTDA_BASE_URL}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }
  return url;
}

async function requestJson(path, options = {}) {
  const {
    query,
    accept = "application/json",
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(buildUrl(path, query), {
      method: "GET",
      headers: {
        Accept: accept,
        "API-Key": getApiKey(),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch (error) {
      throw createGistdaError("INVALID_JSON", "GISTDA response was not valid JSON");
    }

    if (!response.ok) {
      throw createGistdaError(
        `UPSTREAM_${response.status}`,
        "GISTDA service returned an error",
        response.status,
      );
    }

    return {
      body,
      contentType: response.headers && response.headers.get
        ? response.headers.get("content-type")
        : null,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw createGistdaError("UPSTREAM_TIMEOUT", "GISTDA request timed out");
    }
    if (error.code) {
      throw error;
    }
    throw createGistdaError("UPSTREAM_NETWORK_ERROR", "GISTDA service is unavailable");
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  GISTDA_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  createGistdaError,
  requestJson,
};
