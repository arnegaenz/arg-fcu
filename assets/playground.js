const $ = (id) => document.getElementById(id);

const CARDUPDATR_HOST_SUFFIX = ".customer-dev.cardupdatr.app/";

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
  if (base.style_template || override.style_template) {
    merged.style_template = { ...base.style_template, ...override.style_template };
  }
  if (base.user || override.user) {
    merged.user = { ...base.user, ...override.user };
  }
  return merged;
}

function buildConfigFromForm() {
  const fi = $("fi").value.trim() || "argfcu";
  const hostname = `https://${fi}${CARDUPDATR_HOST_SUFFIX}`;
  const merchantSiteTag = $("merchantSiteTags").value;
  const devicePlatform = getRadioValue("devicePlatform", "desktop");

  const base = {
    config: {
      app_container_id: "cardupdatr-frame",
      hostname,
      financial_institution: fi,
      top_sites: parseCommaList($("topSites").value),
      exclude_sites: parseCommaList($("excludeSites").value),
      merchant_site_tags: merchantSiteTag ? [merchantSiteTag] : [],
      countries_supported: parseCommaList($("countriesSupported").value),
      device_platform: devicePlatform
    },
    style_template: {
      card_description: $("cardDescription").value.trim(),
      merchant_selection_message: $("merchantSelectionMessage").value.trim(),
      final_message: $("finalMessage").value.trim(),
      invalid_session_url: $("invalidSessionUrl").value.trim(),
      link_color: $("linkColor").value.trim(),
      button_color: $("buttonColor").value.trim(),
      border_color: $("borderColor").value.trim(),
      drop_shadow: $("dropShadow").checked,
      dynamic_height: $("dynamicHeight").checked
    }
  };

  const override = safeParseJson($("configOverride").value);
  if (override) {
    return mergeSettings(base, override);
  }
  return base;
}

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function renderPreview(settings) {
  const integrationType = getRadioValue("integrationType", "embedded");
  const preview = $("preview");

  if (integrationType === "weblink") {
    const width = parseInt($("containerWidth").value, 10) || 900;
    const height = parseInt($("containerHeight").value, 10) || 1100;
    window.open(
      settings.config.hostname,
      "",
      `width=${width},height=${height},scrollbars=no,resizable=no`
    );
    setStatus("Weblink launched.");
    return;
  }

  applyContainerStyles(preview);
  preview.innerHTML = '<div id="cardupdatr-frame"></div>';

  if (typeof window.embedCardUpdatr !== "function") {
    setStatus("CardUpdatr script not loaded yet.");
    return;
  }

  try {
    window.embedCardUpdatr(settings);
  } catch (e) {
    setStatus(`Embed failed: ${e?.message || e}`);
  }
}

$("loadBtn").addEventListener("click", () => {
  try {
    setStatus("Loading…");
    const settings = buildConfigFromForm();
    renderPreview(settings);
    setStatus("Loaded (check preview + console if blank).");
  } catch (e) {
    setStatus(e.message || String(e));
  }
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
  preview.style.background = $("containerBgColor").value || "transparent";
  preview.style.width = $("containerWidth").value || "100%";
  preview.style.height = $("containerHeight").value || "900px";
  preview.style.minHeight = $("containerMinHeight").value || "";
  preview.style.maxHeight = $("containerMaxHeight").value || "";
  preview.style.textAlign = $("containerTextAlign").value || "";
  preview.style.paddingTop = $("containerPadTop").value || "";
  preview.style.paddingBottom = $("containerPadBottom").value || "";
  preview.style.overflow = $("containerOverflow").value || "visible";
  preview.style.overscrollBehavior = $("containerOverscroll").value || "auto";
  preview.style.border = border === "thin" ? "1px solid #ddd" : "0";
}
