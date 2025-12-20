const $ = (id) => document.getElementById(id);

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
  const ssoEnabled = $("ssoEnabled").checked;
  const closeUrl = normalizeCloseUrl($("closeUrl").value, hostname);

  const base = {
    config: {
      app_container_id: "cardupdatr-frame",
      hostname,
      financial_institution: fiHost.split(".")[0] || "",
      overlay: $("overlayEnabled").checked,
      close_url: closeUrl,
      exclude_sites: parseCommaList($("excludeSites").value),
      merchant_site_tags: merchantSiteTags,
      countries_supported: parseCommaList($("countriesSupported").value)
    },
    style: {
      card_description: $("cardDescription").value.trim(),
      final_message: $("finalMessage").value.trim(),
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

  const cardsavrServer = inferCardsavrServer($("fiHost").value);
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
    cardsavr_server: cardsavrServer
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
  const response = await fetch(SSO_LAMBDA_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error("SSO demo gateway returned an error.");
  }

  const apiResponse = await response.json();
  if (!apiResponse?.grant || !apiResponse?.cardId) {
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
  const script = document.getElementById("cardupdatr-script");
  const desiredSrc = `${hostname}cardupdatr-client-v2.js`;

  if (!forceReload && script && script.src === desiredSrc && typeof window.embedCardUpdatr === "function") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const newScript = document.createElement("script");
    newScript.id = "cardupdatr-script";
    newScript.defer = true;
    newScript.src = desiredSrc;
    newScript.onload = () => resolve();
    newScript.onerror = () => reject(new Error("Failed to load CardUpdatr script."));

    if (forceReload) {
      window.embedCardUpdatr = undefined;
      window.initCardupdatr = undefined;
    }

    if (script && script.parentNode) {
      script.parentNode.replaceChild(newScript, script);
    } else {
      document.body.appendChild(newScript);
    }
  });
}

async function renderPreview(settings, { resetSession = false } = {}) {
  const integrationType = getRadioValue("integrationType", "embedded");
  const preview = $("preview");

  if (integrationType === "weblink") {
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
    if (typeof window.embedCardUpdatr !== "function") {
      setStatus("CardUpdatr script loaded, but embedCardUpdatr is missing.");
      return;
    }
    if (typeof window.initCardupdatr === "function") {
      window.initCardupdatr(settings);
      // Some builds render on init; only embed if the container is still empty.
      setTimeout(() => {
        const frame = $("cardupdatr-frame");
        if (!frame || frame.children.length === 0) {
          window.embedCardUpdatr(settings);
        }
        setStatus("Loaded.");
      }, 50);
      return;
    }
    window.embedCardUpdatr(settings);
    setStatus("Loaded.");
  } catch (e) {
    setStatus(`Embed failed: ${e?.message || e}`);
  }
}

function clearCardupdatrStorage() {
  const keyPattern = /cardupdatr|cardsavr/i;
  const clearMatchingKeys = (storage) => {
    if (!storage) return;
    Object.keys(storage).forEach((key) => {
      if (keyPattern.test(key)) {
        storage.removeItem(key);
      }
    });
  };
  clearMatchingKeys(sessionStorage);
  clearMatchingKeys(localStorage);
}

$("loadBtn").addEventListener("click", () => {
  (async () => {
    setStatus("Loading…");
    const settings = buildConfigFromForm();
    const resetSession = $("resetSession").checked;
    if (resetSession) {
      clearCardupdatrStorage();
    }
    if ($("ssoEnabled").checked) {
      try {
        setStatus("Fetching SSO grant…");
        const rawPayload = $("ssoPayload").value;
        const payload = rawPayload.trim()
          ? safeParseJson(rawPayload)
          : buildSsoRequestFromForm();
        const apiResponse = await fetchSsoGrant(payload);
        settings.user = {
          ...settings.user,
          grant: apiResponse.grant,
          card_id: apiResponse.cardId
        };
      } catch (e) {
        setStatus(`SSO demo failed: ${e?.message || e}`);
        return;
      }
    }
    renderPreview(settings, { resetSession }).catch((e) => {
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

function getBorderStyle(size) {
  if (size === "thin") return "1px solid #ddd";
  if (size === "medium") return "2px solid #ccc";
  if (size === "bold") return "3px solid #bbb";
  return "0";
}

function updateSsoOptionsVisibility() {
  const enabled = $("ssoEnabled").checked;
  $("excludeCVV").disabled = !enabled;
  $("excludePhoneNumber").disabled = !enabled;
  $("excludeEmail").disabled = !enabled;
  $("ssoPayload").disabled = !enabled;
  if (!enabled) {
    $("excludeCVV").checked = false;
    $("excludePhoneNumber").checked = false;
    $("excludeEmail").checked = false;
  }
}

function applySsoPromptRules() {
  const excludeCVV = $("excludeCVV").checked;
  const excludePhoneNumber = $("excludePhoneNumber").checked;
  const excludeEmail = $("excludeEmail").checked;
  const contactPrompted = excludePhoneNumber || excludeEmail;

  if (excludeCVV && contactPrompted) {
    $("excludePhoneNumber").checked = false;
    $("excludeEmail").checked = false;
  }

  $("excludePhoneNumber").disabled = excludeCVV || !$("ssoEnabled").checked;
  $("excludeEmail").disabled = excludeCVV || !$("ssoEnabled").checked;
  $("excludeCVV").disabled = contactPrompted || !$("ssoEnabled").checked;
}

function updateSsoPayloadPreview() {
  if (!$("ssoEnabled").checked) return;
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

$("ssoEnabled").addEventListener("change", () => {
  updateSsoOptionsVisibility();
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
