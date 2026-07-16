(function (window, document) {
  const EXPECTED_LIFF_ID = "2010690813-INkgQOS1";
  const EXPECTED_LIFF_URL = "https://liff.line.me/2010690813-INkgQOS1";
  const WITH_LOGIN_ON_EXTERNAL_BROWSER = true;
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get("liff") === "1";
  const debugEnabled = params.get("liffDebug") === "1";
  const sdkUrl = "https://static.line-scdn.net/liff/edge/2/sdk.js";
  const authUnavailableMessage =
    "กรุณาเปิดระบบผ่าน LINE ใหม่อีกครั้ง";
  const externalLoginMessage =
    "กำลังเชื่อมต่อบัญชี LINE...";
  const externalLoginFailedMessage =
    "ไม่สามารถเชื่อมต่อบัญชี LINE ได้ กรุณาลองเปิดระบบใหม่อีกครั้ง";
  const initFailedMessage =
    "ไม่สามารถเริ่มต้น LIFF ได้ กรุณาปิดแล้วเปิดใหม่";

  let initialized = false;
  let initializing = null;
  let idToken = "";
  let errorMessage = "";
  let currentState = enabled ? "idle" : "idle";
  let initStarted = false;
  let initResolved = false;
  let initRejected = false;
  let initializedInClient = null;
  let initializedLoggedIn = null;
  let sanitizedInitError = "";
  let debugPanelClosed = false;
  const debugEvents = [];

  function createAuthError(message) {
    const error = new Error(message || authUnavailableMessage);
    error.statusCode = 401;
    error.code = "LIFF_AUTH_REQUIRED";
    return error;
  }

  function addDebugEvent(event, details) {
    if (!debugEnabled) {
      return;
    }

    const entry = { event };
    if (details && typeof details === "object") {
      Object.keys(details).forEach((key) => {
        const value = details[key];
        if (
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean" ||
          value === null
        ) {
          entry[key] = value;
        }
      });
    }

    debugEvents.push(entry);
    while (debugEvents.length > 20) {
      debugEvents.shift();
    }
    renderDebugPanel();
  }

  function normalizeConfiguredLiffId(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function getConfiguredLiffId() {
    return normalizeConfiguredLiffId(window.LiffConfig && window.LiffConfig.liffId);
  }

  function validateConfiguredLiffId() {
    const configuredLiffId = getConfiguredLiffId();
    addDebugEvent("config-read");

    if (!configuredLiffId) {
      errorMessage = "ยังไม่ได้ตั้งค่า LIFF ID";
      addDebugEvent("config-id-mismatch", { configured: "missing" });
      throw new Error(errorMessage);
    }

    if (configuredLiffId !== EXPECTED_LIFF_ID) {
      errorMessage = "LIFF ID ไม่ตรงกับค่าที่กำหนด";
      addDebugEvent("config-id-mismatch");
      throw new Error(errorMessage);
    }

    addDebugEvent("config-id-valid");
    return configuredLiffId;
  }

  function readLiffBoolean(methodName) {
    try {
      return Boolean(
        window.liff &&
          typeof window.liff[methodName] === "function" &&
          window.liff[methodName](),
      );
    } catch (error) {
      return false;
    }
  }

  function readLineVersion() {
    try {
      return window.liff && typeof window.liff.getLineVersion === "function"
        ? window.liff.getLineVersion() || null
        : null;
    } catch (error) {
      return null;
    }
  }

  function readContext() {
    try {
      return window.liff && typeof window.liff.getContext === "function"
        ? window.liff.getContext() || null
        : null;
    } catch (error) {
      return null;
    }
  }

  function readCurrentTokenAvailable() {
    try {
      if (idToken) {
        return true;
      }
      return Boolean(
        window.liff &&
          typeof window.liff.getIDToken === "function" &&
          window.liff.getIDToken(),
      );
    } catch (error) {
      return false;
    }
  }

  function refreshRuntimeState() {
    if (!enabled) {
      currentState = "idle";
      initializedInClient = null;
      initializedLoggedIn = null;
      return;
    }

    initializedInClient = readLiffBoolean("isInClient");
    initializedLoggedIn = readLiffBoolean("isLoggedIn");
    addDebugEvent("runtime-state-read", {
      inClient: initializedInClient,
      loggedIn: initializedLoggedIn,
    });

    if (initRejected) {
      currentState = "failed";
      return;
    }

    if (!initResolved) {
      currentState = initStarted ? "initializing" : "idle";
      return;
    }

    if (initializedLoggedIn && idToken) {
      currentState = initializedInClient
        ? "ready-in-client-authenticated"
        : "ready-external-authenticated";
      return;
    }

    if (!initializedInClient && !initializedLoggedIn) {
      currentState = "ready-external-unauthenticated";
      return;
    }

    currentState = initializedInClient
      ? "ready-in-client-unauthenticated"
      : "ready-external-unauthenticated";
  }

  function loadLiffSdk() {
    if (window.liff) {
      addDebugEvent("sdk-present");
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${sdkUrl}"]`);
      if (existingScript) {
        existingScript.addEventListener("load", () => {
          addDebugEvent("sdk-present");
          resolve();
        }, { once: true });
        existingScript.addEventListener("error", reject, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = sdkUrl;
      script.async = true;
      script.onload = () => {
        addDebugEvent("sdk-present");
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function initialize() {
    if (!enabled) {
      return false;
    }

    if (initRejected) {
      throw createAuthError(errorMessage || initFailedMessage);
    }

    if (initResolved) {
      return isReady();
    }

    if (initializing) {
      return initializing;
    }

    initializing = (async () => {
      initStarted = true;
      currentState = "initializing";
      errorMessage = "";
      addDebugEvent("init-start");

      try {
        const liffId = validateConfiguredLiffId();
        await loadLiffSdk();
        if (!window.liff) {
          throw new Error("LIFF SDK ไม่พร้อมใช้งาน");
        }

        addDebugEvent("external-login-enabled");
        currentState = "authenticating-external";
        await window.liff.init({
          liffId,
          withLoginOnExternalBrowser: WITH_LOGIN_ON_EXTERNAL_BROWSER,
        });
        initResolved = true;
        initRejected = false;
        sanitizedInitError = "";

        if (
          readLiffBoolean("isLoggedIn") &&
          typeof window.liff.getIDToken === "function"
        ) {
          idToken = window.liff.getIDToken() || "";
        } else {
          idToken = "";
        }

        initialized = Boolean(idToken);
        refreshRuntimeState();
        addDebugEvent("context-read");

        if (initialized) {
          errorMessage = "";
          addDebugEvent(initializedInClient ? "token-available" : "external-authenticated");
        } else if (!initializedInClient && !initializedLoggedIn) {
          errorMessage = externalLoginMessage;
          addDebugEvent("external-login-required");
          addDebugEvent("external-unauthenticated");
        } else {
          errorMessage = authUnavailableMessage;
          addDebugEvent("token-unavailable");
        }
        addDebugEvent("init-resolved", {
          ready: initialized,
          state: currentState,
        });
        return isReady();
      } catch (error) {
        idToken = "";
        initialized = false;
        initRejected = true;
        initResolved = false;
        currentState = "failed";
        sanitizedInitError = errorMessage || initFailedMessage;
        errorMessage = sanitizedInitError;
        addDebugEvent("init-rejected");
        renderDebugPanel();
        throw new Error(sanitizedInitError);
      } finally {
        initializing = null;
      }
    })();

    return initializing;
  }

  function isInClient() {
    if (!initResolved) {
      return false;
    }
    initializedInClient = readLiffBoolean("isInClient");
    return initializedInClient;
  }

  function isLoggedIn() {
    if (!initResolved) {
      return false;
    }
    initializedLoggedIn = readLiffBoolean("isLoggedIn");
    return initializedLoggedIn;
  }

  function isReady() {
    return Boolean(
      enabled &&
        initResolved &&
        initialized &&
        idToken,
    );
  }

  async function getCurrentIdToken() {
    addDebugEvent("token-provider-request");

    if (!enabled) {
      addDebugEvent("token-provider-unavailable");
      throw createAuthError();
    }

    await initialize();

    if (!isReady()) {
      idToken = "";
      errorMessage =
        currentState === "ready-external-unauthenticated"
          ? externalLoginFailedMessage
          : authUnavailableMessage;
      addDebugEvent("token-provider-unavailable");
      throw createAuthError();
    }

    const currentToken =
      window.liff && typeof window.liff.getIDToken === "function"
        ? window.liff.getIDToken() || ""
        : idToken;

    if (!currentToken) {
      idToken = "";
      initialized = false;
      errorMessage =
        currentState === "ready-external-unauthenticated"
          ? externalLoginFailedMessage
          : authUnavailableMessage;
      addDebugEvent("token-provider-unavailable");
      throw createAuthError();
    }

    idToken = currentToken;
    initialized = true;
    errorMessage = "";
    addDebugEvent("token-provider-success");
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

  function getSanitizedContextInfo() {
    const context = readContext();

    if (!context || typeof context !== "object") {
      return {
        type: null,
        viewType: null,
        includesLiffId: false,
        publicLiffId: null,
        liffIdMatchesExpected: null,
      };
    }

    const publicLiffId =
      typeof context.liffId === "string" ? context.liffId : null;

    return {
      type: typeof context.type === "string" ? context.type : null,
      viewType: typeof context.viewType === "string" ? context.viewType : null,
      includesLiffId: Boolean(publicLiffId),
      publicLiffId,
      liffIdMatchesExpected: publicLiffId
        ? publicLiffId === EXPECTED_LIFF_ID
        : null,
    };
  }

  function getDebugSnapshot() {
    const configuredLiffId = getConfiguredLiffId();
    const contextInfo = getSanitizedContextInfo();
    const tokenFunctionExists = Boolean(
      window.liff && typeof window.liff.getIDToken === "function",
    );
    const tokenAvailable =
      !initRejected && tokenFunctionExists ? readCurrentTokenAvailable() : false;
    const environment = initResolved
      ? initializedInClient
        ? "in-client"
        : "external"
      : "unknown";
    const authenticatedFeatureReady = isReady();

    return {
      origin: window.location.origin || "",
      pathname: window.location.pathname || "",
      hasLiffParam: enabled,
      hasLiffDebugParam: debugEnabled,
      liffSdkLoaded: Boolean(window.liff),
      expectedLiffId: EXPECTED_LIFF_ID,
      expectedLiffUrl: EXPECTED_LIFF_URL,
      withLoginOnExternalBrowserEnabled: WITH_LOGIN_ON_EXTERNAL_BROWSER,
      configuredRuntimeLiffId: configuredLiffId || null,
      configuredIdMatchesExpected: configuredLiffId
        ? configuredLiffId === EXPECTED_LIFF_ID
        : false,
      initStarted,
      initResolved,
      initRejected,
      sanitizedInitializationError: sanitizedInitError || "",
      isInClient: initResolved ? initializedInClient : null,
      isLoggedIn: initResolved ? initializedLoggedIn : null,
      environment,
      lineVersion: readLineVersion(),
      contextType: contextInfo.type,
      contextViewType: contextInfo.viewType,
      contextIncludesLiffId: contextInfo.includesLiffId,
      contextPublicLiffId: contextInfo.publicLiffId,
      contextLiffIdMatchesExpected: contextInfo.liffIdMatchesExpected,
      getIdTokenFunctionExists: tokenFunctionExists,
      idTokenAvailable: tokenAvailable,
      appTokenProviderExists: true,
      authenticatedFeatureReady,
      loginFlowExpected:
        WITH_LOGIN_ON_EXTERNAL_BROWSER &&
        initResolved &&
        environment === "external" &&
        !initializedLoggedIn,
      currentApplicationLiffState: currentState,
      persistedParcelActionsEnabled: authenticatedFeatureReady,
      lineSummaryEnabled: authenticatedFeatureReady,
      events: debugEvents.slice(),
    };
  }

  function createElement(tagName, text) {
    const element = document.createElement(tagName);
    if (text !== undefined) {
      element.textContent = text;
    }
    return element;
  }

  function copyDebugSnapshot() {
    const text = JSON.stringify(getDebugSnapshot(), null, 2);
    if (
      window.navigator &&
      window.navigator.clipboard &&
      typeof window.navigator.clipboard.writeText === "function"
    ) {
      return window.navigator.clipboard.writeText(text);
    }
    return Promise.resolve(false);
  }

  function renderDebugPanel() {
    if (
      !debugEnabled ||
      debugPanelClosed ||
      !document ||
      !document.body ||
      typeof document.createElement !== "function"
    ) {
      return;
    }

    let panel = document.getElementById
      ? document.getElementById("liff-debug-panel")
      : null;
    let pre;
    if (!panel) {
      panel = createElement("section");
      panel.id = "liff-debug-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "LIFF debug");
      panel.style.cssText = [
        "position:fixed",
        "left:12px",
        "right:12px",
        "bottom:calc(12px + env(safe-area-inset-bottom, 0px))",
        "z-index:3000",
        "max-height:min(70dvh, 620px)",
        "overflow:auto",
        "background:#ffffff",
        "color:#0f172a",
        "border:1px solid #94a3b8",
        "border-radius:8px",
        "box-shadow:0 18px 48px rgba(15, 23, 42, 0.25)",
        "padding:12px",
        "font:12px/1.5 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      ].join(";");

      const title = createElement("h2", "LIFF Debug");
      title.style.cssText = "margin:0 0 8px;font-size:16px;";
      pre = createElement("pre");
      pre.id = "liff-debug-output";
      pre.style.cssText = [
        "white-space:pre-wrap",
        "word-break:break-word",
        "max-height:45dvh",
        "overflow:auto",
        "background:#f8fafc",
        "border:1px solid #e2e8f0",
        "border-radius:6px",
        "padding:8px",
        "margin:0 0 10px",
      ].join(";");

      const actions = createElement("div");
      actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;";
      const copyButton = createElement("button", "คัดลอกผลตรวจ");
      copyButton.id = "liff-debug-copy";
      copyButton.type = "button";
      copyButton.addEventListener("click", () => {
        copyDebugSnapshot().catch(() => {});
      });
      const closeButton = createElement("button", "ปิด");
      closeButton.id = "liff-debug-close";
      closeButton.type = "button";
      closeButton.addEventListener("click", () => {
        debugPanelClosed = true;
        if (panel && typeof panel.remove === "function") {
          panel.remove();
        } else if (panel && panel.parentNode) {
          panel.parentNode.removeChild(panel);
        }
      });
      actions.append(copyButton, closeButton);
      panel.append(title, pre, actions);
      document.body.appendChild(panel);
    } else {
      pre = document.getElementById
        ? document.getElementById("liff-debug-output")
        : null;
    }

    if (pre) {
      pre.textContent = JSON.stringify(getDebugSnapshot(), null, 2);
    }
  }

  if (debugEnabled) {
    addDebugEvent("debug-enabled");
    if (document.readyState === "loading" && document.addEventListener) {
      document.addEventListener("DOMContentLoaded", renderDebugPanel, { once: true });
    } else {
      renderDebugPanel();
    }
  }

  window.MapLiffMode = {
    expectedLiffId: EXPECTED_LIFF_ID,
    expectedLiffUrl: EXPECTED_LIFF_URL,
    isEnabled: function () {
      return enabled;
    },
    initialize,
    isReady,
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
    getState: function () {
      return currentState;
    },
    getDebugSnapshot,
    refreshDebugPanel: renderDebugPanel,
  };
})(window, document);
