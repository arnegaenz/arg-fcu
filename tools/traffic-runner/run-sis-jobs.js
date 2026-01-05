import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

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

function normalizeFiHost(value) {
  if (!value) return "";
  const trimmed = value.toString().trim();
  if (trimmed.includes(".")) return trimmed;
  return FI_HOST_MAP[trimmed] || trimmed;
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
  integrationTest.cardholder = job.test_card_preset || integrationTest.cardholder || "";
  integrationTest.testerName = job.source_subcategory || integrationTest.testerName || "";
  integrationTest.source = {
    ...(integrationTest.source || {}),
    type: job.source_type || integrationTest.source?.type || "",
    category: job.source_category || integrationTest.source?.category || "",
    subCategory: job.source_subcategory || integrationTest.source?.subCategory || ""
  };

  return {
    ...baseConfig,
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

async function postResults(jobId, payload) {
  await fetchJson(`${API_BASE}/api/synth/jobs/${jobId}/results`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

async function main() {
  if (!API_BASE) {
    throw new Error("SIS_API_BASE is required");
  }
  const baseConfig = loadBaseConfig();
  const data = await fetchJson(`${API_BASE}/api/synth/jobs`);
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const dueJobs = jobs.filter((job) => job?.due && job.status !== "canceled" && job.status !== "completed");

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
    const { summary } = runTests(tmpConfig, runs);
    const success = Number(summary.success || 0);
    const failure = Number(summary.failure || 0);
    const abandonSelect = Number(summary.abandon_select_merchant || 0);
    const abandonUser = Number(summary.abandon_user_data || 0);
    const abandonCredential = Number(summary.abandon_credential_entry || 0);
    const timeout = Number(summary.timeout || 0);
    const error = Number(summary.error || 0);
    const attempted = Number(summary.total || success + failure + abandonSelect + abandonUser + abandonCredential + timeout + error);
    const placementsFailed = failure + timeout + error;
    const placementsAbandoned = abandonSelect + abandonUser + abandonCredential;

    await postResults(job.id, {
      attempted,
      placements_success: success,
      placements_failed: placementsFailed,
      placements_abandoned: placementsAbandoned,
      abandon_select_merchant: abandonSelect,
      abandon_user_data: abandonUser,
      abandon_credential_entry: abandonCredential,
      last_run_at: new Date().toISOString()
    });
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
