const IDS = ["notice", "terms", "risk", "eligibility", "privacy"];
const HASH = /^[a-f\d]{64}$/;

export function validateDraftManifest(value) {
  if (value?.schema !== "cre8/legal-draft@2" || value.status !== "draft" || value.liveAllowed !== false || value.effectiveDate !== null || value.operator !== null || !Array.isArray(value.openMarkets) || value.openMarkets.length || !HASH.test(value.consentVersion || "")) throw new Error("Legal draft status could not be verified.");
  if (!Array.isArray(value.documents) || value.documents.length !== IDS.length || IDS.some((id) => value.documents.filter((doc) => doc?.id === id).length !== 1)) throw new Error("Legal document list is incomplete.");
  for (const doc of value.documents) if (!HASH.test(doc.sha256 || "") || typeof doc.version !== "string" || !doc.version.includes("draft") || typeof doc.title !== "string") throw new Error("Legal document version is unavailable.");
  return value;
}

export const RISK_NOTICE_VERSION = "2026-10-07-risk.4";

export function createPageRiskRecord(options, reviewedAt = new Date().toISOString()) {
  if (!["vaults", "create"].includes(options.page)) throw new Error("Unsupported risk notice page.");
  return {
    status: "risk-acknowledged", liveAllowed: false, riskVersion: RISK_NOTICE_VERSION,
    language: "en", reviewedAt, page: options.page,
  };
}

const PAGE_NOTICES = {
  vaults: {
    audience: "For depositors",
    title: "Before you explore vaults",
    points: [
      "<strong>You could lose all your capital.</strong> Markets, smart contracts and third-party protocols carry risks. Capital and returns are not guaranteed.",
      "<strong>Review each vault before depositing.</strong> Read its Fund prospectus and check the strategy, fees, Agent permissions and withdrawal conditions.",
      "<strong>Agents can act within vault rules.</strong> An Agent can operate without your approval for each transaction. Risk controls cannot guarantee a limit on losses.",
    ],
  },
  create: {
    audience: "For vault creators",
    title: "Before you create a vault",
    points: [
      "<strong>Review the vault setup before launch.</strong> Check the assets, destinations, investment limits, fees and rules you are configuring.",
      "<strong>Your seed is at risk.</strong> The seed deposit is exposed to strategy losses. Maintain the minimum creator shareholding while other holders remain.",
      "<strong>Choose the Agent operator carefully.</strong> It can act within vault rules without your approval for each transaction. Replacing the operator requires a governance delay.",
    ],
  },
};

let active = null;
const shownPages = new Set();

export function cancelReview() {
  active?.finish(false);
}

export function resetPageVisit() {
  cancelReview();
  shownPages.clear();
}

export async function verifyDraftDocuments(assetUrl) {
  const response = await fetch(assetUrl("legal/manifest.json"), { cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Legal document versions could not be loaded.");
  const manifest = validateDraftManifest(await response.json());
  const digest = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))), (value) => value.toString(16).padStart(2, "0")).join("");
  await Promise.all(manifest.documents.map(async (doc) => {
    const result = await fetch(assetUrl(`legal/${doc.id}.md`), { cache: "no-store", signal: AbortSignal.timeout(10000) });
    if (!result.ok || await digest(await result.text()) !== doc.sha256) throw new Error("Legal documents changed or could not be verified. Refresh before continuing.");
  }));
  const binding = JSON.stringify(manifest.documents.map(({ id, version, sha256 }) => ({ id, version, sha256 })));
  if (await digest(binding) !== manifest.consentVersion) throw new Error("Legal document version binding is invalid.");
  return manifest;
}

export async function reviewPageRisk(options, { url }) {
  createPageRiskRecord(options); // Validate the page; this notice never binds a transaction.
  if (shownPages.has(options.page)) return { shown: false, reviewed: false, liveAllowed: false, riskVersion: RISK_NOTICE_VERSION };
  cancelReview();
  shownPages.add(options.page);
  const notice = PAGE_NOTICES[options.page];
  const dialog = document.createElement("dialog");
  dialog.className = "legal-notice-dialog";
  dialog.lang = "en";
  dialog.dataset.bavLegal = "";
  dialog.setAttribute("aria-labelledby", "cre8-risk-title");
  dialog.innerHTML = `<form method="dialog" class="legal-notice-form">
    <header><span class="legal-notice-status">${notice.audience}</span><button type="button" class="legal-notice-close" aria-label="Close risk reminder">×</button></header>
    <h2 id="cre8-risk-title">${notice.title}</h2>
    <ol class="legal-notice-points">${notice.points.map((point) => `<li>${point}</li>`).join("")}</ol>
    <a class="legal-notice-risk-link" target="_blank" rel="noopener noreferrer">Read full risk disclosure (Chinese draft)</a>
    <p class="legal-notice-privacy">Shown once when you enter this page. This notice does not sign a transaction or approve token spending.</p>
    <footer><button type="button" class="btn ghost" data-legal-cancel>Close</button><button type="submit" class="btn" data-legal-continue>I understand the risks</button></footer>
  </form>`;
  dialog.querySelector(".legal-notice-risk-link").href = url("risk");
  document.body.append(dialog);
  const form = dialog.querySelector("form");
  return new Promise((resolve) => {
    let finished = false;
    const previousFocus = document.activeElement;
    const finish = (reviewed) => {
      if (finished) return;
      finished = true;
      dialog.close(); dialog.remove();
      if (active?.dialog === dialog) active = null;
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve({ shown: true, reviewed, liveAllowed: false, riskVersion: RISK_NOTICE_VERSION, record: reviewed ? createPageRiskRecord(options) : null });
    };
    active = { dialog, finish };
    form.addEventListener("submit", (event) => { event.preventDefault(); finish(true); });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    dialog.addEventListener("close", () => finish(false));
    dialog.querySelector("[data-legal-cancel]").addEventListener("click", () => finish(false));
    dialog.querySelector(".legal-notice-close").addEventListener("click", () => finish(false));
    try { dialog.showModal(); } catch { finish(false); }
  });
}

export async function confirmFundProspectus({ onRead }) {
  cancelReview();
  const dialog = document.createElement("dialog");
  dialog.className = "legal-notice-dialog";
  dialog.lang = "en";
  dialog.dataset.bavLegal = "";
  dialog.setAttribute("aria-labelledby", "cre8-prospectus-title");
  dialog.innerHTML = `<form method="dialog" class="legal-notice-form">
    <header><span class="legal-notice-status">Before you deposit</span><button type="button" class="legal-notice-close" aria-label="Close prospectus reminder">×</button></header>
    <h2 id="cre8-prospectus-title">Have you read the Fund prospectus?</h2>
    <footer><button type="button" class="btn ghost" data-prospectus-read>Read prospectus</button><button type="submit" class="btn" data-prospectus-continue>Yes, continue</button></footer>
  </form>`;
  document.body.append(dialog);
  return new Promise((resolve) => {
    let finished = false;
    const previousFocus = document.activeElement;
    const finish = (confirmed) => {
      if (finished) return;
      finished = true;
      dialog.close(); dialog.remove();
      if (active?.dialog === dialog) active = null;
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(confirmed);
    };
    active = { dialog, finish };
    dialog.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); finish(true); });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
    dialog.addEventListener("close", () => finish(false));
    dialog.querySelector(".legal-notice-close").addEventListener("click", () => finish(false));
    dialog.querySelector("[data-prospectus-read]").addEventListener("click", () => { finish(false); onRead?.(); });
    try { dialog.showModal(); } catch { finish(false); }
  });
}
