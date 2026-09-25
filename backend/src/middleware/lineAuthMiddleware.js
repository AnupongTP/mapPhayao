const lineTokenService = require("../services/lineTokenService");

const AUTH_ERROR_MESSAGE = "LINE authentication required";

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

  return async function requireLineAuth(req, res, next) {
    const token = parseBearerToken(req.get ? req.get("authorization") : req.headers?.authorization);
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
  };
}

module.exports = {
  AUTH_ERROR_MESSAGE,
  createLineAuthMiddleware,
  _private: {
    parseBearerToken,
    getVerifiedLineUserId,
  },
};
