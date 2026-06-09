import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { firePageViewsForPlacement, outcomesFromSummary } from "./ga-events.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = (process.env.SIS_API_BASE || "").replace(/\/$/, "");
const ADMIN_KEY = process.env.SIS_ADMIN_KEY || "";
const CONFIG_PATH = process.env.RUNNER_CONFIG || "./config.json";
const JOB_LIMIT = Number(process.env.SIS_JOB_LIMIT || "5");

const FI_HOST_MAP = {
  argfcu: "argfcu.customer-dev.cardupdatr.app",
  orb_prod: "orb_prod.customer-dev.cardupdatr.app"
};

const CARDHOLDER_MAP = {
  default: "use_location"
};

function normalizeFiHost(value) {
  if (!value) return "";
  const trimmed = value.toString().trim();
  if (trimmed.includes(".")) return trimmed;
  return FI_HOST_MAP[trimmed] || trimmed;
}

function normalizeCardholder(value) {
  if (!value) return "";
  const trimmed = value.toString().trim();
  return CARDHOLDER_MAP[trimmed] || trimmed;
}

function normalizeRate(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
}

async function fetchJson(url, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (ADMIN_KEY) headers["x-sis-admin-key"] = ADMIN_KEY;
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (err) {
    const preview = text ? text.slice(0, 200) : "(empty)";
    throw new Error(`Invalid JSON from ${url} (status ${res.status}) -> ${preview}`);
  }
  if (!res.ok) {
    const message = data?.error || res.statusText || "Request failed";
    throw new Error(message);
  }
  return data;
}

function loadBaseConfig() {
  const fullPath = path.resolve(process.cwd(), CONFIG_PATH);
  const raw = fs.readFileSync(fullPath, "utf8");
  return JSON.parse(raw);
}

function buildJobConfig(job, baseConfig) {
  const integrationTest = { ...(baseConfig.integrationTest || {}) };
  integrationTest.fiHost = normalizeFiHost(job.fi_host_env || integrationTest.fiHost || "");
  integrationTest.testFlow = job.integration_flow || integrationTest.testFlow || "";
  integrationTest.cardholder = normalizeCardholder(
    job.test_card_preset || integrationTest.cardholder || ""
  );
  integrationTest.testerName = job.source_subcategory || integrationTest.testerName || "";
  integrationTest.source = {
    ...(integrationTest.source || {}),
    type: job.source_type || integrationTest.source?.type || "",
    category: job.source_category || integrationTest.source?.category || "",
    subCategory: job.source_subcategory || integrationTest.source?.subCategory || ""
  };

  return {
    ...baseConfig,
    headless: true,
    integrationTest,
    successRate: normalizeRate(job.target_success_rate, baseConfig.successRate),
    abandonRates: {
      selectMerchant: normalizeRate(job.abandon_select_merchant_rate, 0),
      userData: (job.integration_flow || "").toLowerCase().includes("_sso")
        ? 0
        : normalizeRate(job.abandon_user_data_rate, 0),
      credentialEntry: normalizeRate(job.abandon_credential_entry_rate, 0)
    }
  };
}

function computeRuns(job) {
  if (job.mode === "one_shot") {
    const remaining = Math.max(0, Number(job.total_runs || 0) - Number(job.attempted || 0));
    return remaining;
  }
  return 1;
}

function runTests(configPath, runs) {
  const args = ["node", path.join(__dirname, "run-tests.js"), "--config", configPath, "--runs", String(runs), "--json"];
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8" });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Runner failed");
  }
  const output = result.stdout.trim().split("\n");
  for (let i = output.length - 1; i >= 0; i -= 1) {
    const line = output[i].trim();
    if (line.startsWith("{") && line.endsWith("}")) {
      return JSON.parse(line);
    }
  }
  throw new Error("Runner JSON summary missing");
}

async function postResultsWithRetry(jobId, payload, retries = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await fetchJson(`${API_BASE}/api/synthetic-traffic/${jobId}/results`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      return;
    } catch (err) {
      lastError = err;
      console.log(`[SIS] Post results failed (attempt ${attempt}/${retries}): ${err.message}`);
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      }
    }
  }
  throw lastError;
}

async function markRunning(jobId) {
  await postResultsWithRetry(jobId, { status: "running", attempted: 0 });
}

async function main() {
  if (!API_BASE) {
    throw new Error("SIS_API_BASE is required");
  }
  const baseConfig = loadBaseConfig();
  const apiHost = (() => {
    try {
      return new URL(API_BASE).host;
    } catch {
      return "unknown";
    }
  })();
  console.log(`[SIS] Fetching jobs from ${apiHost}`);
  const data = await fetchJson(`${API_BASE}/api/synthetic-traffic`);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const dueJobs = jobs.filter((job) => job?.due && job.status !== "canceled" && job.status !== "completed");
  console.log(`[SIS] Jobs: ${jobs.length}, due: ${dueJobs.length}`);
  if (dueJobs.length) {
    console.log(`[SIS] Due job IDs: ${dueJobs.map((job) => job.id).join(", ")}`);
  }

  const limit = Math.max(1, JOB_LIMIT || dueJobs.length || 1);
  const selected = dueJobs.slice(0, limit);

  if (!selected.length) {
    console.log("No due jobs.");
    return;
  }

  for (const job of selected) {
    const runs = computeRuns(job);
    if (!runs) continue;
    const config = buildJobConfig(job, baseConfig);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "traffic-runner-"));
    const tmpConfig = path.join(tmpDir, "config.json");
    fs.writeFileSync(tmpConfig, JSON.stringify(config, null, 2));

    console.log(`Running job ${job.id} for ${runs} runs`);
    await markRunning(job.id);

    for (let i = 0; i < runs; i += 1) {
      const { summary } = runTests(tmpConfig, 1);
      const success = Number(summary.success || 0);
      const failure = Number(summary.failure || 0);
      const abandonSelect = Number(summary.abandon_select_merchant || 0);
      const abandonUser = Number(summary.abandon_user_data || 0);
      const abandonCredential = Number(summary.abandon_credential_entry || 0);
      const timeout = Number(summary.timeout || 0);
      const error = Number(summary.error || 0);
      const attempted = Number(
        summary.total ||
          success + failure + abandonSelect + abandonUser + abandonCredential + timeout + error
      );
      const placementsFailed = failure + timeout + error;
      const placementsAbandoned = abandonSelect + abandonUser + abandonCredential;

      await postResultsWithRetry(job.id, {
        attempted,
        placements_success: success,
        placements_failed: placementsFailed,
        placements_abandoned: placementsAbandoned,
        abandon_select_merchant: abandonSelect,
        abandon_user_data: abandonUser,
        abandon_credential_entry: abandonCredential,
        last_run_at: new Date().toISOString(),
        status: "running"
      });

      // Fire GA4 page_view events to the test property so the SIS GA Page
      // Views tiles populate for this FI. No-ops cleanly when the GA env
      // vars aren't configured. One client_id per simulated cardholder
      // (per outcome in the summary) so GA4 stitches them as separate
      // sessions.
      const host = normalizeFiHost(job.fi_host_env);
      const fiKey = (job.fi_host_env || "").toString().trim();
      const isSso = (job.integration_flow || "").toString().toLowerCase().includes("_sso");
      const outcomes = outcomesFromSummary(summary);
      for (const outcome of outcomes) {
        await firePageViewsForPlacement({ host, fiKey, outcome, isSso });
      }
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
