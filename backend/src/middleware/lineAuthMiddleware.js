const lineTokenService = require("../services/lineTokenService");
const appUserService = require("../services/appUserService");

const AUTH_ERROR_MESSAGE = "LINE authentication required";
const LOCAL_DEV_BEARER = "map-phayao-local-dev";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const LOCAL_ORIGINS = new Set(["http://localhost", "http://127.0.0.1"]);

function isLoopback(address) {
  return address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

function isLocalDevRequest(req, env) {
  const host = req.get?.("host") || "";
  const hostname = host.replace(/:\d+$/, "");
  return env.NODE_ENV === "development" && env.LOCAL_DEV_AUTH_ENABLED === "true" &&
    !env.RENDER && !env.RENDER_SERVICE_ID && LOCAL_HOSTS.has(hostname) &&
    LOCAL_ORIGINS.has(req.get?.("origin")) && isLoopback(req.socket?.remoteAddress) &&
    isLoopback(req.socket?.localAddress) && !req.get?.("x-forwarded-host") &&
    !req.get?.("x-forwarded-for") && !req.get?.("forwarded");
}

function sendAuthenticationError(res, diagnostic) {
  return res.status(401).json({
    success: false,
    error: AUTH_ERROR_MESSAGE,
    ...(diagnostic ? { stage: "REQUEST_RECEIVED", code: "AUTH_REQUIRED", requestId: diagnostic.requestId } : {}),
  });
}

function parseBearerToken(headerValue) {
  if (typeof headerValue !== "string") {
    return null;
  }

  const parts = headerValue.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
    return null;
  }

  return parts[1];
}

function getVerifiedLineUserId(verifiedToken) {
  const userId = typeof verifiedToken?.sub === "string"
    ? verifiedToken.sub.trim()
    : typeof verifiedToken?.userId === "string"
      ? verifiedToken.userId.trim()
      : "";

  return userId || null;
}

function createLineAuthMiddleware(dependencies = {}) {
  const tokenService = dependencies.lineTokenService || lineTokenService;
  const env = dependencies.localDevAuthEnv || process.env;
  const findLocalUser = dependencies.findLocalDevUser ||
    ((id) => appUserService.findExistingLocalDevUser(id));

  async function resolveLocalDevIdentity(req) {
    if (!isLocalDevRequest(req, env)) return null;
    const user = await findLocalUser(env.LOCAL_DEV_APP_USER_ID);
    if (!user?.id || !user?.lineUserId) {
      console.warn("local-dev-auth-unavailable", { reason: "configured-user-not-found" });
      return null;
    }
    return { lineUserId: user.lineUserId, displayName: "" };
  }

  async function localDevStatus(req, res) {
    try {
      const identity = await resolveLocalDevIdentity(req);
      return res.json({ enabled: Boolean(identity) });
    } catch {
      console.warn("local-dev-auth-unavailable", { reason: "user-lookup-failed" });
      return res.status(503).json({ enabled: false });
    }
  }

  async function requireLineAuth(req, res, next) {
    const token = parseBearerToken(req.get ? req.get("authorization") : req.headers?.authorization);
    if (token === LOCAL_DEV_BEARER) {
      try {
        const identity = await resolveLocalDevIdentity(req);
        if (!identity) return sendAuthenticationError(res, req.uploadDiagnostic);
        req.lineIdentity = identity;
        return next();
      } catch {
        console.warn("local-dev-auth-unavailable", { reason: "user-lookup-failed" });
        return sendAuthenticationError(res, req.uploadDiagnostic);
      }
    }
    if (!token) {
      return sendAuthenticationError(res, req.uploadDiagnostic);
    }

    try {
      const verifiedToken = await tokenService.verifyIdToken(token);
      const lineUserId = getVerifiedLineUserId(verifiedToken);
      if (!lineUserId) {
        return sendAuthenticationError(res, req.uploadDiagnostic);
      }

      req.lineIdentity = {
        lineUserId,
        displayName: typeof verifiedToken.displayName === "string"
          ? verifiedToken.displayName.trim()
          : "",
      };

      return next();
    } catch (error) {
      return sendAuthenticationError(res, req.uploadDiagnostic);
    }
  }
  requireLineAuth.localDevStatus = localDevStatus;
  return requireLineAuth;
}

module.exports = {
  AUTH_ERROR_MESSAGE,
  createLineAuthMiddleware,
  _private: {
    parseBearerToken,
    getVerifiedLineUserId,
    isLocalDevRequest,
  },
};
