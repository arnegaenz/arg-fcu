// GA4 Measurement Protocol — fire page_view events to the test GA property
// after each synthetic placement runs. Lets the SIS funnel-customer GA Page
// Views tiles populate for synthetic FIs (argfcu, etc.) the same way they
// would for real cardholder traffic.
//
// Env vars (set in PM2 ecosystem.config.cjs alongside SIS_API_BASE):
//   SIS_GA_MEASUREMENT_ID=G-XXXXXXXXXX   (from GA4 Data Stream details)
//   SIS_GA_API_SECRET=...                 (from GA4 Data Stream → Measurement Protocol API secrets)
//
// If either is missing, all GA calls no-op cleanly — runner keeps running.

const MEASUREMENT_ID = process.env.SIS_GA_MEASUREMENT_ID || "";
const API_SECRET = process.env.SIS_GA_API_SECRET || "";
const COLLECT_URL = `https://www.google-analytics.com/mp/collect?measurement_id=${MEASUREMENT_ID}&api_secret=${API_SECRET}`;

// Generate a stable-per-placement client_id so GA4 attributes all events in
// a placement to one user/session. Random per placement so consecutive
// placements look like different visitors.
function newClientId() {
  return `${Math.floor(Math.random() * 1e10)}.${Math.floor(Math.random() * 1e10)}`;
}

// Decide which funnel pages a placement traversed based on its summary.
// Matches the way real cardholders move through the browser funnel.
function pagesForOutcome({ outcome, isSso }) {
  const select = "/select-merchants";
  const userData = "/user-data-collection";
  const credentials = "/credential-entry";

  switch (outcome) {
    case "success":
      // Got all the way through.
      return isSso ? [select, credentials] : [select, userData, credentials];
    case "failure":
      // Reached credentials but failed there.
      return isSso ? [select, credentials] : [select, userData, credentials];
    case "abandon_credential_entry":
      // Reached credentials but abandoned before submitting.
      return isSso ? [select, credentials] : [select, userData, credentials];
    case "abandon_user_data":
      // Reached user-data but abandoned. SSO doesn't have this step.
      return isSso ? [select] : [select, userData];
    case "abandon_select_merchant":
      // Reached the select-merchants page but didn't pick anything.
      return [select];
    case "timeout":
    case "error":
      // Don't know how far they got — assume at least the landing happened.
      return [];
    default:
      return [];
  }
}

async function postOne(payload) {
  try {
    const res = await fetch(COLLECT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.warn(`[ga-events] POST returned ${res.status}`);
    }
  } catch (err) {
    console.warn(`[ga-events] POST failed: ${err.message}`);
  }
}

// Fire 1-3 page_view events per placement, one POST per page.
// All events share a client_id + session_id so GA4 stitches them as one session.
export async function firePageViewsForPlacement({ host, fiKey, outcome, isSso }) {
  if (!MEASUREMENT_ID || !API_SECRET) return; // not configured → no-op
  const pages = pagesForOutcome({ outcome, isSso });
  if (!pages.length) return;
  const clientId = newClientId();
  const sessionId = Date.now().toString();
  const baseUrl = `https://${host}`;
  for (const page of pages) {
    await postOne({
      client_id: clientId,
      events: [
        {
          name: "page_view",
          params: {
            page_location: baseUrl + page,
            page_title: page.slice(1).replace(/-/g, " "),
            session_id: sessionId,
            engagement_time_msec: 1,
            // Custom dimension — only useful if registered in GA4 Admin.
            // Won't break anything if not registered.
            fi_lookup_key: fiKey || "",
          },
        },
      ],
    });
  }
}

// Translate a single-placement summary line into outcome strings the
// pages-for-outcome mapper recognizes. Called once per placement from
// run-sis-jobs.js.
export function outcomesFromSummary(summary = {}) {
  const out = [];
  const push = (n, kind) => { for (let i = 0; i < Number(n || 0); i += 1) out.push(kind); };
  push(summary.success, "success");
  push(summary.failure, "failure");
  push(summary.abandon_credential_entry, "abandon_credential_entry");
  push(summary.abandon_user_data, "abandon_user_data");
  push(summary.abandon_select_merchant, "abandon_select_merchant");
  push(summary.timeout, "timeout");
  push(summary.error, "error");
  return out;
}
