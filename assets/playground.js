const $ = (id) => document.getElementById(id);

const SSO_DEMO_ENABLED = true; // Re-enabled for debugging

const SSO_DEBUG_REDACT_KEYS = new Set([
  "api_key",
  "apikey",
  "key",
  "token",
  "jwt",
  "authorization",
  "password",
  "secret",
  "private_key",
  "client_email",
  "encrypted_body"
]);
const SSO_DEBUG_REDACT_SUBSTRINGS = ["credential"];

const ssoDebugState = {
  enabled: false,
  authorize: {
    request: null,
    response: null
  },
  libraryError: null
};

function isSsoDebugEnabled() {
  try {
    const params = new URLSearchParams(window.location.search || "");
    return params.get("debug_sso") === "1" || window.SIS_DEBUG_SSO === true;
  } catch (e) {
    return window.SIS_DEBUG_SSO === true;
  }
}

function normalizeKey(key) {
  return String(key || "").toLowerCase();
}

function shouldRedactKey(key) {
  const normalized = normalizeKey(key);
  if (SSO_DEBUG_REDACT_KEYS.has(normalized)) return true;
  if (SSO_DEBUG_REDACT_SUBSTRINGS.some((entry) => normalized.includes(entry))) return true;
  if (normalized.includes("token")) return true;
  if (normalized.includes("secret")) return true;
  if (normalized.includes("password")) return true;
  if (normalized.includes("authorization")) return true;
  if (normalized.includes("jwt")) return true;
  if (normalized.includes("api-key") || normalized.includes("apikey") || normalized.includes("api_key")) return true;
  if (/(_|-)key$/.test(normalized)) return true;
  return false;
}

function redactClientEmail(value) {
  if (typeof value !== "string") return "[REDACTED]";
  const parts = value.split("@");
  if (parts.length !== 2) return "[REDACTED]";
  return `***@${parts[1]}`;
}

function extractEncryptedBodyMeta(value) {
  if (typeof value !== "string") {
    return { redacted: true, length: 0, alg: null, hasDollarSep: false };
  }
  const algMatch = value.match(/aes-256-[a-z0-9-]+/i);
  return {
    redacted: true,
    length: value.length,
    alg: algMatch ? algMatch[0] : null,
    hasDollarSep: value.includes("$")
  };
}

function redactDeep(value, key) {
  if (value == null) return value;
  const normalizedKey = normalizeKey(key);

  if (normalizedKey === "client_email") {
    return redactClientEmail(value);
  }
  if (normalizedKey === "encrypted_body") {
    return extractEncryptedBodyMeta(value);
  }
  if (shouldRedactKey(normalizedKey)) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactDeep(entry, key));
  }
  if (typeof value === "object") {
    const output = {};
    Object.keys(value).forEach((childKey) => {
      output[childKey] = redactDeep(value[childKey], childKey);
    });
    return output;
  }
  return value;
}

function safeStringify(value) {
  const seen = new WeakSet();
  return JSON.stringify(value, (key, val) => {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  }, 2);
}

function truncateText(text, maxLength = 2000) {
  const raw = String(text || "");
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, maxLength)}…[truncated]`;
}

function sanitizeRawText(text) {
  let output = String(text || "");
  if (!output) return output;

  const redactValue = (key, value) => {
    const normalized = normalizeKey(key);
    if (normalized === "client_email") return redactClientEmail(value);
    if (normalized === "encrypted_body") {
      const meta = extractEncryptedBodyMeta(value);
      const alg = meta.alg ? ` alg=${meta.alg}` : "";
      return `[REDACTED len=${meta.length}${alg}]`;
    }
    if (shouldRedactKey(normalized)) return "[REDACTED]";
    return value;
  };

  Array.from(SSO_DEBUG_REDACT_KEYS).forEach((key) => {
    const jsonRegex = new RegExp(`("${key}"\\s*:\\s*")(.*?)(")`, "gi");
    output = output.replace(jsonRegex, (match, p1, p2, p3) => `${p1}${redactValue(key, p2)}${p3}`);
    const singleQuoteRegex = new RegExp(`('${key}'\\s*:\\s*')(.*?)(')`, "gi");
    output = output.replace(singleQuoteRegex, (match, p1, p2, p3) => `${p1}${redactValue(key, p2)}${p3}`);
    const queryRegex = new RegExp(`([?&]${key}=)([^&\\s]+)`, "gi");
    output = output.replace(queryRegex, (match, p1, p2) => `${p1}${redactValue(key, p2)}`);
  });

  SSO_DEBUG_REDACT_SUBSTRINGS.forEach((fragment) => {
    const jsonRegex = new RegExp(`("${fragment}[^"]*"\\s*:\\s*")(.*?)(")`, "gi");
    output = output.replace(jsonRegex, (match, p1, p2, p3) => `${p1}[REDACTED]${p3}`);
  });

  ["token", "secret", "password", "authorization", "credential", "api-key", "api_key", "apikey"].forEach((fragment) => {
    const jsonRegex = new RegExp(`("([^"]*${fragment}[^"]*)"\\s*:\\s*")(.*?)(")`, "gi");
    output = output.replace(jsonRegex, (match, p1, p2, p3, p4) => `${p1}[REDACTED]${p4}`);
    const queryRegex = new RegExp(`([?&][^=]*${fragment}[^=]*=)([^&\\s]+)`, "gi");
    output = output.replace(queryRegex, (match, p1) => `${p1}[REDACTED]`);
  });

  return output;
}

function headersToObject(headers) {
  if (!headers) return {};
  const output = {};
  if (typeof headers.forEach === "function") {
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }
  if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      output[key] = value;
    });
    return output;
  }
  return { ...headers };
}

function redactHeaders(headers) {
  const output = {};
  Object.keys(headers || {}).forEach((key) => {
    const normalizedKey = normalizeKey(key);
    if (normalizedKey === "client_email") {
      output[key] = redactClientEmail(headers[key]);
      return;
    }
    if (shouldRedactKey(normalizedKey)) {
      output[key] = "[REDACTED]";
      return;
    }
    output[key] = headers[key];
  });
  return output;
}

function summarizeBody(body) {
  if (body == null) {
    return { bodyType: "none", bodyLen: 0, bodyHasDollarSep: false };
  }
  if (typeof body === "string") {
    return { bodyType: "string", bodyLen: body.length, bodyHasDollarSep: body.includes("$") };
  }
  if (body instanceof URLSearchParams) {
    const text = body.toString();
    return { bodyType: "urlencoded", bodyLen: text.length, bodyHasDollarSep: text.includes("$") };
  }
  if (body instanceof Blob) {
    return { bodyType: body.type || "blob", bodyLen: body.size, bodyHasDollarSep: false };
  }
  if (body instanceof FormData) {
    return { bodyType: "formdata", bodyLen: null, bodyHasDollarSep: false };
  }
  if (typeof body === "object") {
    try {
      const text = JSON.stringify(body);
      return { bodyType: "json", bodyLen: text.length, bodyHasDollarSep: text.includes("$") };
    } catch (e) {
      return { bodyType: "object", bodyLen: null, bodyHasDollarSep: false };
    }
  }
  return { bodyType: typeof body, bodyLen: null, bodyHasDollarSep: false };
}

function parseEncryptedBodyFromText(text) {
  const output = { hasEncryptedBody: false, alg: null, encryptedLen: null };
  if (!text) return output;
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    parsed = null;
  }

  const scanValue = (value) => {
    if (output.hasEncryptedBody) return;
    if (value == null) return;
    if (typeof value === "string") {
      if (value.includes("$")) {
        const algMatch = value.match(/aes-256-[a-z0-9-]+/i);
        output.hasEncryptedBody = true;
        output.alg = algMatch ? algMatch[0] : null;
        output.encryptedLen = value.length;
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(scanValue);
      return;
    }
    if (typeof value === "object") {
      Object.keys(value).forEach((key) => {
        if (normalizeKey(key) === "encrypted_body") {
          const meta = extractEncryptedBodyMeta(value[key]);
          output.hasEncryptedBody = true;
          output.alg = meta.alg;
          output.encryptedLen = meta.length;
          return;
        }
        scanValue(value[key]);
      });
    }
  };

  if (parsed && typeof parsed === "object") {
    scanValue(parsed);
    return output;
  }

  if (/encrypted_body/i.test(text)) {
    output.hasEncryptedBody = true;
    const algMatch = text.match(/aes-256-[a-z0-9-]+/i);
    output.alg = algMatch ? algMatch[0] : null;
  }
  return output;
}

function buildResponseSummary(response, text) {
  const headers = headersToObject(response.headers);
  const redactedHeaders = redactHeaders(headers);
  const encryptedMeta = parseEncryptedBodyFromText(text);
  let rawTextSnippetRedacted = "";

  if (text) {
    try {
      const parsed = JSON.parse(text);
      rawTextSnippetRedacted = truncateText(safeStringify(redactDeep(parsed)));
    } catch (e) {
      rawTextSnippetRedacted = truncateText(sanitizeRawText(text));
    }
  }

  return {
    status: response.status,
    headers: redactedHeaders,
    hasEncryptedBody: encryptedMeta.hasEncryptedBody,
    alg: encryptedMeta.alg,
    encryptedLen: encryptedMeta.encryptedLen,
    rawTextSnippetRedacted
  };
}

function recordAuthorizeRequest(details) {
  if (!ssoDebugState.enabled) return;
  const redactedDetails = redactDeep(details);
  ssoDebugState.authorize.request = {
    ...(ssoDebugState.authorize.request || {}),
    ...redactedDetails
  };
  renderSsoDebugPanel();
}

function recordAuthorizeResponse(details) {
  if (!ssoDebugState.enabled) return;
  ssoDebugState.authorize.response = details;
  renderSsoDebugPanel();
}

function captureLibraryError(err) {
  if (!ssoDebugState.enabled) return;
  if (!err) {
    ssoDebugState.libraryError = null;
    renderSsoDebugPanel();
    return;
  }
  const errorDetails = {
    status: err.status,
    message: err.message,
    keys: Object.keys(err || {})
  };
  ["body", "response", "data", "details"].forEach((field) => {
    if (err && err[field] !== undefined) {
      errorDetails[field] = redactDeep(err[field], field);
    }
  });
  ssoDebugState.libraryError = redactDeep(errorDetails);
  renderSsoDebugPanel();
}

function buildDebugBundle() {
  const bundle = {
    ts: new Date().toISOString(),
    location: window.location.href,
    userAgent: navigator.userAgent,
    authorize: {
      request: ssoDebugState.authorize.request,
      response: ssoDebugState.authorize.response
    },
    libraryError: ssoDebugState.libraryError
  };
  return redactDeep(bundle);
}

function renderSsoDebugPanel() {
  if (!ssoDebugState.enabled) return;
  const requestEl = $("ssoDebugAuthorizeRequest");
  const responseEl = $("ssoDebugAuthorizeResponse");
  const errorEl = $("ssoDebugLibraryError");
  if (requestEl) {
    requestEl.textContent = ssoDebugState.authorize.request
      ? safeStringify(ssoDebugState.authorize.request)
      : "Waiting for authorize request…";
  }
  if (responseEl) {
    responseEl.textContent = ssoDebugState.authorize.response
      ? safeStringify(ssoDebugState.authorize.response)
      : "Waiting for authorize response…";
  }
  if (errorEl) {
    errorEl.textContent = ssoDebugState.libraryError
      ? safeStringify(ssoDebugState.libraryError)
      : "Waiting for library error…";
  }
}

function installSsoDebugFetchPatch() {
  if (!ssoDebugState.enabled || window.__ssoDebugFetchPatched) return;
  const originalFetch = window.fetch;

  window.fetch = async (input, init) => {
    const requestUrl = typeof input === "string" ? input : (input && input.url) || "";
    const requestMethod = (init && init.method) || (input && input.method) || "GET";
    const headersFromInit = headersToObject(init && init.headers);
    const headersFromRequest = headersToObject(input && input.headers);
    const mergedHeaders = { ...headersFromRequest, ...headersFromInit };
    const contentType = mergedHeaders["Content-Type"] || mergedHeaders["content-type"] || "";
    const isAuthorize = requestUrl.includes("/cardholders/authorize");

    let bodySummary = null;
    if (init && Object.prototype.hasOwnProperty.call(init, "body")) {
      bodySummary = summarizeBody(init.body);
    } else if (typeof Request !== "undefined" && input instanceof Request) {
      const shouldReadBody = !contentType || /json|text|x-www-form-urlencoded/i.test(contentType);
      if (shouldReadBody) {
        input.clone().text().then((text) => {
          const summary = summarizeBody(text);
          if (isAuthorize) {
            recordAuthorizeRequest(summary);
          }
        }).catch(() => {});
      }
    }

    if (isAuthorize) {
      recordAuthorizeRequest({
        url: requestUrl,
        method: requestMethod,
        headers: redactHeaders(mergedHeaders),
        contentType: contentType || "unknown",
        ...(bodySummary || {})
      });
    }

    const response = await originalFetch(input, init);

    if (isAuthorize) {
      response.clone().text().then((text) => {
        recordAuthorizeResponse(buildResponseSummary(response, text));
      }).catch(() => {
        recordAuthorizeResponse(buildResponseSummary(response, ""));
      });
    }

    return response;
  };

  window.__ssoDebugFetchPatched = true;
  window.__ssoDebugFetchOriginal = originalFetch;
}

function installSsoDebugXhrPatch() {
  if (!ssoDebugState.enabled || window.__ssoDebugXhrPatched || !window.XMLHttpRequest) return;
  const OriginalXhr = window.XMLHttpRequest;

  function SsoDebugXhr() {
    const xhr = new OriginalXhr();
    let requestUrl = "";
    let requestMethod = "GET";
    let requestHeaders = {};
    let requestBodySummary = null;

    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    const originalSetRequestHeader = xhr.setRequestHeader;

    xhr.open = function open(method, url, async, user, password) {
      requestMethod = method || "GET";
      requestUrl = String(url || "");
      return originalOpen.call(xhr, method, url, async, user, password);
    };

    xhr.setRequestHeader = function setRequestHeader(key, value) {
      requestHeaders[key] = value;
      return originalSetRequestHeader.call(xhr, key, value);
    };

    xhr.send = function send(body) {
      requestBodySummary = summarizeBody(body);
      const isAuthorize = requestUrl.includes("/cardholders/authorize");
      if (isAuthorize) {
        recordAuthorizeRequest({
          url: requestUrl,
          method: requestMethod,
          headers: redactHeaders(requestHeaders),
          contentType: requestHeaders["Content-Type"] || requestHeaders["content-type"] || "",
          ...requestBodySummary
        });
      }

      const finalize = () => {
        if (!isAuthorize) return;
        const responseText = xhr.responseText || "";
        const responseLike = {
          status: xhr.status,
          headers: headersToObject(parseXhrHeaders(xhr.getAllResponseHeaders()))
        };
        recordAuthorizeResponse(buildResponseSummary(responseLike, responseText));
      };

      xhr.addEventListener("loadend", finalize);
      return originalSend.call(xhr, body);
    };

    return xhr;
  }

  function parseXhrHeaders(headerString) {
    const output = {};
    if (!headerString) return output;
    headerString.trim().split(/[\r\n]+/).forEach((line) => {
      const parts = line.split(": ");
      const key = parts.shift();
      if (!key) return;
      const value = parts.join(": ");
      output[key] = value;
    });
    return output;
  }

  window.XMLHttpRequest = SsoDebugXhr;
  window.__ssoDebugXhrPatched = true;
  window.__ssoDebugXhrOriginal = OriginalXhr;
}

function installSsoDebugErrorHooks() {
  if (!ssoDebugState.enabled || window.__ssoDebugErrorHooks) return;
  window.addEventListener("error", (event) => {
    captureLibraryError(event?.error || event);
  });
  window.addEventListener("unhandledrejection", (event) => {
    captureLibraryError(event?.reason || event);
  });
  window.__ssoDebugErrorHooks = true;
}

function initSsoDebug() {
  ssoDebugState.enabled = isSsoDebugEnabled();
  if (!ssoDebugState.enabled) return;
  const indicator = $("ssoDebugIndicator");
  const panel = $("ssoDebugPanel");
  if (indicator) indicator.hidden = false;
  if (panel) panel.hidden = false;
  const copyBtn = $("ssoDebugCopyBtn");
  const resetBtn = $("ssoDebugResetBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        const bundle = buildDebugBundle();
        await navigator.clipboard.writeText(safeStringify(bundle));
        setStatus("SSO debug bundle copied.");
      } catch (e) {
        setStatus(e?.message || String(e));
      }
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      ssoDebugState.authorize.request = null;
      ssoDebugState.authorize.response = null;
      ssoDebugState.libraryError = null;
      renderSsoDebugPanel();
    });
  }
  installSsoDebugFetchPatch();
  installSsoDebugXhrPatch();
  installSsoDebugErrorHooks();
  renderSsoDebugPanel();
}

function safeParseJson(text) {
  if (!text || !text.trim()) return null;
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`Invalid JSON in override: ${e.message}`); }
}

function mergeSettings(base, override) {
  const merged = { ...base, ...override };
  if (base.config || override.config) {
    merged.config = { ...base.config, ...override.config };
  }
  if (base.style || override.style) {
    merged.style = { ...base.style, ...override.style };
  }
  if (base.user || override.user) {
    merged.user = { ...base.user, ...override.user };
  }
  return merged;
}

const SSO_LAMBDA_URL = "https://bswpcoqak3b7elcynskytiapyu0eokxs.lambda-url.us-west-2.on.aws/";
const DEMO_CARD = {
  email: "jack_skellington@scareme.com",
  phoneNumber: "7141122222",
  cvv: "414",
  nameOnCard: "Jack Skelington",
  pan: "4114411441144114",
  expirationMonth: "04",
  expirationYear: "24",
  address: {
    is_primary: "true",
    address1: "1122 Boogie Boogie Ave.",
    address2: "",
    city: "Anaheim",
    subnational: "CA",
    postal_code: "92801",
    country: "USA",
    first_name: "Jack",
    last_name: "Skelington"
  }
};

function buildBaseSettingsFromForm() {
  const fiHost = $("fiHost").value.trim();
  const hostname = `https://${fiHost}/`;
  const merchantSiteTags = getSelectedMerchantSiteTags();
  const topSites = parseCommaList($("topSites").value);
  const ssoEnabled = isSsoDemoEnabled();
  const closeUrl = normalizeCloseUrl($("closeUrl").value, hostname);
  const scenarioType = getRadioValue("scenarioType", "overlay");
  const sourceType = $("sourceType").value;
  const sourceCategory = $("sourceCategory").value;
  const sourceSubCategory = $("sourceSubCategory").value.trim();

  const base = {
    config: {
      app_container_id: "cardupdatr-frame",
      hostname,
      financial_institution: fiHost.split(".")[0] || "",
      overlay: scenarioType === "overlay",
      close_url: closeUrl,
      exclude_sites: parseCommaList($("excludeSites").value),
      merchant_site_tags: merchantSiteTags,
      countries_supported: parseCommaList($("countriesSupported").value)
    },
    user: {
      source: {
        type: sourceType,
        category: sourceCategory,
        sub_category: sourceSubCategory
      }
    },
    style: {
      link_color: $("linkColor").value.trim(),
      button_color: $("buttonColor").value.trim(),
      button_border_radius: $("buttonBorderRadius").value.trim(),
      button_padding: $("buttonPadding").value.trim(),
      border_color: $("borderColor").value.trim(),
      overlay_background_color: $("overlayBgColor").value.trim(),
      drop_shadow: $("dropShadow").checked,
      dynamic_height: $("dynamicHeight").checked
    }
  };

  if (merchantSiteTags.length) {
    base.config.tags = merchantSiteTags.join(",");
  }

  if (!sourceSubCategory) {
    delete base.user.source.sub_category;
  }

  const cardDescription = $("cardDescription").value.trim();
  if (cardDescription) {
    base.style.card_description = cardDescription;
  }

  const finalMessage = $("finalMessage").value.trim();
  if (finalMessage) {
    base.style.final_message = finalMessage;
  }

  if (ssoEnabled) {
    base.user = {
      grant: "",
      card_id: ""
    };
  }

  if (topSites.length) {
    base.config.top_sites = topSites;
  }

  const merchantSelectionMessage = $("merchantSelectionMessage").value.trim();
  if (merchantSelectionMessage) {
    base.style.merchant_selection_message = merchantSelectionMessage;
  }
  return base;
}

function normalizeCloseUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return undefined;
  if (trimmed === "close" || trimmed === "none" || trimmed === "/select-merchants") return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return "none";
}

function buildSsoRequestFromForm() {
  const excludeCVV = $("excludeCVV").checked;
  const excludePhoneNumber = $("excludePhoneNumber").checked;
  const excludeEmail = $("excludeEmail").checked;

  const fiHost = $("fiHost").value;
  const cardsavrServer = inferCardsavrServer(fiHost);

  const payload = {
    cardholder_data: {
      type: "ephemeral",
      webhook_url1: "",
      integrator_id1: 0
    },
    card_data: {
      name_on_card: DEMO_CARD.nameOnCard,
      pan: DEMO_CARD.pan,
      expiration_month: DEMO_CARD.expirationMonth,
      expiration_year: DEMO_CARD.expirationYear
    },
    cardsavr_server: cardsavrServer,
    api_instance: cardsavrServer  // Add api_instance field for SSO grant generation
  };

  if (!excludeEmail) {
    payload.cardholder_data.email = DEMO_CARD.email;
  }

  if (!excludeCVV) {
    payload.card_data.cvv = DEMO_CARD.cvv;
  }

  payload.address_data = {
    ...DEMO_CARD.address
  };
  if (!excludeEmail) {
    payload.address_data.email = DEMO_CARD.email;
  }
  if (!excludePhoneNumber) {
    payload.address_data.phone_number = DEMO_CARD.phoneNumber;
  }

  return payload;
}

async function fetchSsoGrant(payload) {
  console.log('[SSO DEBUG] fetchSsoGrant() called');
  console.log('  Request payload:', JSON.stringify(payload, null, 2));

  const startTime = performance.now();
  const response = await fetch(SSO_LAMBDA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const endTime = performance.now();

  console.log(`  [SSO DEBUG] Lambda response time: ${(endTime - startTime).toFixed(2)}ms`);
  console.log(`  Response status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    console.error('[SSO DEBUG] Lambda returned error status');
    throw new Error("SSO demo gateway returned an error.");
  }

  const apiResponse = await response.json();
  console.log('  [SSO DEBUG] Lambda response:', {
    grant: apiResponse.grant ? `${apiResponse.grant.substring(0, 20)}...` : 'MISSING',
    cardId: apiResponse.cardId || 'MISSING',
    fullResponse: apiResponse
  });

  if (!apiResponse?.grant || !apiResponse?.cardId) {
    console.error('[SSO DEBUG] Response missing grant or cardId');
    throw new Error("SSO demo response is missing grant or cardId.");
  }
  return apiResponse;
}

function buildConfigFromForm() {
  const base = buildBaseSettingsFromForm();
  const override = safeParseJson($("configOverride").value);
  if (override) {
    return mergeSettings(base, override);
  }
  return base;
}

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function ensureCardupdatrScript(hostname, forceReload = false) {
  console.log('[SSO DEBUG] ensureCardupdatrScript() called');
  console.log(`  Hostname: ${hostname}`);
  console.log(`  Force reload: ${forceReload}`);

  const script = document.getElementById("cardupdatr-script");
  const desiredSrc = `${hostname}cardupdatr-client-v2.js`;

  if (!forceReload && script && script.src === desiredSrc && typeof window.embedCardUpdatr === "function") {
    console.log('[SSO DEBUG] CardUpdatr script already loaded, reusing');
    return Promise.resolve();
  }

  if (forceReload) {
    console.log('[SSO DEBUG] Force reload requested - removing old script and clearing globals');
    if (script && script.parentNode) {
      console.log('  [SSO DEBUG] Removing old script element');
      script.parentNode.removeChild(script);
    }
    // Clear all CardUpdatr client globals to force fresh SDK initialization
    const cardupdatrGlobals = [
      'embedCardUpdatr',
      'initCardupdatr',
      'launchCardUpdatr',
      'getCardData',
      'build_cardupdatr_hash_string',
      'inferCardsavrServer',
      'loadCustomCardData',
      'toggleCustomCardFields',
      'getCustomCardData',
      'ensureCardupdatrScript'
    ];
    cardupdatrGlobals.forEach(name => {
      if (window[name]) {
        console.log(`  [SSO DEBUG] Clearing window.${name}`);
        delete window[name];
      }
    });
  }

  console.log('[SSO DEBUG] Loading CardUpdatr script from:', desiredSrc);

  return new Promise((resolve, reject) => {
    const newScript = document.createElement("script");
    newScript.id = "cardupdatr-script";
    newScript.defer = true;
    newScript.src = desiredSrc;
    newScript.onload = () => {
      console.log('[SSO DEBUG] CardUpdatr script loaded successfully');
      console.log('  window.embedCardUpdatr available:', typeof window.embedCardUpdatr === "function");
      resolve();
    };
    newScript.onerror = () => {
      console.error('[SSO DEBUG] Failed to load CardUpdatr script');
      reject(new Error("Failed to load CardUpdatr script."));
    };

    // Append the new script (old script already removed if forceReload was true)
    if (!forceReload && script && script.parentNode) {
      console.log('  [SSO DEBUG] Replacing existing script');
      script.parentNode.replaceChild(newScript, script);
    } else {
      console.log('  [SSO DEBUG] Appending new script to body');
      document.body.appendChild(newScript);
    }
  });
}

async function renderPreview(settings, { resetSession = false } = {}) {
  console.log('[SSO DEBUG] renderPreview() called');
  console.log('  Final settings:', JSON.stringify(settings, null, 2));
  console.log('  resetSession option:', resetSession);

  logSessionState('AT START of renderPreview()');

  const scenarioType = getRadioValue("scenarioType", "overlay");
  console.log(`  Scenario type: ${scenarioType}`);

  const preview = $("preview");

  if (scenarioType === "weblink") {
    const width = parseInt($("containerWidth").value, 10) || 900;
    const height = parseInt($("containerHeight").value, 10) || 1100;
    window.open(settings.config.hostname, "_blank");
    setStatus("Weblink opened in a new tab.");
    return;
  }

  applyContainerStyles(preview);
  preview.innerHTML = '<div id="cardupdatr-frame"></div>';

  try {
    setStatus("Loading script…");
    await ensureCardupdatrScript(settings.config.hostname, resetSession);
    if (settings && settings.config && settings.config.hostname) {
      const bodySummary = settings.user ? summarizeBody(settings.user) : summarizeBody(null);
      recordAuthorizeRequest({
        url: `${settings.config.hostname.replace(/\/?$/, "/")}cardholders/authorize`,
        method: "POST",
        contentType: "application/json",
        headers: { "Content-Type": "application/json" },
        source: "playground",
        ...bodySummary
      });
    }
    if (typeof window.embedCardUpdatr !== "function") {
      setStatus("CardUpdatr script loaded, but embedCardUpdatr is missing.");
      return;
    }

    // NOTE: initCardupdatr is deprecated - only use embedCardUpdatr
    console.log('[SSO DEBUG] Calling window.embedCardUpdatr()');
    console.log('  Settings being passed:', JSON.stringify(settings, null, 2));
    logSessionState('IMMEDIATELY BEFORE embedCardUpdatr()');

    window.embedCardUpdatr(settings);

    logSessionState('IMMEDIATELY AFTER embedCardUpdatr()');
    console.log('[SSO DEBUG] embedCardUpdatr() completed');
    setStatus("Loaded.");
  } catch (e) {
    captureLibraryError(e);
    setStatus(`Embed failed: ${e?.message || e}`);
  }
}

function clearCardupdatrStorage() {
  console.log('[SSO DEBUG] clearCardupdatrStorage() called');
  logSessionState('BEFORE storage clear');

  // Clear all CardUpdatr-related keys from sessionStorage
  // These are set by the CardUpdatr client and must be cleared when switching hosts
  const cardupdatrSessionKeys = [
    'appConfiguration',
    'card_id',
    'cardholder_cuid',
    'cardholder_id',
    'cardholder_safe_key',
    'clickstream',
    'hashKeyValues',
    'pageOffset',
    'selectedSites',
    'ssoUser'
  ];

  // Pattern for session keys that include version numbers
  const sessionKeyPattern = /^session_v[\d.]+\[/;
  const legacyPattern = /cardupdatr|cardsavr/i;

  const clearKeys = (storage, storageName) => {
    if (!storage) return;
    const allKeys = Object.keys(storage);
    console.log(`  [SSO DEBUG] All ${storageName} keys:`, allKeys);

    allKeys.forEach((key) => {
      const shouldClear = cardupdatrSessionKeys.includes(key) ||
                          sessionKeyPattern.test(key) ||
                          legacyPattern.test(key);
      if (shouldClear) {
        console.log(`  [SSO DEBUG] Removing ${storageName}["${key}"]`);
        storage.removeItem(key);
      } else {
        console.log(`  [SSO DEBUG] Skipping ${storageName}["${key}"]`);
      }
    });
  };

  clearKeys(sessionStorage, 'sessionStorage');
  clearKeys(localStorage, 'localStorage');

  logSessionState('AFTER storage clear');
}

function logSessionState(label) {
  const keyPattern = /cardupdatr|cardsavr/i;
  const localKeys = Object.keys(localStorage).filter(k => keyPattern.test(k));
  const sessionKeys = Object.keys(sessionStorage).filter(k => keyPattern.test(k));

  console.log(`[SSO DEBUG] ${label}`);
  console.log('  localStorage keys:', localKeys.length > 0 ? localKeys : '(none)');
  console.log('  sessionStorage keys:', sessionKeys.length > 0 ? sessionKeys : '(none)');

  if (localKeys.length > 0) {
    localKeys.forEach(key => {
      console.log(`    - localStorage["${key}"]`, localStorage.getItem(key));
    });
  }
  if (sessionKeys.length > 0) {
    sessionKeys.forEach(key => {
      console.log(`    - sessionStorage["${key}"]`, sessionStorage.getItem(key));
    });
  }
}

$("loadBtn").addEventListener("click", () => {
  (async () => {
    console.log('[SSO DEBUG] ========== LOAD BUTTON CLICKED ==========');
    setStatus("Loading…");
    const settings = buildConfigFromForm();
    console.log('[SSO DEBUG] Base settings built from form');

    const resetSession = true;
    console.log("[SSO DEBUG] resetSession: always on");
    setStatus("Resetting CardUpdatr session…");
    clearCardupdatrStorage();

    const ssoEnabled = isSsoDemoEnabled();
    console.log(`[SSO DEBUG] SSO enabled: ${ssoEnabled}`);

    if (ssoEnabled) {
      console.log('[SSO DEBUG] Entering SSO flow');
      console.log('  Settings BEFORE SSO injection:', JSON.stringify(settings, null, 2));

      try {
        setStatus("Fetching SSO grant…");
        const rawPayload = $("ssoPayload").value;
        const payload = rawPayload.trim()
          ? safeParseJson(rawPayload)
          : buildSsoRequestFromForm();

        console.log('[SSO DEBUG] SSO payload prepared (see fetchSsoGrant for details)');
        const apiResponse = await fetchSsoGrant(payload);

        console.log('[SSO DEBUG] Injecting grant into settings.user');
        settings.user = {
          ...settings.user,
          grant: apiResponse.grant,
          card_id: apiResponse.cardId
        };

        console.log('  Settings AFTER SSO injection:', JSON.stringify(settings, null, 2));
        console.log('  settings.user.grant length:', apiResponse.grant?.length);
        console.log('  settings.user.card_id:', apiResponse.cardId);

      } catch (e) {
        console.error('[SSO DEBUG] SSO flow failed:', e);
        setStatus(`SSO demo failed: ${e?.message || e}`);
        return;
      }
    } else {
      console.log('[SSO DEBUG] Skipping SSO flow (not enabled)');
    }

    logSessionState('BEFORE renderPreview()');
    console.log('[SSO DEBUG] Calling renderPreview()');

    renderPreview(settings, { resetSession }).catch((e) => {
      console.error('[SSO DEBUG] renderPreview() failed:', e);
      setStatus(e?.message || String(e));
    });
  })();
});

$("copyBtn").addEventListener("click", async () => {
  try {
    const settings = buildConfigFromForm();
    await navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
    setStatus("Config copied to clipboard.");
  } catch (e) {
    setStatus(e.message || String(e));
  }
});

function syncColorInputs(textId, pickerId) {
  const textInput = $(textId);
  const pickerInput = $(pickerId);
  if (!textInput || !pickerInput) return;

  const normalizeHex = (value) => {
    const trimmed = String(value || "").trim();
    return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed : null;
  };

  const updatePicker = () => {
    const hex = normalizeHex(textInput.value);
    if (hex) {
      pickerInput.value = hex;
      textInput.value = pickerInput.value;
    }
  };

  const updateText = () => {
    textInput.value = pickerInput.value;
  };

  textInput.addEventListener("input", updatePicker);
  pickerInput.addEventListener("input", updateText);
  updatePicker();
}

syncColorInputs("containerBgColor", "containerBgColorPicker");
syncColorInputs("linkColor", "linkColorPicker");
syncColorInputs("buttonColor", "buttonColorPicker");
syncColorInputs("borderColor", "borderColorPicker");
syncColorInputs("overlayBgColor", "overlayBgColorPicker");

function updateOverridePreview() {
  const settings = buildBaseSettingsFromForm();
  $("configOverride").value = JSON.stringify(settings, null, 2);
}

function parseCommaList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length);
}

function inferCardsavrServer(fiHost) {
  const host = String(fiHost || "").toLowerCase().trim();

  // Handle new .cardupdatr.app domains
  if (host.endsWith(".cardupdatr.app")) {
    const parts = host.split(".");
    const cardupdatrIndex = parts.lastIndexOf("cardupdatr");
    const subdomain = cardupdatrIndex > 0 ? parts[cardupdatrIndex - 1] : "";
    if (subdomain) {
      return `https://api.${subdomain}.cardsavr.io`;
    }
  }

  // Handle legacy .cardsavr.io domains
  if (host.endsWith(".cardsavr.io")) {
    const parts = host.split(".");
    const cardsavrIndex = parts.lastIndexOf("cardsavr");
    const subdomain = cardsavrIndex > 0 ? parts[cardsavrIndex - 1] : "";
    if (subdomain) {
      return `https://api.${subdomain}.cardsavr.io`;
    }
  }

  if (host.includes("customer-dev")) {
    return "https://api.customer-dev.cardsavr.io";
  }
  return "https://api.customer-dev.cardsavr.io";
}

function getSelectedMerchantSiteTags() {
  return Array.from(document.querySelectorAll("#merchantSiteTags input[type=\"checkbox\"]:checked"))
    .map((input) => input.value);
}

function getRadioValue(name, fallback) {
  const checked = document.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : fallback;
}

function applyContainerStyles(preview) {
  const border = $("border").value;
  const dynamicHeight = $("dynamicHeight").checked;
  preview.style.background = $("containerBgColor").value || "transparent";
  preview.style.setProperty("--preview-bg", preview.style.background);
  preview.style.width = $("containerWidth").value || "100%";
  preview.style.height = dynamicHeight ? "auto" : ($("containerHeight").value || "900px");
  preview.style.minHeight = $("containerMinHeight").value || "";
  preview.style.maxHeight = dynamicHeight ? "" : ($("containerMaxHeight").value || "");
  preview.style.textAlign = $("containerTextAlign").value || "";
  preview.style.paddingTop = $("containerPadTop").value || "";
  preview.style.paddingBottom = $("containerPadBottom").value || "";
  preview.style.overflow = dynamicHeight ? "visible" : ($("containerOverflow").value || "visible");
  preview.style.overscrollBehavior = $("containerOverscroll").value || "auto";
  preview.style.border = getBorderStyle(border);
}

function syncPreviewHeightToForm() {
  const preview = $("preview");
  const formCard = document.querySelector("main .card");
  if (!preview || !formCard) return;
  const height = formCard.offsetHeight;
  if (height > 0) {
    preview.style.height = `${height}px`;
  }
}

function getBorderStyle(size) {
  if (size === "thin") return "1px solid #ddd";
  if (size === "medium") return "2px solid #ccc";
  if (size === "bold") return "3px solid #bbb";
  return "0";
}

function updateSsoOptionsVisibility() {
  const enabled = isSsoDemoEnabled();
  $("excludeCVV").disabled = !enabled;
  $("excludePhoneNumber").disabled = !enabled;
  $("excludeEmail").disabled = !enabled;
  $("ssoPayload").disabled = !enabled;
  const ssoDetails = $("ssoOptions");
  if (ssoDetails) {
    ssoDetails.open = !!enabled;
  }
  if (!enabled) {
    $("excludeCVV").checked = false;
    $("excludePhoneNumber").checked = false;
    $("excludeEmail").checked = false;
  }
}

function applySsoPromptRules() {
  if (!isSsoDemoEnabled()) return;
  const excludeCVV = $("excludeCVV").checked;
  const excludePhoneNumber = $("excludePhoneNumber").checked;
  const excludeEmail = $("excludeEmail").checked;
  const contactPrompted = excludePhoneNumber || excludeEmail;

  if (excludeCVV && contactPrompted) {
    $("excludePhoneNumber").checked = false;
    $("excludeEmail").checked = false;
  }

  $("excludePhoneNumber").disabled = excludeCVV || !isSsoDemoEnabled();
  $("excludeEmail").disabled = excludeCVV || !isSsoDemoEnabled();
  $("excludeCVV").disabled = contactPrompted || !isSsoDemoEnabled();
}

function updateSsoPayloadPreview() {
  if (!isSsoDemoEnabled()) return;
  const payload = buildSsoRequestFromForm();
  $("ssoPayload").value = JSON.stringify(payload, null, 2);
}

function updateMerchantSiteTagsLabel() {
  const selectedTags = getSelectedMerchantSiteTags();
  const toggle = $("merchantSiteTagsToggle");
  if (!toggle) return;
  if (!selectedTags.length) {
    toggle.textContent = "Select tags";
    return;
  }
  toggle.textContent = `${selectedTags.length} selected`;
}

function toggleMerchantSiteTagsMenu(forceOpen) {
  const container = $("merchantSiteTags");
  const toggle = $("merchantSiteTagsToggle");
  if (!container || !toggle) return;
  const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !container.classList.contains("open");
  container.classList.toggle("open", shouldOpen);
  toggle.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
}

document.querySelectorAll(".form input, .form select").forEach((el) => {
  if (el.id === "configOverride") return;
  const eventName = el.type === "radio" || el.type === "checkbox" ? "change" : "input";
  el.addEventListener(eventName, updateOverridePreview);
});
updateOverridePreview();

function isSsoDemoEnabled() {
  return SSO_DEMO_ENABLED && $("ssoEnabled").checked;
}

function disableSsoDemoUi() {
  if (SSO_DEMO_ENABLED) return;
  const toggle = $("ssoEnabled");
  if (!toggle) return;
  toggle.checked = false;
  toggle.disabled = true;
}

// disableSsoDemoUi(); // Temporarily disabled for debugging

// Track FI host and restore selection after page reload
const fiHostElement = $("fiHost");
if (fiHostElement) {
  // Restore previously selected FI host from sessionStorage
  const savedFiHost = sessionStorage.getItem('selected_fi_host');
  if (savedFiHost && savedFiHost !== fiHostElement.value) {
    console.log('[SSO DEBUG] Restoring FI host selection:', savedFiHost);
    fiHostElement.value = savedFiHost;
  }

  const trackedFiHost = fiHostElement.value;
  console.log('[SSO DEBUG] Attaching FI host change listener. Initial value:', trackedFiHost);

  fiHostElement.addEventListener("change", () => {
    const newFiHost = fiHostElement.value;
    console.log('[SSO DEBUG] ========== FI HOST DROPDOWN CHANGED ==========');
    console.log(`  Previous: ${trackedFiHost}`);
    console.log(`  New: ${newFiHost}`);

    if (trackedFiHost !== newFiHost) {
      console.log('[SSO DEBUG] FI host changed - saving selection and reloading page');
      // Save the new selection before reloading
      sessionStorage.setItem('selected_fi_host', newFiHost);
      // Force a full page reload to completely reset everything
      window.location.reload();
    }
  });
} else {
  console.error('[SSO DEBUG] ERROR: Could not find fiHost element!');
}

$("ssoEnabled").addEventListener("change", () => {
  updateSsoOptionsVisibility();
  if (isSsoDemoEnabled()) {
    $("excludeCVV").checked = true;
  }
  applySsoPromptRules();
  updateSsoPayloadPreview();
  updateOverridePreview();
});

["excludeCVV", "excludePhoneNumber", "excludeEmail"].forEach((id) => {
  $(id).addEventListener("change", () => {
    applySsoPromptRules();
    updateSsoPayloadPreview();
    updateOverridePreview();
  });
});

updateSsoOptionsVisibility();
applySsoPromptRules();
updateSsoPayloadPreview();

updateMerchantSiteTagsLabel();
$("merchantSiteTagsToggle").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleMerchantSiteTagsMenu();
});
document.addEventListener("click", (event) => {
  const container = $("merchantSiteTags");
  if (!container || !container.classList.contains("open")) return;
  if (!container.contains(event.target)) {
    toggleMerchantSiteTagsMenu(false);
  }
});
document.querySelectorAll("#merchantSiteTags input[type=\"checkbox\"]").forEach((checkbox) => {
  checkbox.addEventListener("change", () => {
    updateMerchantSiteTagsLabel();
    updateOverridePreview();
  });
});

initSsoDebug();
syncPreviewHeightToForm();

function isSafari() {
  const ua = navigator.userAgent;
  return /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
}

function preventScrollChaining(container) {
  if (!container || !isSafari()) return;

  let touchStartY = 0;

  const atTop = () => container.scrollTop <= 0;
  const atBottom = () =>
    container.scrollTop + container.clientHeight >= container.scrollHeight;

  container.addEventListener(
    "wheel",
    (event) => {
      const delta = event.deltaY;
      if ((delta < 0 && atTop()) || (delta > 0 && atBottom())) {
        event.preventDefault();
      }
    },
    { passive: false }
  );

  container.addEventListener(
    "touchstart",
    (event) => {
      touchStartY = event.touches[0]?.clientY || 0;
    },
    { passive: true }
  );

  container.addEventListener(
    "touchmove",
    (event) => {
      const currentY = event.touches[0]?.clientY || 0;
      const delta = touchStartY - currentY;
      if ((delta < 0 && atTop()) || (delta > 0 && atBottom())) {
        event.preventDefault();
      }
    },
    { passive: false }
  );
}

preventScrollChaining($("preview"));
