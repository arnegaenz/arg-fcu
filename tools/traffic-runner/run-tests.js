import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { chromium } from "playwright";

function parseArgs(argv) {
  const args = { config: "./config.json", runs: null, failures: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--config") {
      args.config = argv[i + 1];
      i += 1;
    } else if (token === "--runs") {
      args.runs = Number(argv[i + 1]);
      i += 1;
    } else if (token === "--failures") {
      args.failures = Number(argv[i + 1]);
      i += 1;
    } else if (token === "--json") {
      args.json = true;
    }
  }
  return args;
}

function readConfig(configPath) {
  const fullPath = path.resolve(process.cwd(), configPath);
  const raw = fs.readFileSync(fullPath, "utf8");
  return JSON.parse(raw);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html";
  if (ext === ".js") return "application/javascript";
  if (ext === ".css") return "text/css";
  if (ext === ".json") return "application/json";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function startStaticServer(rootDir, port = 0) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url || "/");
    const safePath = path.normalize(urlPath).replace(/^\/+/, "");
    let filePath = path.join(rootDir, safePath);

    if (!filePath.startsWith(rootDir)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }

    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    const content = fs.readFileSync(filePath);
    res.setHeader("Content-Type", getContentType(filePath));
    res.end(content);
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, () => {
      resolve({
        server,
        port: server.address().port
      });
    });
  });
}

function normalizeSuccessRate(value) {
  if (value == null || Number.isNaN(value)) return 0;
  if (value > 1) return Math.min(value / 100, 1);
  return Math.max(value, 0);
}

function normalizeRate(value) {
  if (value == null || Number.isNaN(value)) return 0;
  if (value > 1) return Math.min(value / 100, 1);
  return Math.max(value, 0);
}

function pickCredentials(config, successRate, forceSuccess = null) {
  const isSuccess = forceSuccess == null ? Math.random() < successRate : forceSuccess;
  const pool = isSuccess ? config.credentials.success : config.credentials.failure;
  return { ...pool, expectedSuccess: isSuccess };
}

function buildRunPlan(totalRuns, failures) {
  if (!Number.isFinite(failures)) return null;
  const failCount = Math.max(0, Math.min(totalRuns, failures));
  const successCount = totalRuns - failCount;
  const plan = [
    ...Array(successCount).fill(true),
    ...Array(failCount).fill(false)
  ];
  for (let i = plan.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }
  return plan;
}

async function selectOptionIfPresent(page, selector, value) {
  if (!value) return;
  const el = page.locator(selector);
  if (await el.count()) {
    await page.selectOption(selector, value);
  }
}

async function fillIfPresent(page, selector, value) {
  if (value == null) return;
  const el = page.locator(selector);
  if (await el.count()) {
    await el.fill(value);
  }
}

async function waitForCardupdatrFrame(page, timeoutMs = 30000) {
  const iframeLocator = page.locator("iframe").first();
  try {
    await iframeLocator.waitFor({ state: "attached", timeout: timeoutMs });
    const iframeHandle = await iframeLocator.elementHandle();
    if (iframeHandle) {
      const frame = await iframeHandle.contentFrame();
      if (frame) return frame;
    }
  } catch (err) {
    // Fall through to frame scan.
  }

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frame = page.frames().find((entry) => {
      const url = entry.url();
      return /cardupdatr|cardsavr/i.test(url) && url.startsWith("http");
    });
    if (frame) return frame;
    await page.waitForTimeout(250);
  }

  const frameUrls = page.frames().map((entry) => entry.url());
  throw new Error(`Timed out waiting for CardUpdatr iframe. Frames: ${frameUrls.join(", ")}`);
}

async function clickByText(frame, text) {
  if (!text) return;
  const locator = frame.getByText(text, { exact: false }).first();
  await locator.waitFor({ state: "visible", timeout: 30000 });
  await locator.click();
}

async function clickBySelector(frame, selector) {
  if (!selector) return;
  const locator = frame.locator(selector).first();
  await locator.waitFor({ state: "visible", timeout: 30000 });
  await locator.click();
}

async function fillFieldByConfig(frame, config, value, { timeoutMs = 30000 } = {}) {
  if (!value) return;
  if (!config) {
    throw new Error("Missing field configuration for input.");
  }
  if (config.selector) {
    await frame.locator(config.selector).first().fill(value);
    return;
  }
  if (config.label) {
    const labelLocator = frame.getByLabel(config.label, { exact: false }).first();
    await labelLocator.waitFor({ state: "visible", timeout: timeoutMs });
    await labelLocator.fill(value);
    return;
  }
  if (config.placeholder) {
    const placeholderLocator = frame.getByPlaceholder(config.placeholder, { exact: false }).first();
    await placeholderLocator.waitFor({ state: "visible", timeout: timeoutMs });
    await placeholderLocator.fill(value);
    return;
  }
  throw new Error("Unable to locate field for input.");
}

async function clickButtonByText(frame, text, { timeoutMs = 30000 } = {}) {
  if (!text) return;
  const locator = frame.getByRole("button", { name: new RegExp(text, "i") });
  await locator.first().waitFor({ state: "visible", timeout: timeoutMs });
  await locator.first().click();
}

async function fillField(frame, config, value) {
  return fillFieldByConfig(frame, config, value);
}

async function waitForCredentialFields(frame, emailField, passwordField, timeoutMs = 30000) {
  const waitForField = async (config) => {
    if (!config) return;
    if (config.selector) {
      await frame.locator(config.selector).first().waitFor({ state: "visible", timeout: timeoutMs });
      return;
    }
    if (config.label) {
      await frame.getByLabel(config.label, { exact: false }).first().waitFor({ state: "visible", timeout: timeoutMs });
      return;
    }
    if (config.placeholder) {
      await frame.getByPlaceholder(config.placeholder, { exact: false }).first().waitFor({ state: "visible", timeout: timeoutMs });
    }
  };
  await waitForField(emailField);
  await waitForField(passwordField);
}

async function logFrameSummary(frame) {
  try {
    const summary = await frame.evaluate(() => {
      const textFrom = (node) => (node && node.textContent ? node.textContent.trim() : "");
      const buttons = Array.from(document.querySelectorAll("button"))
        .map((btn) => textFrom(btn))
        .filter(Boolean);
      const labels = Array.from(document.querySelectorAll("label"))
        .map((label) => textFrom(label))
        .filter(Boolean);
      const inputs = Array.from(document.querySelectorAll("input"))
        .map((input) => ({
          type: input.type || "",
          placeholder: input.placeholder || "",
          ariaLabel: input.getAttribute("aria-label") || ""
        }))
        .filter((entry) => entry.placeholder || entry.ariaLabel || entry.type);
      return { buttons, labels, inputs };
    });
    console.log("[Frame Summary]", JSON.stringify(summary, null, 2));
  } catch (err) {
    console.log(`[Frame Summary] Failed: ${err.message}`);
  }
}

async function waitForFinalState(frame, finalState) {
  const timeout = finalState?.timeoutMs || 30000;
  const start = Date.now();

  const resolveMatch = async (entry) => {
    if (!entry) return false;
    if (entry.selector) {
      const locator = frame.locator(entry.selector).first();
      if (await locator.isVisible()) return true;
      return false;
    }
    if (entry.text) {
      const locator = frame.getByText(entry.text, { exact: false }).first();
      if (await locator.isVisible()) return true;
    }
    return false;
  };

  while (Date.now() - start < timeout) {
    if (await resolveMatch(finalState?.success)) return "success";
    if (await resolveMatch(finalState?.failure)) return "failure";
    await frame.waitForTimeout(500);
  }
  return "timeout";
}

async function tryCloseFlow(frame, closeAction) {
  if (!closeAction) return;
  try {
    if (closeAction.buttonText) {
      await clickButtonByText(frame, closeAction.buttonText, { timeoutMs: closeAction.timeoutMs || 5000 });
      return;
    }
    if (closeAction.selector) {
      await clickBySelector(frame, closeAction.selector);
    }
  } catch (err) {
    console.log(`[Close Action] Skipped: ${err.message}`);
  }
}

async function runSingle(page, config, successRate, forcedSuccess) {
  const integration = config.integrationTest || {};
  if (integration.testFlow && integration.testFlow.startsWith("weblink")) {
    throw new Error("Weblink flows are not supported by the runner.");
  }
  await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });

  await selectOptionIfPresent(page, "#fiHost", integration.fiHost);
  await selectOptionIfPresent(page, "#testFlow", integration.testFlow);
  await selectOptionIfPresent(page, "#cardholder", integration.cardholder);
  await fillIfPresent(page, "#testerName", integration.testerName || "");

  const source = integration.source || {};
  await selectOptionIfPresent(page, "#sourceType", source.type);
  await selectOptionIfPresent(page, "#sourceCategory", source.category);
  await fillIfPresent(page, "#sourceSubCategory", source.subCategory || "");

  await page.locator("#loadTestBtn").click();
  await page.waitForTimeout(config.timeouts?.postLoadClickMs || 1000);

  const frame = await waitForCardupdatrFrame(page, config.timeouts?.iframeMs || 45000);

  const abandonRates = config.abandonRates || {};
  const abandonSelectRate = normalizeRate(abandonRates.selectMerchant);
  const abandonUserRate = normalizeRate(abandonRates.userData);
  const abandonCredentialRate = normalizeRate(abandonRates.credentialEntry);

  const merchantConfig = config.merchantSelection || {};
  if (merchantConfig.preSelectDelayMs) {
    try {
      const waitLabel = merchantConfig.searchLabel || "Search for sites";
      await frame.getByLabel(waitLabel, { exact: false }).first().waitFor({ state: "visible", timeout: 15000 });
    } catch (err) {
      // If the search field isn't found, still honor the pause.
    }
    console.log(`[Merchant Selection] Pausing ${merchantConfig.preSelectDelayMs}ms before selecting sites`);
    await frame.waitForTimeout(merchantConfig.preSelectDelayMs);
  }
  if (merchantConfig.searchText) {
    const searchField = merchantConfig.searchField || {
      label: merchantConfig.searchLabel || "Search for sites",
      placeholder: merchantConfig.searchPlaceholder || ""
    };
    try {
      await fillFieldByConfig(frame, searchField, merchantConfig.searchText);
    } catch (err) {
      console.log(`[Merchant Search] Unable to fill search input: ${err.message}`);
    }
  }
  for (const site of merchantConfig.sites || []) {
    await clickByText(frame, site);
  }
  if (Math.random() < abandonSelectRate) {
    await tryCloseFlow(frame, config.closeAction);
    return { outcome: "abandon_select_merchant", expectedSuccess: null };
  }

  if (merchantConfig.continueButtonSelector) {
    await clickBySelector(frame, merchantConfig.continueButtonSelector);
  } else if (merchantConfig.continueButtonText) {
    await clickButtonByText(frame, merchantConfig.continueButtonText);
  }

  if (Math.random() < abandonUserRate) {
    await frame.waitForTimeout(config.timeouts?.userDataAbandonMs || 1500);
    await tryCloseFlow(frame, config.closeAction);
    return { outcome: "abandon_user_data", expectedSuccess: null };
  }

  const creds = pickCredentials(config, successRate, forcedSuccess);
  const emailField = config.credentials.emailField || { label: config.credentials.emailLabel };
  const passwordField = config.credentials.passwordField || { label: config.credentials.passwordLabel };
  const submit = async () => {
    if (config.credentials.submitButtonSelector) {
      await clickBySelector(frame, config.credentials.submitButtonSelector);
    } else {
      await clickButtonByText(frame, config.credentials.submitButtonText);
    }
  };

  await waitForCredentialFields(frame, emailField, passwordField, config.timeouts?.credentialsMs || 30000);

  if (Math.random() < abandonCredentialRate) {
    await tryCloseFlow(frame, config.closeAction);
    return { outcome: "abandon_credential_entry", expectedSuccess: null };
  }

  if (creds.expectedSuccess) {
    await fillField(frame, emailField, creds.email);
    await fillField(frame, passwordField, creds.password);
    await submit();
  } else {
    const attempts = Math.max(1, Number(config.credentials.failureAttempts) || 2);
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await fillField(frame, emailField, creds.email);
      await fillField(frame, passwordField, creds.password);
      await submit();
      if (attempt < attempts - 1) {
        await frame.waitForTimeout(config.timeouts?.betweenCredentialAttemptsMs || 1500);
        await waitForCredentialFields(frame, emailField, passwordField, config.timeouts?.credentialsMs || 30000);
      }
    }
  }

  const outcome = await waitForFinalState(frame, config.finalState || {});

  await tryCloseFlow(frame, config.closeAction);

  return { outcome, expectedSuccess: creds.expectedSuccess };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = readConfig(args.config);
  const runs = Number.isFinite(args.runs) ? args.runs : config.runs || 1;
  const successRate = normalizeSuccessRate(config.successRate ?? 1);
  const runPlan = buildRunPlan(runs, args.failures);

  let server = null;
  if (!config.baseUrl) {
    const runnerDir = path.dirname(fileURLToPath(import.meta.url));
    const rootDir = path.resolve(runnerDir, "..", "..");
    const serverInfo = await startStaticServer(rootDir, config.serverPort ?? 0);
    server = serverInfo.server;
    config.baseUrl = `http://localhost:${serverInfo.port}/integration-test.html`;
  }

  const browser = await chromium.launch({ headless: config.headless !== false });
  const results = [];
  const runConfigSummary = {
    runs,
    failuresRequested: Number.isFinite(args.failures) ? args.failures : null,
    successRate,
    baseUrl: config.baseUrl,
    fiHost: config.integrationTest?.fiHost,
    testFlow: config.integrationTest?.testFlow,
    cardholder: config.integrationTest?.cardholder,
    source: config.integrationTest?.source || {},
    merchants: config.merchantSelection?.sites || [],
    failureAttempts: config.credentials?.failureAttempts || 1
  };
  console.log("[Run Config]", JSON.stringify(runConfigSummary, null, 2));

  try {
    for (let i = 0; i < runs; i += 1) {
      const contextOptions = {};
      if (config.geolocation) {
        contextOptions.geolocation = config.geolocation;
        contextOptions.permissions = ["geolocation"];
      }
      const context = await browser.newContext(contextOptions);
      const page = await context.newPage();

      console.log(`Run ${i + 1}/${runs} starting...`);
      try {
        const forcedSuccess = runPlan ? runPlan[i] : null;
        const result = await runSingle(page, config, successRate, forcedSuccess);
        results.push(result);
        const expectedLabel =
          result.expectedSuccess == null ? "n/a" : result.expectedSuccess ? "success" : "failure";
        console.log(`Run ${i + 1}: ${result.outcome} (expected ${expectedLabel})`);
      } catch (err) {
        const safeIndex = String(i + 1).padStart(2, "0");
        const screenshotPath = path.resolve(process.cwd(), `run-${safeIndex}-error.png`);
        try {
          await page.screenshot({ path: screenshotPath, fullPage: true });
          console.log(`Run ${i + 1}: saved screenshot ${screenshotPath}`);
          const frame = page.frames().find((entry) => entry !== page.mainFrame());
          if (frame) {
            await logFrameSummary(frame);
          }
        } catch (screenshotErr) {
          console.log(`Run ${i + 1}: screenshot failed (${screenshotErr.message})`);
        }
        results.push({ outcome: "error", error: err.message });
        console.log(`Run ${i + 1}: error (${err.message})`);
      }

      await context.close();
      if (config.delayBetweenRunsMs) {
        await new Promise((resolve) => setTimeout(resolve, config.delayBetweenRunsMs));
      }
    }
  } finally {
    await browser.close();
    if (server) {
      server.close();
    }
  }

  const summary = results.reduce(
    (acc, entry) => {
      acc.total += 1;
      acc[entry.outcome] = (acc[entry.outcome] || 0) + 1;
      return acc;
    },
    { total: 0 }
  );

  console.log("\nSummary:");
  Object.keys(summary).forEach((key) => {
    if (key === "total") return;
    console.log(`  ${key}: ${summary[key]}`);
  });

  if (args.json) {
    console.log(JSON.stringify({ summary }));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
