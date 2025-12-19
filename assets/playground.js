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

function buildBaseSettingsFromForm() {
  const fiHost = $("fiHost").value.trim();
  const hostname = `https://${fiHost}/`;
  const merchantSiteTag = $("merchantSiteTags").value;

  return {
    config: {
      app_container_id: "cardupdatr-frame",
      hostname,
      financial_institution: fiHost.split(".")[0] || "",
      overlay: $("overlayEnabled").checked,
      close_url: $("closeUrl").value.trim(),
      top_sites: parseCommaList($("topSites").value),
      exclude_sites: parseCommaList($("excludeSites").value),
      merchant_site_tags: merchantSiteTag ? [merchantSiteTag] : [],
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
  const merchantSelectionMessage = $("merchantSelectionMessage").value.trim();
  if (merchantSelectionMessage) {
    base.style.merchant_selection_message = merchantSelectionMessage;
  }
  return base;
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

function ensureCardupdatrScript(hostname) {
  const script = document.getElementById("cardupdatr-script");
  const desiredSrc = `${hostname}cardupdatr-client-v2.js`;

  if (script && script.src === desiredSrc && typeof window.embedCardUpdatr === "function") {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const newScript = document.createElement("script");
    newScript.id = "cardupdatr-script";
    newScript.defer = true;
    newScript.src = desiredSrc;
    newScript.onload = () => resolve();
    newScript.onerror = () => reject(new Error("Failed to load CardUpdatr script."));

    if (script && script.parentNode) {
      script.parentNode.replaceChild(newScript, script);
    } else {
      document.body.appendChild(newScript);
    }
  });
}

async function renderPreview(settings) {
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
    await ensureCardupdatrScript(settings.config.hostname);
    if (typeof window.embedCardUpdatr !== "function") {
      setStatus("CardUpdatr script loaded, but embedCardUpdatr is missing.");
      return;
    }
    window.embedCardUpdatr(settings);
    setStatus("Loaded.");
  } catch (e) {
    setStatus(`Embed failed: ${e?.message || e}`);
  }
}

$("loadBtn").addEventListener("click", () => {
  setStatus("Loading…");
  const settings = buildConfigFromForm();
  renderPreview(settings).catch((e) => {
    setStatus(e?.message || String(e));
  });
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

document.querySelectorAll(".form input, .form select").forEach((el) => {
  if (el.id === "configOverride") return;
  const eventName = el.type === "radio" || el.type === "checkbox" ? "change" : "input";
  el.addEventListener(eventName, updateOverridePreview);
});
updateOverridePreview();

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
