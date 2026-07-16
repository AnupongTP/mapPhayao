(function (window, document) {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get("liff") === "1";
  const sdkUrl = "https://static.line-scdn.net/liff/edge/2/sdk.js";

  let initialized = false;
  let initializing = null;
  let idToken = "";
  let errorMessage = "";
  const authUnavailableMessage = "กรุณาเปิดระบบผ่าน LINE ใหม่อีกครั้ง";

  function createAuthError(message) {
    const error = new Error(message || authUnavailableMessage);
    error.statusCode = 401;
    error.code = "LIFF_AUTH_REQUIRED";
    return error;
  }

  function loadLiffSdk() {
    if (window.liff) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${sdkUrl}"]`);
      if (existingScript) {
        existingScript.addEventListener("load", resolve, { once: true });
        existingScript.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = sdkUrl;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function initialize() {
    if (!enabled) {
      return false;
    }

    if (initialized) {
      return true;
    }

    if (initializing) {
      return initializing;
    }

    initializing = (async () => {
      const liffId = window.LiffConfig && window.LiffConfig.liffId;
      if (!liffId) {
        errorMessage = "ยังไม่ได้ตั้งค่า LIFF ID";
        throw new Error(errorMessage);
      }

      try {
        await loadLiffSdk();
        if (!window.liff) {
          throw new Error("LIFF SDK ไม่พร้อมใช้งาน");
        }

        await window.liff.init({ liffId });
        if (typeof window.liff.isLoggedIn === "function" && !window.liff.isLoggedIn()) {
          errorMessage = authUnavailableMessage;
          throw createAuthError();
        }
        idToken = window.liff.getIDToken() || "";
        if (!idToken) {
          errorMessage = "กรุณาเปิดหน้านี้ผ่านแอป LINE แล้วลองใหม่อีกครั้ง";
          errorMessage = authUnavailableMessage;
          throw createAuthError();
        }

        initialized = true;
        errorMessage = "";
        return true;
      } catch (error) {
        idToken = "";
        initialized = false;
        errorMessage =
          errorMessage ||
          error.message ||
          "ไม่สามารถเริ่มต้น LIFF ได้ กรุณาปิดแล้วเปิดใหม่";
        throw error;
      } finally {
        initializing = null;
      }
    })();

    return initializing;
  }

  function isInClient() {
    try {
      return Boolean(
        window.liff &&
          typeof window.liff.isInClient === "function" &&
          window.liff.isInClient(),
      );
    } catch (error) {
      return false;
    }
  }

  function isLoggedIn() {
    try {
      return Boolean(
        window.liff &&
          typeof window.liff.isLoggedIn === "function" &&
          window.liff.isLoggedIn(),
      );
    } catch (error) {
      return false;
    }
  }

  async function getCurrentIdToken() {
    if (!enabled) {
      throw createAuthError();
    }

    await initialize();

    if (window.liff && typeof window.liff.isLoggedIn === "function" && !isLoggedIn()) {
      idToken = "";
      errorMessage = authUnavailableMessage;
      throw createAuthError();
    }

    const currentToken =
      window.liff && typeof window.liff.getIDToken === "function"
        ? window.liff.getIDToken() || ""
        : idToken;

    if (!currentToken) {
      idToken = "";
      errorMessage = authUnavailableMessage;
      throw createAuthError();
    }

    idToken = currentToken;
    errorMessage = "";
    return currentToken;
  }

  function closeWindow() {
    try {
      if (window.liff && typeof window.liff.closeWindow === "function") {
        window.liff.closeWindow();
        return true;
      }
    } catch (error) {
      return false;
    }

    return false;
  }

  window.MapLiffMode = {
    isEnabled: function () {
      return enabled;
    },
    initialize,
    isReady: function () {
      return enabled && initialized && Boolean(idToken);
    },
    getIdToken: function () {
      return idToken;
    },
    getCurrentIdToken,
    isInClient,
    isLoggedIn,
    closeWindow,
    getErrorMessage: function () {
      return errorMessage;
    },
  };
})(window, document);
