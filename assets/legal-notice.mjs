const IDS = ["notice", "terms", "risk", "eligibility", "privacy"];
const HASH = /^[a-f\d]{64}$/;

export function validateDraftManifest(value) {
  if (value?.schema !== "cre8/legal-draft@2" || value.status !== "draft" || value.liveAllowed !== false || value.effectiveDate !== null || value.operator !== null || !Array.isArray(value.openMarkets) || value.openMarkets.length || !HASH.test(value.consentVersion || "")) throw new Error("Legal draft status could not be verified.");
  if (!Array.isArray(value.documents) || value.documents.length !== IDS.length || IDS.some((id) => value.documents.filter((doc) => doc?.id === id).length !== 1)) throw new Error("Legal document list is incomplete.");
  for (const doc of value.documents) if (!HASH.test(doc.sha256 || "") || typeof doc.version !== "string" || !doc.version.includes("draft") || typeof doc.title !== "string") throw new Error("Legal document version is unavailable.");
  return value;
}

export const RISK_NOTICE_VERSION = "2026-10-07-risk.5";

export function createPageRiskRecord(options, reviewedAt = new Date().toISOString()) {
  if (!Object.hasOwn(PAGE_NOTICES, options.page)) throw new Error("Unsupported risk notice page.");
  return {
    status: "risk-acknowledged", liveAllowed: false, riskVersion: RISK_NOTICE_VERSION,
    language: "en", reviewedAt, page: options.page,
  };
}

const DEPOSITOR_NOTICE = {
  id: "depositor",
  audience: "For depositors",
  title: "Before you explore funds",
  points: [
    "<strong>You could lose all your capital.</strong> Markets, smart contracts and third-party protocols carry risks. Capital and returns are not guaranteed.",
    "<strong>Review each fund before depositing.</strong> Read its Fund facts and check the mandate, plan, fees, AI agent permissions and withdrawal conditions.",
    "<strong>AI agents can act within the fund's mandate.</strong> An AI agent can operate without your approval for each transaction. Risk controls cannot guarantee a limit on losses.",
  ],
};
// The fund list and each fund page share the depositor notice, so hiding it once covers both.
const PAGE_NOTICES = {
  vaults: DEPOSITOR_NOTICE,
  vault: { ...DEPOSITOR_NOTICE, title: "Before you deposit" },
  create: {
    id: "creator",
    audience: "For fund creators",
    title: "Before you create a fund",
    points: [
      "<strong>Review the fund setup before launch.</strong> Check the thesis, assets, destinations, investment limits, fees and mandate you are configuring.",
      "<strong>Your seed is at risk.</strong> The seed deposit is exposed to strategy losses. Maintain the minimum creator shareholding while other holders remain.",
      "<strong>Choose the AI agent carefully.</strong> It can act within the fund's mandate without your approval for each transaction. Replacing it requires a governance delay.",
    ],
  },
};

// "Don't show this again" is kept only in this browser: per notice version, for the last wallet connected here
// (or for the browser when none has been). It never records a transaction and is never uploaded.
const MEMORY_KEY = "cre8.notices", WALLET_KEY = "cre8.wallet";
const viewer = () => { try { return globalThis.localStorage?.getItem(WALLET_KEY) || "browser"; } catch { return "browser"; } };
const memoryId = (notice) => `${notice.id}@${RISK_NOTICE_VERSION}`;
function readMemory() { try { const value = JSON.parse(globalThis.localStorage?.getItem(MEMORY_KEY) || "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; } }
export function noticeHidden(page) {
  const notice = PAGE_NOTICES[page], list = notice && readMemory()[memoryId(notice)];
  return Array.isArray(list) && list.includes(viewer());
}
export function hideNotice(page) {
  const notice = PAGE_NOTICES[page];
  if (!notice) return;
  try {
    const memory = readMemory(), id = memoryId(notice);
    memory[id] = [...new Set([...(Array.isArray(memory[id]) ? memory[id] : []), viewer()])];
    globalThis.localStorage?.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch { /* Without storage the notice simply shows again next visit. */ }
}


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

export async function reviewPageRisk(options, { url, leave }) {
  createPageRiskRecord(options); // Validate the page; this notice never binds a transaction.
  if (noticeHidden(options.page)) return { shown: false, reviewed: false, hidden: true, liveAllowed: false, riskVersion: RISK_NOTICE_VERSION };
  if (shownPages.has(options.page)) return { shown: false, reviewed: false, liveAllowed: false, riskVersion: RISK_NOTICE_VERSION };
  cancelReview();
  shownPages.add(options.page);
  const notice = PAGE_NOTICES[options.page];
  const dialog = document.createElement("dialog");
  dialog.className = "legal-notice-dialog";
  dialog.lang = "en";
  dialog.dataset.bavLegal = "";
  dialog.setAttribute("aria-labelledby", "cre8-risk-title");
  dialog.tabIndex = -1;
  dialog.innerHTML = `<form method="dialog" class="legal-notice-form">
    <header><span class="legal-notice-status">${notice.audience}</span></header>
    <h2 id="cre8-risk-title">${notice.title}</h2>
    <ol class="legal-notice-points">${notice.points.map((point) => `<li>${point}</li>`).join("")}</ol>
    <a class="legal-notice-risk-link" target="_blank" rel="noopener noreferrer">Read full risk disclosure (Chinese draft)</a>
    <p class="legal-notice-privacy">This notice does not sign a transaction or approve token spending.</p>
    <footer><label class="legal-notice-remember"><input type="checkbox" data-legal-remember> Don't show this again</label><button type="submit" class="btn" data-legal-continue>I understand the risks</button></footer>
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
    // The only way on is "I understand the risks"; with the box ticked it also stops showing for this wallet.
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (finished) return;
      if (dialog.querySelector("[data-legal-remember]").checked) hideNotice(options.page);
      finish(true);
    });
    // Escape means the visitor does not accept, so they leave the page.
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); if (finished) return; finish(false); leave?.(); });
    dialog.addEventListener("close", () => finish(false));
    // Open on the notice itself rather than on the disclosure link.
    try { dialog.showModal(); dialog.focus?.(); } catch { finish(false); }
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
    <header><span class="legal-notice-status">Before you deposit</span><button type="button" class="legal-notice-close" aria-label="Close fund facts reminder">×</button></header>
    <h2 id="cre8-prospectus-title">Have you read the Fund facts?</h2>
    <footer><button type="button" class="btn ghost" data-prospectus-read>Read fund facts</button><button type="submit" class="btn" data-prospectus-continue>Yes, continue</button></footer>
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
