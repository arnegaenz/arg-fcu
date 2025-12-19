const $ = (id) => document.getElementById(id);

const CARDUPDATR_SCRIPT_URL = "https://argfcu.customer-dev.cardupdatr.app/cardupdatr-client-v2.js";

function safeParseJson(text) {
  if (!text || !text.trim()) return null;
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`Invalid JSON in override: ${e.message}`); }
}

function buildConfigFromForm() {
  const fi = $("fi").value.trim() || "argfcu";

  const base = {
    // IMPORTANT: fix spelling vs older file
    financial_institution: fi,

    // Keep your common knobs
    merchantSiteTags: $("merchantSiteTags").value,
    deviceType: $("deviceType").value,

    // Container styling (your legacy code used a bunch of these fields)
    container: {
      width: $("containerWidth").value,
      heightPx: Number($("containerHeight").value || 900),
      border: $("border").value
    }
  };

  const override = safeParseJson($("configOverride").value);
  if (override) {
    // override shallow merges onto base (good enough for now)
    return { ...base, ...override };
  }
  return base;
}

function setStatus(msg) {
  $("status").textContent = msg || "";
}

function renderPreview(config) {
  const iframe = $("preview");
  iframe.style.height = `${config.container?.heightPx || 900}px`;

  // Build an isolated HTML doc inside the iframe
  const srcdoc = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial; }
    .wrap { padding: 12px; }
    .box { width: ${escapeHtml(config.container?.width || "100%")}; }
    .thin { border: 1px solid #ddd; border-radius: 12px; overflow: hidden; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="box ${config.container?.border === "thin" ? "thin" : ""}">
      <div id="cardupdatr-root"></div>
    </div>
  </div>

  <script src="${CARDUPDATR_SCRIPT_URL}"></script>
  <script>
    const config = ${JSON.stringify(config)};

    function fail(msg) {
      const el = document.getElementById("cardupdatr-root");
      el.innerHTML = "<div style='padding:12px;color:#b00;font-size:14px;white-space:pre-wrap;'>" + msg + "</div>";
    }

    try {
      if (typeof window.initCardupdatr !== "function") {
        fail("CardUpdatr script loaded, but window.initCardupdatr() was not found.\\nThe embed API may have changed.");
      } else if (typeof window.embedCardUpdatr !== "function") {
        fail("CardUpdatr script loaded, but window.embedCardUpdatr() was not found.\\nThe embed API may have changed.");
      } else {
        // Your legacy flow used init + embed. Keep that pattern.
        window.initCardupdatr(config);

        // Some versions expect a container id; others infer.
        // We try the common patterns safely.
        try {
          window.embedCardUpdatr("cardupdatr-root", config);
        } catch (e1) {
          try {
            window.embedCardUpdatr(config);
          } catch (e2) {
            fail("Embed failed.\\n\\n" + (e1?.message || e1) + "\\n" + (e2?.message || e2));
          }
        }
      }
    } catch (e) {
      fail("Unexpected error:\\n" + (e?.message || e));
    }
  </script>
</body>
</html>`;

  iframe.srcdoc = srcdoc;
}

// minimal HTML escaper for width string (e.g., "100%")
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[c]));
}

$("loadBtn").addEventListener("click", () => {
  try {
    setStatus("Loading…");
    const config = buildConfigFromForm();
    renderPreview(config);
    setStatus("Loaded (check preview + console if blank).");
  } catch (e) {
    setStatus(e.message || String(e));
  }
});

$("copyBtn").addEventListener("click", async () => {
  try {
    const config = buildConfigFromForm();
    await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    setStatus("Config copied to clipboard.");
  } catch (e) {
    setStatus(e.message || String(e));
  }
});