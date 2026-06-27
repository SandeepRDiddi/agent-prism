let dashboardState = null;
let dashboardAuditLogs = [];
let tenantSummary = null;
let tenantApiKeys = [];
let connectorCatalog = [];
let aiAdvisorState = null;
let currentUser = null;
let adminActionMessage = "";
let currentView = "overview";
let tenantApiKey = localStorage.getItem("acp_api_key") || "";
let certificationData = null; // lazy-loaded when Governance tab opens

// ── Token Coach: collapse/expand + savings detection ──────────────────────────
const expandedCoachCards = new Set(); // persists across re-renders
const COACH_SNAPSHOTS_KEY = "prism_coach_snapshots_v1";

function getCoachSnapshots() {
  try { return JSON.parse(localStorage.getItem(COACH_SNAPSHOTS_KEY) || "{}"); }
  catch { return {}; }
}

function saveCoachSnapshot(title, metricKey, metricValue, projectedMonthlyCost) {
  const all = getCoachSnapshots();
  if (all[title]) return; // only snapshot on first view
  all[title] = { title, metricKey, metricValueAtView: metricValue, projectedAtView: projectedMonthlyCost, shownAt: Date.now(), appliedVia: null, dismissed: false };
  localStorage.setItem(COACH_SNAPSHOTS_KEY, JSON.stringify(all));
}

function markCoachApplied(title) {
  const all = getCoachSnapshots();
  if (!all[title]) all[title] = { title, appliedVia: "button", shownAt: Date.now(), dismissed: false };
  else all[title].appliedVia = "button";
  localStorage.setItem(COACH_SNAPSHOTS_KEY, JSON.stringify(all));
}

function dismissCoachSaving(key) {
  const all = getCoachSnapshots();
  const safeKey = decodeURIComponent(key);
  if (all[safeKey]) all[safeKey].dismissed = true;
  localStorage.setItem(COACH_SNAPSHOTS_KEY, JSON.stringify(all));
  document.getElementById("coach-saving-" + key)?.remove();
}

function detectCoachSavings(efficiency) {
  const snapshots = getCoachSnapshots();
  const banners = [];
  for (const snap of Object.values(snapshots)) {
    if (snap.dismissed || snap.appliedVia === "button") continue;
    const current = efficiency[snap.metricKey];
    if (current === undefined || current === null) continue;
    // lower is better for all tracked metrics
    const improved = current < snap.metricValueAtView;
    if (!improved) continue;
    const prevMonthly = snap.projectedAtView || 0;
    const currMonthly = efficiency.projectedMonthlyCost || 0;
    const savedUsd = Math.max(0, prevMonthly - currMonthly);
    banners.push({ title: snap.title, metricKey: snap.metricKey, before: snap.metricValueAtView, after: current, savedUsd });
  }
  return banners;
}

window.coachToggleDetails = function(cardId) {
  const card = document.getElementById(cardId);
  if (!card) return;
  const expanding = !expandedCoachCards.has(cardId);
  // Accordion — close all others first
  if (expanding) {
    expandedCoachCards.forEach(otherId => {
      if (otherId !== cardId) {
        const other = document.getElementById(otherId);
        if (other) {
          other.classList.remove("coach-card--expanded");
          const b = other.querySelector(".coach-show-btn");
          if (b) b.innerHTML = "Show &#9662;";
        }
      }
    });
    expandedCoachCards.clear();
    expandedCoachCards.add(cardId);
  } else {
    expandedCoachCards.delete(cardId);
  }
  card.classList.toggle("coach-card--expanded", expanding);
  const btn = card.querySelector(".coach-show-btn");
  if (btn) btn.innerHTML = expanding ? "Hide &#9652;" : "Show &#9662;";
  if (expanding) {
    saveCoachSnapshot(card.dataset.title, card.dataset.metrickey,
      parseFloat(card.dataset.metricvalue || "0"), parseFloat(card.dataset.monthly || "0"));
  }
};

window.coachApply = function(cardId) {
  const card = document.getElementById(cardId);
  const title = card?.dataset.title || "";
  markCoachApplied(title);
  const btn = card?.querySelector(".coach-apply-btn");
  if (btn) {
    btn.textContent = "Applied ✓";
    btn.disabled = true;
    btn.classList.add("coach-apply-btn--done");
  }
};

window.dismissCoachSaving = dismissCoachSaving;
// ─────────────────────────────────────────────────────────────────────────────

function buildWorkspaceShell(tenantName) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  return `
  <section class="clean-dashboard">
    <div class="dash-top-row">
      <nav class="view-tabs" aria-label="Dashboard views">
        <button class="view-tab active" data-view="overview" type="button">Overview</button>
        <button class="view-tab" data-view="activity" type="button">Activity</button>
        <button class="view-tab" data-view="tokens" type="button">Token Coach</button>
        <button class="view-tab" data-view="governance" type="button">Governance</button>
        <button class="view-tab" data-view="advisor" type="button">Prompt Advisor</button>
        <button class="view-tab" data-view="live-sessions" type="button">&#x25CF; Live Sessions</button>
        <button class="view-tab" data-view="admin" type="button">Admin</button>
      </nav>
      <div class="command-ribbon">
        <div class="command-ribbon-left">
          <div>
            <div class="command-ribbon-title">${tenantName || "AI Governance Command Center"}</div>
            <div class="command-ribbon-sub">${dateStr}</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <div class="command-ribbon-stat"><span>Fleet status</span><strong id="ribbon-fleet">Loading…</strong></div>
          <div class="command-ribbon-stat"><span>Total spend</span><strong id="ribbon-spend">—</strong></div>
          <div class="command-ribbon-stat"><span>Reliability</span><strong id="ribbon-score">—</strong></div>
        </div>
      </div>
    </div>
    <section class="metrics-grid cockpit-metrics" id="metrics-grid"></section>
    <section class="view-content" id="view-content"></section>
  </section>
`;
}

const workspaceShell = buildWorkspaceShell("");

async function request(path, options) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options?.headers || {}),
      ...(tenantApiKey ? { "x-api-key": tenantApiKey } : {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.message || `Request failed for ${path}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function levelClass(level) {
  return `level-${level}`;
}

function statusClass(status) {
  return `status-${status.toLowerCase()}`;
}

async function renderSetupScreen(type, message = "") {
  const workspace = document.querySelector("#workspace");

  if (type === "bootstrap") {
    workspace.innerHTML = `
      <section class="setup-screen">
        <article class="panel setup-card">
          <p class="eyebrow">Bootstrap</p>
          <h2>Set up your first SaaS tenant</h2>
          <p class="usp-summary">Use the admin secret from <code>ACP_ADMIN_SECRET</code> to create the first tenant, owner, and tenant API key.</p>
          <form id="bootstrap-form">
            <input name="companyName" placeholder="Company name" required />
            <input name="adminName" placeholder="Admin name" required />
            <input name="adminEmail" type="email" placeholder="Admin email" required />
            <input name="adminPassword" type="password" placeholder="Owner login password" minlength="8" required />
            <input name="adminSecret" type="password" placeholder="Admin secret" required />
            <div class="setup-actions">
              <button type="submit">Bootstrap tenant</button>
            </div>
          </form>
          ${message ? `<p class="usp-summary">${escapeHtml(message)}</p>` : ""}
        </article>
      </section>
    `;

    document.querySelector("#bootstrap-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const adminSecret = String(form.get("adminSecret") || "");

      try {
        const result = await request("/api/bootstrap", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-secret": adminSecret
          },
          body: JSON.stringify({
            companyName: form.get("companyName"),
            adminName: form.get("adminName"),
            adminEmail: form.get("adminEmail"),
            adminPassword: form.get("adminPassword")
          })
        });

        tenantApiKey = result.apiKey;
        localStorage.setItem("acp_api_key", tenantApiKey);
        await initializeApp();
      } catch (error) {
        renderSetupScreen("bootstrap", error.message);
      }
    });

    return;
  }

  if (type === "login") {
    let loginCfg = { ssoEnabled: false, ssoOnly: false };
    try { loginCfg = await (await fetch("/api/login-config")).json(); } catch (_) {}
    const { ssoEnabled, ssoOnly } = loginCfg;

    workspace.innerHTML = `
      <section class="login-hero">
        <div class="login-orbs">
          <div class="orb orb-1"></div>
          <div class="orb orb-2"></div>
          <div class="orb orb-3"></div>
        </div>
        <div class="login-grid"></div>
        <div class="matrix-grid-bg"></div>
        <article class="login-card-glass">
          <div class="login-logo-mark">AP</div>
          <div class="badge-glow"><span class="pulse-dot"></span>Enterprise AI Governance</div>
          <h1 class="login-headline">${ssoOnly ? "Enterprise" : "Command your"}<br><span class="login-gradient">${ssoOnly ? "Access Portal" : "AI fleet"}</span></h1>
          <p class="login-sub">AI governance &middot; Real-time control &middot; Zero surprises</p>
          <div class="login-form-wrap">
            ${ssoEnabled ? `
            <a href="/auth/sso/login" class="btn-sso" style="margin-bottom:1rem">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              Continue with SSO
            </a>` : ""}
            ${!ssoOnly ? `
            ${ssoEnabled ? `<div class="sso-divider"><span>or sign in with password</span></div>` : ""}
            <form id="login-form">
              <div class="login-field"><input name="email" type="email" placeholder="Work email" autocomplete="email" required /></div>
              <div class="login-field"><input name="password" type="password" placeholder="Password" autocomplete="current-password" minlength="8" required /></div>
              <button type="submit" class="login-submit-btn">Sign in &rarr;</button>
            </form>` : ""}
            ${message ? `<p class="login-error">${escapeHtml(message)}</p>` : ""}
          </div>
        </article>
      </section>
    `;

    if (!ssoOnly) {
      document.querySelector("#login-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        try {
          await request("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: form.get("email"),
              password: form.get("password")
            })
          });
          tenantApiKey = "";
          localStorage.removeItem("acp_api_key");
          await initializeApp();
        } catch (error) {
          renderSetupScreen("login", error.message);
        }
      });
    }

    return;
  }

  workspace.innerHTML = `
    <section class="setup-screen">
      <article class="panel setup-card">
        <p class="eyebrow">Tenant Access</p>
        <h2>Connect to a tenant workspace</h2>
        <p class="usp-summary">Paste the tenant API key that was created during bootstrap or later from your tenant admin settings.</p>
        <form id="api-key-form" class="field-stack">
          <input name="apiKey" placeholder="acp_..." required />
          <div class="setup-actions">
            <button type="submit">Connect tenant</button>
          </div>
        </form>
        <form id="generate-api-key-form" class="field-stack">
          <p class="usp-summary">Lost the tenant key? Enter the admin secret to generate and save a fresh browser dashboard key.</p>
          <input name="adminSecret" type="password" placeholder="Admin secret" required />
          <div class="setup-actions">
            <button type="submit">Generate key</button>
          </div>
        </form>
        ${message ? `<p class="usp-summary">${message}</p>` : ""}
      </article>
    </section>
  `;

  attachApiKeySetupForms("api-key");
}

function attachApiKeySetupForms(screenType) {
  document.querySelector("#api-key-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    tenantApiKey = String(form.get("apiKey") || "");
    localStorage.setItem("acp_api_key", tenantApiKey);
    await initializeApp();
  });

  document.querySelector("#generate-api-key-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const adminSecret = String(form.get("adminSecret") || "");

    try {
      const result = await fetch("/api/admin/api-keys", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": adminSecret
        },
        body: JSON.stringify({ name: "Browser dashboard key" })
      });

      if (!result.ok) {
        const payload = await result.json().catch(() => ({}));
        throw new Error(payload.message || "Could not generate tenant API key.");
      }

      const payload = await result.json();
      tenantApiKey = payload.apiKey;
      localStorage.setItem("acp_api_key", tenantApiKey);
      await initializeApp();
    } catch (error) {
      renderSetupScreen(screenType, error.message);
    }
  });
}

function renderMetrics(metrics) {
  const cards = [
    ["Active Agents", dashboardState.agentProfiles.length, "Connected fleet", "green"],
    ["Success Rate", `${metrics.successRate}%`, `${dashboardState.status.success} completed`, "violet"],
    ["Total Spend", currency(metrics.totalCostUsd), `${metrics.budgetUsedPercent}% of budget`, "amber"],
    ["Reliability Score", metrics.averageControlScore, `${Math.round(metrics.averageLatencyMs / 1000)}s avg latency`, "blue"]
  ];

  document.querySelector("#metrics-grid").innerHTML = cards
    .map(
      ([label, value, detail, tone]) => `
        <article class="metric-card reveal-on-scroll">
          <p class="eyebrow">${label}</p>
          <div class="metric-value ${tone}">${value}</div>
          <p>${detail}</p>
        </article>
      `
    )
    .join("");
  initScrollReveal();

  // update command ribbon quick stats
  const fleet = document.querySelector("#ribbon-fleet");
  const spend = document.querySelector("#ribbon-spend");
  const score = document.querySelector("#ribbon-score");
  if (fleet) fleet.textContent = `${dashboardState.agentProfiles.length} agents`;
  if (spend) spend.textContent = currency(metrics.totalCostUsd);
  if (score) {
    const s = metrics.averageControlScore;
    score.textContent = `${s}/100`;
    score.style.color = s >= 70 ? "#10b981" : s >= 55 ? "#f59e0b" : "#f87171";
  }
}

function providerInitial(provider) {
  return String(provider || "?").slice(0, 1).toUpperCase();
}

function topAgent() {
  return dashboardState.agentProfiles[0] || null;
}

function diagnoseAgent(a) {
  const run = a.latestRun || {};
  const issues = [];

  if ((run.retryCount || 0) > 2) {
    issues.push({
      tag: "Retries", color: "#f59e0b",
      why: `${run.retryCount} retries on last run`,
      fix: `Set max_retries = 2 in agent config. Add a hard exit condition for repeated task failures.`,
      verify: `Retry count ≤ 2 for next 5 runs`
    });
  }
  if ((run.policyViolations || 0) > 0) {
    issues.push({
      tag: "Policy", color: "#f87171",
      why: `${run.policyViolations} policy violation${run.policyViolations !== 1 ? "s" : ""} flagged`,
      fix: `Open Governance → Audit Trail, find this agent's entries, restrict the tool scopes causing violations.`,
      verify: `0 violations in next 10 consecutive runs`
    });
  }
  if ((run.budgetUsd || 0) > 0 && (run.costUsd || 0) > run.budgetUsd) {
    const over = ((run.costUsd || 0) - run.budgetUsd).toFixed(4);
    const suggest = ((run.costUsd || 0) * 1.3).toFixed(3);
    const altModel = (run.model || "").toLowerCase().includes("opus") ? "claude-sonnet-4-6" : "a smaller model tier";
    issues.push({
      tag: "Over Budget", color: "#f87171",
      why: `$${over} over budget on last run`,
      fix: `Option A: raise budget cap to $${suggest}. Option B: switch model to ${altModel}.`,
      verify: `costUsd ≤ budgetUsd for 5 consecutive runs`
    });
  }
  if ((run.latencyMs || 0) > 15000) {
    issues.push({
      tag: "Slow", color: "#f59e0b",
      why: `${((run.latencyMs || 0) / 1000).toFixed(1)}s latency on last run`,
      fix: `Reduce system prompt length. Split large tasks into smaller sub-agent calls.`,
      verify: `Latency below 10s for next 5 runs`
    });
  }
  const s = run.status || "";
  if (s && s !== "success" && s !== "completed" && s !== "running") {
    issues.push({
      tag: "Failed", color: "#f87171",
      why: `Last run status: ${s}`,
      fix: `Check Governance → Audit Trail for this agent. Add error handling / fallback in agent code.`,
      verify: `5 consecutive successful completions`
    });
  }
  if (!issues.length) {
    issues.push({
      tag: "Low Score", color: "#f59e0b",
      why: `Control score ${a.controlScore}/100 — below 70 threshold`,
      fix: `Open Token Coach to identify prompt inefficiencies. Review autonomy level settings.`,
      verify: `Score rises above 70`
    });
  }
  return issues.slice(0, 2);
}

function tokenStatCard(label, value, context, level) {
  const cls = level === "good" ? "green" : level === "warn" ? "amber" : level === "bad" ? "red" : "muted";
  return `<div class="token-stat-card">
    <span class="token-stat-label">${label}</span>
    <strong class="token-stat-value ${cls}">${value}</strong>
    <span class="token-stat-context">${context}</span>
  </div>`;
}

function renderOverview() {
  const m = dashboardState.headlineMetrics;
  const score = m.averageControlScore;
  const leaks = dashboardState.costLeaks || [];
  const leakCount = leaks.length;
  const providers = dashboardState.providerComparison.slice(0, 4);
  const allProfiles = dashboardState.agentProfiles || [];
  const overBudgetRuns = (dashboardState.recentRuns || []).filter((r) => r.costUsd > r.budgetUsd).length;

  const band = score >= 85
    ? { label: "Strong", color: "#10b981", bg: "rgba(16,185,129,0.08)", border: "rgba(16,185,129,0.2)", icon: "✓", desc: "Your AI fleet is performing above benchmark. Safe to scale." }
    : score >= 70
    ? { label: "Stable", color: "#60a5fa", bg: "rgba(96,165,250,0.08)", border: "rgba(96,165,250,0.2)", icon: "✓", desc: "Fleet operating within acceptable range. Monitor cost efficiency." }
    : score >= 55
    ? { label: "Needs Attention", color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)", icon: "⚠", desc: "Several agents underperforming. Review before scaling further." }
    : { label: "At Risk", color: "#f87171", bg: "rgba(248,113,113,0.08)", border: "rgba(248,113,113,0.2)", icon: "!", desc: "Fleet reliability below threshold. Immediate review required." };

  const atRiskAgents = allProfiles.filter((a) => a.controlScore < 70).slice(0, 3);
  const healthyAgents = allProfiles.filter((a) => a.controlScore >= 70).slice(0, 3);
  const leakSavings = currency(leakCount * 14);

  // SVG donut — 251.2 = 2π×40
  const circumference = 251.2;
  const filled = Math.round((score / 100) * circumference);

  const barRow = (label, pct, good, detail) => {
    const w = Math.min(100, Math.max(0, Math.round(pct)));
    const cls = good ? "exb--good" : w >= 50 ? "exb--warn" : "exb--crit";
    return `<div class="ex-bar-row">
      <div class="ex-bar-meta">
        <span class="ex-bar-label">${label}</span>
        <span class="ex-bar-val ${good ? "ex-good" : "ex-warn"}">${detail}</span>
      </div>
      <div class="ex-bar-track"><div class="ex-bar-fill ${cls}" style="width:${w}%"></div></div>
    </div>`;
  };

  document.querySelector("#view-content").innerHTML = `
    <section class="exec-overview">

      <!-- ── FLEET HEALTH (big left) ── -->
      <article class="panel exec-health-card">
        <p class="eyebrow">AI Fleet Health</p>

        <div class="exec-gauge-row">
          <div class="exec-gauge">
            <svg viewBox="0 0 100 100" class="gauge-svg">
              <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="9"/>
              <circle cx="50" cy="50" r="40" fill="none"
                stroke="${band.color}" stroke-width="9"
                stroke-dasharray="${filled} ${circumference}"
                stroke-linecap="round"
                transform="rotate(-90 50 50)"
                opacity="0.9"/>
            </svg>
            <div class="gauge-inner">
              <span class="gauge-num" style="color:${band.color}">${score}</span>
              <span class="gauge-denom">/100</span>
            </div>
          </div>
          <div class="exec-gauge-info">
            <div class="exec-band-pill" style="color:${band.color};background:${band.bg};border:1px solid ${band.border}">
              ${band.icon}&nbsp;${band.label}
            </div>
            <p class="exec-band-desc">${band.desc}</p>
            <div class="exec-kpi-row">
              <div class="exec-kpi"><span>${m.successRate}%</span><label>Success</label></div>
              <div class="exec-kpi"><span>${allProfiles.length}</span><label>Agents</label></div>
              <div class="exec-kpi"><span>${leakCount}</span><label>Leaks</label></div>
              <div class="exec-kpi"><span>${m.totalRuns.toLocaleString()}</span><label>Runs</label></div>
            </div>
          </div>
        </div>

        <div class="exec-bars">
          ${barRow("Task Success Rate", m.successRate, m.successRate >= 80, `${m.successRate}% completed successfully`)}
          ${barRow("Budget Control", Math.max(0, 100 - Math.max(0, m.budgetUsedPercent - 100)), m.budgetUsedPercent <= 100, overBudgetRuns > 0 ? `${overBudgetRuns} agents over budget` : `${m.budgetUsedPercent}% of budget used`)}
          ${barRow("Response Speed", Math.max(0, 100 - Math.round(m.averageLatencyMs / 200)), m.averageLatencyMs < 10000, `${(m.averageLatencyMs / 1000).toFixed(1)}s average latency`)}
          ${barRow("Policy Compliance", 100, true, "No policy violations detected")}
        </div>

        <div class="exec-what-it-means">
          <strong>What this means:</strong>
          ${score >= 70
            ? `Your AI agents are delivering reliable outcomes. ${leakCount > 0 ? `${leakCount} cost leaks identified — Token Coach shows where to recover savings.` : "Spend is inside policy limits."}`
            : `${atRiskAgents.length} agent${atRiskAgents.length !== 1 ? "s" : ""} need review before scaling. ${leakCount > 0 ? `${leakCount} cost leaks represent avoidable spend.` : ""}`
          }
        </div>
      </article>

      <!-- ── FINANCIAL GOVERNANCE ── -->
      <article class="panel exec-finance-card">
        <p class="eyebrow">Financial Governance</p>
        <div class="exec-spend-hero">${currency(m.totalCostUsd)}</div>
        <div class="exec-spend-sub">Total AI spend &middot; ${m.budgetUsedPercent}% of budget allocated</div>

        <div class="exec-finance-list">
          <div class="exec-fl-row">
            <span>Monthly forecast</span>
            <strong>${currency((m.projectedMonthlyCost || m.totalCostUsd * 2.2))}</strong>
          </div>
          <div class="exec-fl-row ${leakCount > 0 ? 'exec-fl-warn' : ''}">
            <span>Recoverable waste</span>
            <strong style="${leakCount > 0 ? 'color:#f59e0b' : ''}">${leakCount > 0 ? leakSavings + "/mo" : "None found"}</strong>
          </div>
          <div class="exec-fl-row">
            <span>Avg cost per run</span>
            <strong>${m.totalRuns > 0 ? currency(m.totalCostUsd / m.totalRuns) : "—"}</strong>
          </div>
        </div>

        <div class="exec-providers">
          <p class="eyebrow" style="margin-top:16px">Provider breakdown</p>
          ${providers.map((p) => `
            <div class="exec-provider-row">
              <div class="exec-provider-dot">${providerInitial(p.provider)}</div>
              <div class="exec-provider-info">
                <strong>${escapeHtml(p.provider)}</strong>
                <span>${p.runs} runs · ${p.successRate}% success</span>
              </div>
              <span class="exec-provider-cost">${currency(p.costUsd)}</span>
            </div>
          `).join("")}
        </div>
      </article>

      <!-- ── ACTION REQUIRED ── -->
      <article class="panel exec-action-card">
        <p class="eyebrow">${atRiskAgents.length > 0 ? "⚠ Action Required" : "✓ All Clear"}</p>

        ${atRiskAgents.length > 0 ? `
          <p class="exec-action-intro">${atRiskAgents.length} agent${atRiskAgents.length !== 1 ? "s" : ""} flagged — remediation steps below</p>
          <div class="playbook-list">
            ${atRiskAgents.map((a) => {
              const scoreColor = a.controlScore >= 55 ? "#f59e0b" : "#f87171";
              const issues = diagnoseAgent(a).slice(0, 1);
              return `
                <div class="playbook-item">
                  <div class="playbook-header">
                    <div class="exec-agent-dot" style="background:${scoreColor}"></div>
                    <strong class="playbook-agent-name">${escapeHtml(a.agentName)}</strong>
                    <span class="playbook-score-badge" style="color:${scoreColor}">score ${a.controlScore}</span>
                  </div>
                  ${issues.map(issue => `
                    <div class="playbook-issue">
                      <span class="playbook-tag" style="border-color:${issue.color};color:${issue.color}">${issue.tag}</span>
                      <div class="playbook-detail">
                        <div class="playbook-why">⚑ ${escapeHtml(issue.why)}</div>
                        <div class="playbook-fix">→ ${escapeHtml(issue.fix)}</div>
                        <div class="playbook-verify">✓ Done when: ${escapeHtml(issue.verify)}</div>
                      </div>
                    </div>
                  `).join("")}
                </div>`;
            }).join("")}
          </div>
        ` : `
          <p class="exec-action-intro">All ${allProfiles.length} agents operating within policy</p>
          ${healthyAgents.map((a) => `
            <div class="exec-agent-row">
              <div class="exec-agent-dot" style="background:#10b981"></div>
              <div class="exec-agent-info">
                <strong>${escapeHtml(a.agentName)}</strong>
                <span>${a.controlScore}/100 &middot; on target</span>
              </div>
              <div class="exec-agent-score" style="color:#10b981">${a.controlScore}</div>
            </div>
          `).join("")}
        `}

        <div class="exec-action-btns">
          <button class="exec-btn-primary js-nav-tab" data-tab="tokens">Token Coach →</button>
          <button class="exec-btn-ghost js-nav-tab" data-tab="governance">Audit Trail →</button>
        </div>
      </article>

      <!-- ── FLEET INTELLIGENCE (full-width second row) ── -->
      <article class="panel exec-intel-card">
        <div class="exec-intel-grid">

          <!-- Agent scoreboard -->
          <div class="exec-intel-section">
            <p class="eyebrow" style="margin-bottom:12px">Agent Scoreboard — by total spend</p>
            <div class="exec-scoreboard">
              <div class="exec-sb-head">
                <span>Agent</span><span>Workflow</span><span>Score</span><span>Runs</span><span>Spend</span>
              </div>
              ${(() => {
                const scoreMap = {};
                allProfiles.forEach(p => { scoreMap[p.agentName] = p.controlScore; });
                const eff = dashboardState.tokenEfficiency || {};
                const agents = (eff.topAgents || []).slice(0, 6);
                if (!agents.length) return `<p class="muted" style="font-size:0.8rem;padding:8px 0">No agent data yet</p>`;
                return agents.map(a => {
                  const sc = scoreMap[a.agentName] ?? "—";
                  const scColor = typeof sc === "number" ? (sc >= 70 ? "#10b981" : sc >= 55 ? "#f59e0b" : "#f87171") : "#8898b0";
                  const wf = (a.workflow || "general").replace(/-/g, " ");
                  return `<div class="exec-sb-row">
                    <span class="exec-sb-name" title="${escapeHtml(a.agentName)}">${escapeHtml(a.agentName)}</span>
                    <span class="exec-sb-wf">${escapeHtml(wf)}</span>
                    <span class="exec-sb-score" style="color:${scColor}">${sc}</span>
                    <span class="exec-sb-runs">${a.runs}</span>
                    <span class="exec-sb-cost">${currency(a.costUsd)}</span>
                  </div>`;
                }).join("");
              })()}
            </div>
          </div>

          <!-- Workflow breakdown + period snapshot -->
          <div class="exec-intel-section">
            <p class="eyebrow" style="margin-bottom:12px">Workflow Distribution</p>
            ${(() => {
              const eff = dashboardState.tokenEfficiency || {};
              const hotspots = (eff.workflowHotspots || []).slice(0, 5);
              if (!hotspots.length) return `<p class="muted" style="font-size:0.8rem">No workflow data yet</p>`;
              const maxTokens = Math.max(...hotspots.map(h => h.totalTokens), 1);
              return hotspots.map(h => {
                const pct = Math.round((h.totalTokens / maxTokens) * 100);
                const wf = (h.workflow || "general").replace(/-/g, " ");
                const retryFlag = h.retries > 0 ? `<span style="color:#f59e0b;font-size:0.7rem"> ⟳${h.retries}</span>` : "";
                return `<div class="exec-wf-row">
                  <div class="exec-wf-meta">
                    <span class="exec-wf-name">${escapeHtml(wf)}${retryFlag}</span>
                    <span class="exec-wf-stat">${h.runs} runs · ${compactNumber(h.avgTokensPerRun)}/run</span>
                  </div>
                  <div class="exec-wf-bar-wrap">
                    <div class="exec-wf-bar" style="width:${pct}%"></div>
                  </div>
                </div>`;
              }).join("");
            })()}

            <div class="exec-period-box">
              <p class="eyebrow" style="margin:16px 0 8px">This Period</p>
              <div class="exec-period-grid">
                <div><span>${m.totalRuns.toLocaleString()}</span><label>Total runs</label></div>
                <div><span class="${m.successRate >= 80 ? "green" : m.successRate >= 60 ? "amber" : "red"}">${m.successRate}%</span><label>Success rate</label></div>
                <div><span>${allProfiles.length}</span><label>Active agents</label></div>
                <div><span class="${leakCount > 0 ? "amber" : "green"}">${leakCount}</span><label>Cost leaks</label></div>
                ${dashboardState.mlAnalytics ? `<div><span class="${dashboardState.mlAnalytics.trendDirection === "rising" ? "red" : dashboardState.mlAnalytics.trendDirection === "falling" ? "green" : ""}">${{ rising:"↑ Rising", falling:"↓ Falling", stable:"→ Stable" }[dashboardState.mlAnalytics.trendDirection] || "—"}</span><label>Cost trend</label></div>` : ""}
                ${dashboardState.mlAnalytics?.anomalyCount > 0 ? `<div><span class="red">${dashboardState.mlAnalytics.anomalyCount}</span><label>Anomalies</label></div>` : ""}
              </div>
            </div>
          </div>

        </div>
      </article>

    </section>
  `;

  // wire nav buttons (CSP-safe — no onclick)
  document.querySelectorAll(".js-nav-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentView = btn.dataset.tab;
      renderCurrentView();
    });
  });
}

async function renderAdvisorView() {
  const vc = document.querySelector("#view-content");
  vc.innerHTML = `
    <section class="tab-stage">
      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Prompt Advisor</p>
          <h2>AI review of every prompt you sent</h2>
          <p class="panel-subtitle">Each prompt is scored 1–10, weaknesses identified, and a rewrite suggested.</p>
        </div>
        <div id="advisor-savings-bar" style="display:none;align-items:center;gap:14px;padding:12px 16px;border-radius:8px;background:rgba(78,204,163,0.08);border:1px solid rgba(78,204,163,0.25);margin-bottom:16px;">
          <span style="font-size:1.4rem;">💰</span>
          <div>
            <div style="font-weight:700;color:#4ec;font-size:1rem;">Total savings unlocked this session</div>
            <div style="color:#aab;font-size:0.85rem;">Rewrites applied or copied from Prompt Advisor</div>
          </div>
          <div id="advisor-savings-total" style="margin-left:auto;font-size:1.5rem;font-weight:800;color:#4ec;">$0.0000<span style="font-size:0.8rem;color:#aab;">/mo</span></div>
        </div>
        <div id="advisor-key-row" style="display:flex;gap:10px;align-items:center;margin-bottom:18px;flex-wrap:wrap;">
          <button id="advisor-run-btn" style="padding:8px 18px;border-radius:6px;background:#7a91ff;color:#0a0b14;font-weight:700;border:none;cursor:pointer;font-size:0.85rem;">Analyze prompts</button>
          <button id="advisor-apply-all-btn" style="display:none;padding:8px 18px;border-radius:6px;background:#4ec;color:#0a0b14;font-weight:700;border:none;cursor:pointer;font-size:0.85rem;">✓ Apply All Rewrites</button>
        </div>
        <div id="advisor-cards" style="display:grid;gap:14px;"></div>
      </article>
    </section>
  `;

  document.getElementById("advisor-run-btn").addEventListener("click", async () => {
    const key = "";

    const cardsEl = document.getElementById("advisor-cards");
    cardsEl.innerHTML = `<p style="color:#aab;font-size:0.9rem;">Fetching runs…</p>`;

    let runs = [];
    const PAGE_SIZE = 20;
    const BATCH_SIZE = 5;
    const BATCH_DELAY_MS = 300;

    try {
      const r = await request("/api/runs");
      runs = (r.runs || [])
        .filter(run => {
          // Accept any breadcrumb with meaningful text, or notes field
          const crumb = (run.breadcrumbs || []).find(b => {
            if (typeof b === "string") return b.length > 10;
            const msg = b.message || b.value || "";
            return msg.length > 10;
          });
          const notesText = (run.notes || "").length > 10;
          return crumb || notesText;
        })
        .slice(0, PAGE_SIZE); // cap at PAGE_SIZE — enterprise has thousands
    } catch (e) {
      cardsEl.innerHTML = `<p style="color:#f87;">Failed to load runs: ${e.message}</p>`;
      return;
    }

    if (!runs.length) {
      cardsEl.innerHTML = `<p style="color:#aab;">No runs with captured prompts found. Send a prompt via the extension first.</p>`;
      return;
    }

    cardsEl.innerHTML = `
      <div id="advisor-progress" style="color:#aab;font-size:0.85rem;margin-bottom:8px;">Analyzing 0 / ${runs.length} prompts…</div>
      ${runs.map((_, i) => `<div id="advisor-card-${i}" class="panel" style="padding:18px 20px;border-radius:10px;border:1px solid rgba(122,145,255,0.15);background:rgba(255,255,255,0.02);">
        <p style="color:#aab;font-size:0.85rem;">Queued…</p>
      </div>`).join("")}
    `;

    let doneCount = 0;
    let totalMonthlySavingsAgg = 0;
    const progressEl = () => document.getElementById("advisor-progress");
    const applyRegistry = new Map(); // cardIdx → applyFn

    // Wire Apply All once analysis is done
    const applyAllBtn = document.getElementById("advisor-apply-all-btn");
    applyAllBtn?.addEventListener("click", async () => {
      applyAllBtn.textContent = "Applying all…";
      applyAllBtn.disabled = true;
      for (const [, fn] of applyRegistry) { try { await fn("click"); } catch {} }
      applyAllBtn.textContent = "✓ All Applied";
      applyAllBtn.style.background = "#4ec";
    });

    for (let batchStart = 0; batchStart < runs.length; batchStart += BATCH_SIZE) {
      const batch = runs.slice(batchStart, batchStart + BATCH_SIZE);
      await Promise.all(batch.map(async (run, bIdx) => {
        const i = batchStart + bIdx;
        const crumb = (run.breadcrumbs || []).find(b => {
          if (typeof b === "string") return b.length > 10;
          const msg = b.message || b.value || "";
          return msg.length > 10;
        });
        const prompt = (crumb
          ? (typeof crumb === "string" ? crumb : crumb.message || crumb.value || "")
          : run.notes || "").slice(0, 600);
        const cardEl = document.getElementById(`advisor-card-${i}`);
        if (cardEl) cardEl.innerHTML = `<p style="color:#aab;font-size:0.85rem;">Analyzing…</p>`;
      try {
        const analysis = await request("/api/advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, runId: run.id })
        });
        doneCount++;
        const p = progressEl();
        if (p) p.textContent = analysis.cached
          ? `Loaded ${doneCount} / ${runs.length} (cached)`
          : `Analyzed ${doneCount} / ${runs.length}`;

        const score = analysis.score || 0;
        const savingsPct = Math.min(Math.max(Number(analysis.tokenSavingsPct) || 0, 0), 60);
        const tokensIn = run.tokensIn || 0;
        const tokensOut = run.tokensOut || 0;
        const costUsdPerRun = run.costUsd || 0;
        const tokensSaved = Math.round(tokensIn * savingsPct / 100);
        const costPerToken = tokensIn > 0 && costUsdPerRun > 0
          ? costUsdPerRun / tokensIn
          : 0.00000025;
        const costPerRunNow = tokensIn * costPerToken;
        const costPerRunAfter = (tokensIn - tokensSaved) * costPerToken;
        // Workflow-based enterprise monthly volumes (realistic per-agent run rates)
        const WORKFLOW_MONTHLY_RUNS = {
          "customer-ops": 150000, "ci-cd-pipeline": 15000, "analytics-pipeline": 60000,
          "finance-reporting": 6000, "strategic-analysis": 3000, "legal-review": 4500,
          "sales-ops": 90000, "hr-ops": 45000, "it-ops": 180000,
          "market-intelligence": 6000, "compliance": 12000, "research": 3000,
        };
        const monthlyRuns = WORKFLOW_MONTHLY_RUNS[run.workflow] || 30000;
        const monthlyCostNow = parseFloat((costPerRunNow * monthlyRuns).toFixed(2));
        const monthlyCostAfter = parseFloat((costPerRunAfter * monthlyRuns).toFixed(2));
        const monthlySavings = parseFloat((monthlyCostNow - monthlyCostAfter).toFixed(2));
        const barW = Math.round(score * 10);
        const scoreColor = score >= 8 ? "#4ec" : score >= 5 ? "#f9c74f" : "#f87";
        const cardKey = `advisor-apply-${i}`;

        cardEl.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.06em;opacity:0.5;margin-bottom:2px;">${escapeHtml(run.agentName)} · ${escapeHtml(run.model)} · ${tokensIn}→${(run.tokensOut||0)} tokens</div>
              <div style="font-weight:600;color:#e0e4ff;font-size:0.95rem;">"${prompt.slice(0,120)}${prompt.length>120?"…":""}"</div>
            </div>
            <div style="text-align:right;flex-shrink:0;">
              <div style="font-size:1.6rem;font-weight:800;color:${scoreColor};line-height:1;">${score}<span style="font-size:0.9rem;opacity:0.5;">/10</span></div>
              <div style="width:60px;height:5px;border-radius:3px;background:rgba(255,255,255,0.1);margin-top:4px;overflow:hidden;">
                <div style="width:${barW}%;height:100%;background:${scoreColor};border-radius:3px;"></div>
              </div>
            </div>
          </div>

          ${savingsPct > 0 ? `
          <div style="margin-bottom:14px;padding:12px 16px;border-radius:8px;background:rgba(122,145,255,0.07);border:1px solid rgba(122,145,255,0.2);">
            <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;color:#7a91ff;margin-bottom:8px;">💡 Apply this rewrite and save</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">
              <div>
                <div style="font-size:0.68rem;opacity:0.55;margin-bottom:2px;">Tokens saved / run</div>
                <div style="font-weight:700;color:#e0e4ff;font-size:1rem;">${tokensSaved.toLocaleString()} tokens <span style="font-size:0.78rem;color:#7a91ff;">(${savingsPct}% less)</span></div>
              </div>
              <div>
                <div style="font-size:0.68rem;opacity:0.55;margin-bottom:2px;">Cost per run: now → after</div>
                <div style="font-weight:700;font-size:1rem;"><span style="color:#f87;text-decoration:line-through;">$${costPerRunNow.toFixed(4)}</span> <span style="color:#4ec;">→ $${costPerRunAfter.toFixed(4)}</span></div>
              </div>
              <div>
                <div style="font-size:0.68rem;opacity:0.55;margin-bottom:2px;">Est. monthly runs</div>
                <div style="font-weight:700;color:#e0e4ff;font-size:1rem;">${monthlyRuns.toLocaleString()}</div>
              </div>
              <div>
                <div style="font-size:0.68rem;opacity:0.55;margin-bottom:2px;">Monthly savings</div>
                <div style="font-weight:800;color:#4ec;font-size:1.15rem;">$${monthlySavings.toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0})} <span style="font-size:0.75rem;opacity:0.6;">/month</span></div>
              </div>
              <div>
                <div style="font-size:0.68rem;opacity:0.55;margin-bottom:2px;">Annual savings</div>
                <div style="font-weight:800;color:#4ec;font-size:1.15rem;">$${(monthlySavings*12).toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0})} <span style="font-size:0.75rem;opacity:0.6;">/year</span></div>
              </div>
            </div>
          </div>` : ""}

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:4px;">
            <div style="background:rgba(255,100,100,0.07);border:1px solid rgba(255,100,100,0.15);border-radius:8px;padding:12px;">
              <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;color:#f87;margin-bottom:6px;">⚠ Weakness</div>
              <div style="font-size:0.85rem;color:#e0e4ff;line-height:1.5;">${escapeHtml(analysis.weakness || "—")}</div>
            </div>
            <div style="background:rgba(78,204,163,0.07);border:1px solid rgba(78,204,163,0.15);border-radius:8px;padding:12px;">
              <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;color:#4ec;margin-bottom:6px;">✏ Suggested rewrite</div>
              <div class="advisor-rewrite-text" style="font-size:0.85rem;color:#e0e4ff;line-height:1.5;user-select:text;cursor:text;">${escapeHtml(analysis.rewrite || "—")}</div>
            </div>
          </div>

          <div style="margin-top:12px;display:flex;justify-content:flex-end;">
            <button id="${cardKey}" style="padding:7px 16px;border-radius:6px;background:#7a91ff;color:#0a0b14;font-weight:700;border:none;cursor:pointer;font-size:0.82rem;">Apply this rewrite</button>
          </div>
        `;

        let rewriteApplied = false;
        const applyRewrite = async (trigger) => {
          if (rewriteApplied) return;
          rewriteApplied = true;
          const btn = document.getElementById(cardKey);
          if (btn) { btn.textContent = "Copied + Applied ✓"; btn.style.background = "#4ec"; btn.disabled = true; }
          if (trigger === "click") {
            navigator.clipboard?.writeText(analysis.rewrite || "").catch(() => {});
          }
          // update savings bar
          const bar = document.getElementById("advisor-savings-bar");
          const totalEl = document.getElementById("advisor-savings-total");
          if (bar && totalEl) {
            bar.style.display = "flex";
            const prev = parseFloat(totalEl.dataset.raw || "0");
            const next = prev + monthlySavings;
            totalEl.dataset.raw = next;
            totalEl.innerHTML = `$${next.toFixed(4)}<span style="font-size:0.8rem;color:#aab;">/mo</span>`;
            // flash animation
            totalEl.style.transform = "scale(1.15)";
            setTimeout(() => { totalEl.style.transform = "scale(1)"; totalEl.style.transition = "transform 0.3s ease"; }, 200);
          }
          // log to server silently
          request("/api/advisor/apply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ runId: run.id, originalPrompt: prompt, rewrite: analysis.rewrite, tokensIn, runsPerMonth: monthlyRuns, tokenSavingsPct: savingsPct, costUsdPerRun })
          }).catch(() => {});
        };

        document.getElementById(cardKey)?.addEventListener("click", () => applyRewrite("click"));
        applyRegistry.set(i, applyRewrite);
        totalMonthlySavingsAgg += monthlySavings;

        // detect copy from rewrite box — charge commission even without clicking Apply
        const rewriteBox = cardEl.querySelector(".advisor-rewrite-text");
        rewriteBox?.addEventListener("copy", () => applyRewrite("copy"));
      } catch (e) {
        doneCount++;
        if (cardEl) cardEl.innerHTML = `<p style="color:#f87;">Analysis failed: ${e.message}</p>`;
      }
      })); // end batch Promise.all
      // rate-limit: pause between batches
      if (batchStart + BATCH_SIZE < runs.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
      }
    } // end batch loop
    const p = progressEl();
    if (p) p.textContent = `Done — ${runs.length} prompts analyzed. Showing top ${PAGE_SIZE}.`;

    // Aggregate savings banner
    if (totalMonthlySavingsAgg > 0) {
      const annualSavings = totalMonthlySavingsAgg * 12;
      const bannerEl = document.createElement("div");
      bannerEl.style.cssText = "margin-bottom:20px;padding:20px 24px;border-radius:12px;background:linear-gradient(135deg,rgba(78,204,163,0.12),rgba(122,145,255,0.08));border:1px solid rgba(78,204,163,0.3);display:flex;align-items:center;gap:20px;flex-wrap:wrap;";
      bannerEl.innerHTML = `
        <div style="font-size:2rem;">💰</div>
        <div style="flex:1;min-width:200px;">
          <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.08em;color:#4ec;margin-bottom:4px;">Total optimization opportunity identified</div>
          <div style="font-size:1.8rem;font-weight:900;color:#4ec;line-height:1.1;">$${annualSavings.toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0})}<span style="font-size:1rem;opacity:0.6;font-weight:400;">/year</span></div>
          <div style="font-size:0.82rem;color:#aab;margin-top:4px;">$${totalMonthlySavingsAgg.toLocaleString("en-US",{minimumFractionDigits:0,maximumFractionDigits:0})}/month · across ${runs.length} agent workflows · from prompt engineering alone</div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:0.68rem;opacity:0.5;margin-bottom:2px;">Without infra changes</div>
          <div style="font-size:1.1rem;font-weight:700;color:#f9c74f;">Zero engineering effort</div>
          <div style="font-size:0.75rem;color:#aab;margin-top:2px;">Apply rewrites below to capture savings</div>
        </div>
      `;
      const cardsContainer = document.getElementById("advisor-cards");
      cardsContainer.insertBefore(bannerEl, cardsContainer.firstChild);
    }

    // show Apply All now that all cards are rendered
    const aab = document.getElementById("advisor-apply-all-btn");
    if (aab && applyRegistry.size > 0) aab.style.display = "inline-block";
  });
}

function renderActivityView() {
  const feed = dashboardState.activityFeed.slice(0, 12);
  document.querySelector("#view-content").innerHTML = `
    <section class="tab-stage">
      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Activity</p>
          <h2>Latest execution trail</h2>
        </div>
        <div class="clean-feed">
          ${feed.length ? feed.map((item, i) => `
            <div class="clean-feed-row expandable-row" data-idx="${i}" style="cursor:pointer;">
              <span>${new Date(item.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <strong>${item.agentName}</strong>
              <em class="feed-level ${levelClass(item.level)}">${item.level.toUpperCase()}</em>
              <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                <p style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;">${item.message}</p>
                <span class="row-chevron" style="flex-shrink:0;opacity:0.5;font-size:0.7rem;">▼</span>
              </div>
            </div>
            <div class="feed-detail-panel" id="feed-detail-${i}" style="display:none;padding:10px 16px 14px 16px;background:rgba(255,255,255,0.03);border-bottom:1px solid rgba(255,255,255,0.07);font-size:0.8rem;color:#aab;margin-top:-4px;">
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 20px;">
                <div><div style="font-size:0.68rem;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em;">Model</div><div style="color:#e0e4ff;font-weight:500;">${item.model || "—"}</div></div>
                <div><div style="font-size:0.68rem;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em;">Provider</div><div style="color:#e0e4ff;font-weight:500;">${item.provider || "—"}</div></div>
                <div><div style="font-size:0.68rem;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em;">Tokens in</div><div style="color:#7af;font-weight:600;">${(item.tokensIn || 0).toLocaleString()}</div></div>
                <div><div style="font-size:0.68rem;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em;">Tokens out</div><div style="color:#7af;font-weight:600;">${(item.tokensOut || 0).toLocaleString()}</div></div>
                <div><div style="font-size:0.68rem;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em;">Latency</div><div style="color:#e0e4ff;font-weight:500;">${item.latencyMs ? item.latencyMs + "ms" : "—"}</div></div>
                <div><div style="font-size:0.68rem;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em;">Cost</div><div style="color:#4ec;">${"$" + (item.costUsd || 0).toFixed(4)}</div></div>
                <div><div style="font-size:0.68rem;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em;">Workflow</div><div style="color:#e0e4ff;font-weight:500;">${item.workflow || "—"}</div></div>
              </div>
            </div>
          `).join("") : `<p class="muted">No activity yet.</p>`}
        </div>
      </article>
    </section>
  `;

  document.querySelectorAll(".expandable-row").forEach(row => {
    row.addEventListener("click", () => {
      const idx = row.dataset.idx;
      const panel = document.getElementById(`feed-detail-${idx}`);
      const chevron = row.querySelector(".row-chevron");
      const open = panel.style.display !== "none";
      panel.style.display = open ? "none" : "block";
      if (chevron) chevron.textContent = open ? "▼" : "▲";
    });
  });
}

// ── Certification helpers ─────────────────────────────────────────────────────

async function loadCertifications() {
  try {
    const data = await request("/api/agents");
    certificationData = data.agents || [];
  } catch (_) {
    certificationData = [];
  }
}

function certStatusChip(status) {
  const labels = { certified: "✓ Certified", uncertified: "⚠ Uncertified", revoked: "✗ Revoked" };
  const label = labels[status] || "Unknown";
  return `<span class="cert-status-chip cert-status-chip--${status || "uncertified"}">${label}</span>`;
}

function tierBadge(tier) {
  const names = ["T0", "T1", "T2", "T3", "T4"];
  return `<span class="tier-badge tier-badge--${tier}" title="Risk Tier ${tier}">${names[tier] ?? "T?"}</span>`;
}

function dangerBar(score) {
  const pct = Math.min(100, Math.round(score));
  const cls = pct <= 20 ? "low" : pct <= 50 ? "medium" : pct <= 75 ? "high" : "crit";
  return `
    <div class="danger-bar-wrap">
      <div class="danger-bar"><div class="danger-bar-fill danger-bar-fill--${cls}" style="width:${pct}%"></div></div>
      <span style="font-size:0.78rem;color:var(--muted)">${pct}</span>
    </div>`;
}

function hitlPct(pct) {
  const cls = pct >= 80 ? "good" : pct >= 50 ? "ok" : "poor";
  return `<span class="hitl-pct hitl-pct--${cls}">${pct}%</span>`;
}

async function certifyAgent(agentName, env = "staging") {
  try {
    await request(`/api/agents/${encodeURIComponent(agentName)}/certify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: env })
    });
    await loadCertifications();
    renderGovernanceView();
  } catch (err) {
    alert(`Certify failed: ${err.message}`);
  }
}

async function promoteAgent(agentName) {
  try {
    await request(`/api/agents/${encodeURIComponent(agentName)}/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    await loadCertifications();
    renderGovernanceView();
  } catch (err) {
    alert(`Promote failed: ${err.message}`);
  }
}

async function revokeAgentCert(agentName, env = "production") {
  if (!confirm(`Revoke production cert for "${agentName}"?`)) return;
  try {
    await request(`/api/agents/${encodeURIComponent(agentName)}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: env, reason: "Manually revoked via dashboard" })
    });
    await loadCertifications();
    renderGovernanceView();
  } catch (err) {
    alert(`Revoke failed: ${err.message}`);
  }
}

function renderCertPanel() {
  const el = document.querySelector("#cert-panel-body");
  if (!el) return;

  if (!certificationData) {
    el.innerHTML = `<p class="cert-loading">Loading certification data…</p>`;
    loadCertifications().then(() => renderCertPanel());
    return;
  }

  if (certificationData.length === 0) {
    el.innerHTML = `
      <div class="cert-empty">
        <p>No agents registered yet.</p>
        <p style="margin-top:6px;font-size:0.82rem">Agents appear here once they submit a run with a <code>toolManifest</code> array.</p>
      </div>`;
    return;
  }

  el.innerHTML = `
    <table class="cert-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>Type</th>
          <th>Tier</th>
          <th>Staging</th>
          <th>Production</th>
          <th>Danger Score</th>
          <th>HITL</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${certificationData.map((agent) => {
          const stagingStatus = agent.stagingCert || "uncertified";
          const prodStatus    = agent.prodCert    || "uncertified";
          const tools         = agent.tools || [];
          const maxDanger     = tools.length > 0 ? Math.max(0, ...tools.map((t) => (t.danger_level ?? 0) * 15)) : 0;
          const hitlCoverage  = tools.filter((t) => t.requires_hitl).length > 0
            ? Math.round((tools.filter((t) => t.requires_hitl && t.run_count > 0).length / tools.filter((t) => t.requires_hitl).length) * 100)
            : 100;
          const canPromote = stagingStatus === "certified" && prodStatus !== "certified";
          const canRevoke  = prodStatus === "certified" || prodStatus === "revoked";
          const name = agent.agentName;

          return `
            <tr>
              <td><strong>${name}</strong></td>
              <td style="color:var(--muted);font-size:0.8rem">${agent.agentType || "custom"}</td>
              <td>${tierBadge(agent.effectiveTier ?? 0)}</td>
              <td>${certStatusChip(stagingStatus)}</td>
              <td>${certStatusChip(prodStatus)}</td>
              <td>${dangerBar(maxDanger)}</td>
              <td>${hitlPct(hitlCoverage)}</td>
              <td>
                <div class="cert-actions">
                  <button class="cert-action-btn cert-action-btn--certify"
                          onclick="certifyAgent(${JSON.stringify(name)}, 'staging')">
                    Certify
                  </button>
                  <button class="cert-action-btn cert-action-btn--promote"
                          onclick="promoteAgent(${JSON.stringify(name)})"
                          ${canPromote ? "" : "disabled"}>
                    Promote
                  </button>
                  <button class="cert-action-btn cert-action-btn--revoke"
                          onclick="revokeAgentCert(${JSON.stringify(name)})"
                          ${canRevoke ? "" : "disabled"}>
                    Revoke
                  </button>
                </div>
              </td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

function renderGovernanceView() {
  document.querySelector("#view-content").innerHTML = `
    <section class="tab-stage governance-stage">
      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Security Gate</p>
          <h2>Agent Certification</h2>
          <p class="panel-subtitle">Certify agents before promoting to production. Uncertified agents are blocked at ingest.</p>
        </div>
        <div id="cert-panel-body"></div>
      </article>
      <article class="panel wide-panel provider-compare-panel">
        <div class="panel-title">
          <p class="eyebrow">Provider Benchmark</p>
          <h2>Head-to-head: which AI provider wins?</h2>
          <p class="panel-subtitle">Ranked by real run data through the Agent Prism proxy. Green = winner for that metric.</p>
        </div>
        <div id="provider-scorecard"></div>
      </article>
      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Cost Risk</p>
          <h2>Leak radar</h2>
        </div>
        <div id="leak-list" class="stack"></div>
      </article>
      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Audit</p>
          <h2>Security trail</h2>
        </div>
        <table class="audit-table">
          <thead>
            <tr><th>Time</th><th>Actor</th><th>Action</th></tr>
          </thead>
          <tbody id="audit-logs-body"></tbody>
        </table>
      </article>
    </section>
  `;
  renderCertPanel();
  renderProviderScorecard(dashboardState.providerComparison);
  renderLeaks(dashboardState.costLeaks);
  renderAuditLogs(dashboardAuditLogs);
}

function renderProviderScorecard(providers) {
  const el = document.querySelector("#provider-scorecard");
  if (!providers.length) {
    el.innerHTML = `<p class="muted">Provider comparison appears once you have runs from more than one AI provider.</p>`;
    return;
  }

  const metrics = [
    { key: "avgScore",       label: "Reliability Score",      unit: "",     higherBetter: true,  fmt: (v) => v },
    { key: "successRate",    label: "Success Rate",        unit: "%",    higherBetter: true,  fmt: (v) => v + "%" },
    { key: "avgLatencyMs",   label: "Avg Latency",         unit: "ms",   higherBetter: false, fmt: (v) => v >= 1000 ? (v / 1000).toFixed(1) + "s" : v + "ms" },
    { key: "costPerRun",     label: "Cost per Run",        unit: "$",    higherBetter: false, fmt: (v) => "$" + v.toFixed(4) },
    { key: "costPer1kTokens",label: "Cost / 1k Tokens",   unit: "$",    higherBetter: false, fmt: (v) => v > 0 ? "$" + v.toFixed(4) : "—" },
    { key: "avgTokensPerRun",label: "Tokens per Run",      unit: "",     higherBetter: false, fmt: (v) => v.toLocaleString() },
    { key: "retries",        label: "Total Retries",       unit: "",     higherBetter: false, fmt: (v) => v },
    { key: "runs",           label: "Total Runs",          unit: "",     higherBetter: true,  fmt: (v) => v },
  ];

  // Compute overall winner (most metric wins)
  const wins = {};
  providers.forEach((p) => { wins[p.provider] = 0; });
  metrics.forEach(({ key, higherBetter }) => {
    const vals = providers.map((p) => p[key]);
    const best = higherBetter ? Math.max(...vals) : Math.min(...vals);
    providers.forEach((p) => {
      if (p[key] === best) wins[p.provider] = (wins[p.provider] || 0) + 1;
    });
  });
  const overallWinner = Object.entries(wins).sort((a, b) => b[1] - a[1])[0]?.[0];

  el.innerHTML = `
    ${overallWinner && providers.length > 1 ? `
      <div class="provider-winner-banner">
        <span>Overall winner based on ${metrics.length} metrics</span>
        <strong>${overallWinner}</strong>
        <em>${wins[overallWinner]} of ${metrics.length} metrics won</em>
      </div>
    ` : ""}
    <div class="provider-cards">
      ${providers.map((p) => {
        const isWinner = p.provider === overallWinner && providers.length > 1;
        return `
        <div class="provider-card ${isWinner ? "provider-card--winner" : ""}">
          <div class="provider-card-header">
            <div class="provider-mark">${p.provider.slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>${p.provider}</strong>
              <span>${p.runs} run${p.runs !== 1 ? "s" : ""}</span>
            </div>
            ${isWinner ? `<span class="provider-winner-chip">Top pick</span>` : ""}
          </div>
          <div class="provider-metrics">
            ${metrics.map(({ key, label, higherBetter, fmt }) => {
              const vals = providers.map((q) => q[key]);
              const best = higherBetter ? Math.max(...vals) : Math.min(...vals);
              const isMetricWinner = p[key] === best && providers.length > 1;
              return `
              <div class="provider-metric ${isMetricWinner ? "provider-metric--win" : ""}">
                <span>${label}</span>
                <strong>${fmt(p[key])}</strong>
                ${isMetricWinner ? `<em class="win-dot"></em>` : ""}
              </div>`;
            }).join("")}
          </div>
        </div>`;
      }).join("")}
    </div>
  `;
}

// ── SVG chart helpers ─────────────────────────────────────────────────────────
function svgLineChart({ id, data, xKey = "i", yKey, y2Key = null, anomalyKey = null,
  color = "#a8beff", color2 = "rgba(255,180,50,0.8)", W = 560, H = 170,
  yFmt = v => v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)) }) {
  if (!data.length) return `<svg viewBox="0 0 ${W} ${H}"><text x="${W/2}" y="${H/2}" fill="#4a5568" text-anchor="middle" font-size="12">No data yet</text></svg>`;
  const pad = { t: 12, r: 16, b: 28, l: 48 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const xs = data.map(d => d[xKey]);
  const ys = data.map(d => d[yKey]);
  const allY = [...ys, ...(y2Key ? data.map(d => d[y2Key]) : [])].filter(v => v != null);
  const minX = Math.min(...xs), maxX = Math.max(...xs) || 1;
  const maxY = Math.max(...allY) * 1.12 || 1;
  const sx = v => pad.l + ((v - minX) / (maxX - minX)) * cw;
  const sy = v => pad.t + (1 - Math.min(1, Math.max(0, v / maxY))) * ch;
  const pts = data.map(d => `${sx(d[xKey])},${sy(d[yKey])}`).join(" ");
  const last = data[data.length - 1];
  const areaD = `M ${sx(xs[0])},${sy(0)} L ${pts.replace(/,/g, " ").split(" ").reduce((a, v, i) => i % 2 === 0 ? a + `${v},` : a + `${v} `, "")}L ${sx(last[xKey])},${sy(0)} Z`;
  const trendPts = y2Key ? data.map(d => `${sx(d[xKey])},${sy(Math.max(0, d[y2Key]))}`).join(" ") : null;
  const yTicks = [0, 0.33, 0.66, 1].map(t => {
    const v = t * maxY;
    return `<line x1="${pad.l}" y1="${sy(v)}" x2="${pad.l+cw}" y2="${sy(v)}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
            <text x="${pad.l-4}" y="${sy(v)+4}" fill="#4a5568" font-size="10" text-anchor="end" font-family="monospace">${yFmt(v)}</text>`;
  }).join("");
  const anomDots = anomalyKey ? data.filter(d => d[anomalyKey]).map(d =>
    `<circle cx="${sx(d[xKey])}" cy="${sy(d[yKey])}" r="6" fill="none" stroke="#ff6b6b" stroke-width="2"/>
     <circle cx="${sx(d[xKey])}" cy="${sy(d[yKey])}" r="2.5" fill="#ff6b6b"/>`
  ).join("") : "";
  const axisLine = `<line x1="${pad.l}" y1="${pad.t+ch}" x2="${pad.l+cw}" y2="${pad.t+ch}" stroke="rgba(255,255,255,0.10)" stroke-width="1"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">
    <defs><linearGradient id="ag-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.01"/>
    </linearGradient></defs>
    ${yTicks}${axisLine}
    <path d="${areaD}" fill="url(#ag-${id})"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${trendPts ? `<polyline points="${trendPts}" fill="none" stroke="${color2}" stroke-width="1.5" stroke-dasharray="5,3"/>` : ""}
    ${anomDots}
  </svg>`;
}

function svgSwimLane({ data, W = 780 }) {
  if (!data.length) return `<svg viewBox="0 0 ${W} 80"><text x="${W/2}" y="44" fill="#4a5568" text-anchor="middle" font-size="12">No agents yet</text></svg>`;
  const clrMap = { Efficient: "#5ee3a3", Moderate: "#ffd580", Wasteful: "#ff9a9a" };
  const tiers = ["Efficient", "Moderate", "Wasteful"];
  const LANE_H = 124, LANE_GAP = 10, PAD = 12, HDR = 28;
  const usableW = W - PAD * 2;
  const totalH = tiers.length * LANE_H + (tiers.length - 1) * LANE_GAP + PAD * 2;
  // bubble center: upper 45% of lane body leaves ~55% for labels below
  const BUBBLE_FRAC = 0.38;
  const CHAR_PX = 6.0; // monospace width at font-size 9

  const lanes = tiers.map((tier, ti) => {
    const color = clrMap[tier];
    const agents = data.filter(a => a.cluster === tier).sort((a, b) => a.avgCost - b.avgCost);
    const laneY = PAD + ti * (LANE_H + LANE_GAP);
    const groupAvg = agents.length ? (agents.reduce((s, a) => s + a.avgCost, 0) / agents.length) : 0;
    const hdr = `${tier.toUpperCase()} · ${agents.length} agent${agents.length !== 1 ? "s" : ""}${agents.length ? ` · avg $${groupAvg.toFixed(4)}/run` : ""}`;

    if (!agents.length) {
      return `<rect x="${PAD}" y="${laneY}" width="${usableW}" height="${LANE_H}" rx="8"
                fill="${color}" fill-opacity="0.03" stroke="${color}" stroke-opacity="0.15" stroke-width="1"/>
              <text x="${PAD + 14}" y="${laneY + 20}" fill="${color}" font-size="11" font-family="monospace" font-weight="700">${hdr}</text>
              <text x="${PAD + usableW / 2}" y="${laneY + LANE_H / 2 + 8}" fill="${color}" font-size="10" text-anchor="middle" opacity="0.3">no agents in this tier</text>`;
    }

    const maxRuns = Math.max(...agents.map(a => a.runs), 1);
    const maxCost = Math.max(...agents.map(a => a.avgCost), 0.0001);
    // slot width — wider slots → more characters visible
    const slotW = Math.min(100, Math.max(60, usableW / agents.length));
    const maxChars = Math.max(6, Math.floor((slotW - 8) / CHAR_PX));
    const bubbleCY = laneY + HDR + (LANE_H - HDR) * BUBBLE_FRAC;
    const totalSlots = slotW * agents.length;
    const startX = PAD + 8 + (usableW - 16 - totalSlots) / 2;

    const bubbles = agents.map((agent, ai) => {
      const cx = startX + ai * slotW + slotW / 2;
      const r = Math.max(8, Math.min(22, 8 + (agent.runs / maxRuns) * 14));
      // adaptive truncation: show as many chars as slot allows
      const name = agent.name || "";
      const lbl = name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name;
      const costFmt = agent.avgCost < 0.001 ? `$${agent.avgCost.toFixed(5)}`
                    : agent.avgCost < 0.01  ? `$${agent.avgCost.toFixed(4)}`
                    : agent.avgCost < 1     ? `$${agent.avgCost.toFixed(3)}`
                    :                         `$${agent.avgCost.toFixed(2)}`;
      const barW = Math.max(2, Math.round((agent.avgCost / maxCost) * (slotW - 10)));
      const tipTokens = (agent.avgTokens || 0).toLocaleString();
      const nameY = bubbleCY + r + 14;
      const costY = bubbleCY + r + 26;
      return `
        <circle cx="${cx}" cy="${bubbleCY}" r="${r}" fill="${color}" fill-opacity="0.18" stroke="${color}" stroke-width="1.5">
          <title>${name}&#10;Cost: ${costFmt}/run&#10;Tokens: ${tipTokens}/run&#10;Runs: ${agent.runs}</title>
        </circle>
        <rect x="${cx - barW / 2}" y="${bubbleCY + r + 4}" width="${barW}" height="2" rx="1" fill="${color}" opacity="0.4"/>
        <text x="${cx}" y="${nameY}" fill="${color}" font-size="9" text-anchor="middle" font-family="monospace">${lbl}</text>
        <text x="${cx}" y="${costY}" fill="${color}" font-size="8.5" text-anchor="middle" font-family="monospace" opacity="0.65">${costFmt}</text>`;
    }).join("");

    return `
      <rect x="${PAD}" y="${laneY}" width="${usableW}" height="${LANE_H}" rx="8"
            fill="${color}" fill-opacity="0.04" stroke="${color}" stroke-opacity="0.22" stroke-width="1"/>
      <text x="${PAD + 14}" y="${laneY + 20}" fill="${color}" font-size="11" font-family="monospace" font-weight="700">${hdr}</text>
      ${bubbles}`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${totalH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">${lanes}</svg>`;
}

function svgScatter({ data, xKey, yKey, nameKey, clusterKey, W = 560, H = 340 }) {
  if (!data.length) return `<svg viewBox="0 0 ${W} ${H}"><text x="${W/2}" y="${H/2}" fill="#4a5568" text-anchor="middle" font-size="12">No agents yet</text></svg>`;
  const pad = { t: 28, r: 24, b: 44, l: 66 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const xs = data.map(d => d[xKey]), ys = data.map(d => d[yKey]);
  const maxX = Math.max(...xs) * 1.2 || 1;
  const maxY = Math.max(...ys) * 1.25 || 0.001;
  const sx = v => pad.l + (v / maxX) * cw;
  const sy = v => pad.t + (1 - v / maxY) * ch;
  const clrMap = { Efficient: "#5ee3a3", Moderate: "#ffd580", Wasteful: "#ff9a9a" };
  const CHAR_W = 5.4, LBL_H = 10;

  // Build dot + initial label positions
  const items = data.map(d => {
    const c = clrMap[d[clusterKey]] || "#a8beff";
    const r = Math.max(8, Math.min(18, 6 + d.runs * 2));
    const cx = sx(d[xKey]), cy = sy(d[yKey]);
    const raw = d[nameKey] || "";
    const lbl = raw.length > 14 ? raw.slice(0, 13) + "…" : raw;
    const lw = lbl.length * CHAR_W;
    return { cx, cy, r, lbl, lw, c,
      lx: cx,
      ly: cy < pad.t + 28 ? cy + r + 12 : cy - r - 6  // start above dot (or below if near top)
    };
  });

  // Greedy push-apart: 30 iterations to separate overlapping labels
  for (let iter = 0; iter < 30; iter++) {
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const dx = b.lx - a.lx;
        const dy = b.ly - a.ly;
        const minX = (a.lw + b.lw) / 2 + 4;
        const minY = LBL_H + 4;
        const overlapX = minX - Math.abs(dx);
        const overlapY = minY - Math.abs(dy);
        if (overlapX > 0 && overlapY > 0) {
          const pushAxis = overlapX < overlapY ? "x" : "y";
          if (pushAxis === "x") {
            const push = overlapX / 2 + 1;
            a.lx -= dx >= 0 ? push : -push;
            b.lx += dx >= 0 ? push : -push;
          } else {
            const push = overlapY / 2 + 1;
            a.ly -= dy >= 0 ? push : -push;
            b.ly += dy >= 0 ? push : -push;
          }
        }
      }
    }
  }

  // Clamp labels inside chart bounds
  items.forEach(it => {
    it.lx = Math.max(pad.l + it.lw / 2, Math.min(pad.l + cw - it.lw / 2, it.lx));
    it.ly = Math.max(pad.t + LBL_H, Math.min(pad.t + ch - 2, it.ly));
  });

  const dots = items.map(({ cx, cy, r, lbl, lx, ly, c }) => {
    const farFromDot = Math.hypot(lx - cx, ly - cy) > r + 14;
    const connector = farFromDot
      ? `<line x1="${cx}" y1="${cy}" x2="${lx}" y2="${ly}" stroke="${c}" stroke-width="0.7" stroke-opacity="0.4" stroke-dasharray="2,2"/>`
      : "";
    return `${connector}
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="1.5"><title>${lbl}</title></circle>
            <text x="${lx}" y="${ly}" fill="${c}" font-size="9" text-anchor="middle" font-family="monospace" pointer-events="none">${lbl}</text>`;
  }).join("");

  const yTicks = [0, 0.33, 0.66, 1].map(t => {
    const vy = t * maxY;
    return `<line x1="${pad.l}" y1="${sy(vy)}" x2="${pad.l+cw}" y2="${sy(vy)}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
            <text x="${pad.l-5}" y="${sy(vy)+4}" fill="#4a5568" font-size="10" text-anchor="end" font-family="monospace">$${vy.toFixed(3)}</text>`;
  }).join("");
  const xTicks = [0, 0.33, 0.66, 1].map(t => {
    const vx = t * maxX;
    const lx = vx >= 1000 ? `${Math.round(vx / 1000)}k` : Math.round(vx);
    return `<line x1="${sx(vx)}" y1="${pad.t}" x2="${sx(vx)}" y2="${pad.t+ch}" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
            <text x="${sx(vx)}" y="${pad.t+ch+16}" fill="#4a5568" font-size="10" text-anchor="middle" font-family="monospace">${lx}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">
    <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t+ch}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
    <line x1="${pad.l}" y1="${pad.t+ch}" x2="${pad.l+cw}" y2="${pad.t+ch}" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
    <text x="${pad.l+cw/2}" y="${H-4}" fill="#4a5568" font-size="10" text-anchor="middle">avg tokens / run →</text>
    ${yTicks}${xTicks}${dots}
  </svg>`;
}

function svgMixBars({ data, W = 540 }) {
  if (!data.length) return "";
  const barH = 22, gap = 8, padL = 144, padR = 16, padT = 8, padB = 28;
  const bw = W - padL - padR;
  const totalH = data.length * (barH + gap) + padT + padB;
  const bars = data.map((d, i) => {
    const y = padT + i * (barH + gap);
    const inW = (d.inputPct / 100) * bw;
    const outW = ((100 - d.inputPct) / 100) * bw;
    const inC = d.inputPct > 70 ? "#ff9a9a" : d.inputPct > 65 ? "#ffd580" : "#5ee3a3";
    const lbl = (d.name || "").length > 18 ? d.name.slice(0, 17) + "…" : d.name;
    return `<text x="${padL - 6}" y="${y + barH/2 + 4}" fill="#8898b0" font-size="10" text-anchor="end" font-family="monospace">${lbl}</text>
            <rect x="${padL}" y="${y}" width="${inW}" height="${barH}" fill="${inC}" opacity="0.75" rx="2"/>
            <rect x="${padL+inW}" y="${y}" width="${outW}" height="${barH}" fill="#a8beff" opacity="0.4" rx="2"/>
            <text x="${padL+4}" y="${y+barH/2+4}" fill="#0a1628" font-size="9" font-weight="700">${d.inputPct}% in</text>
            <text x="${padL+inW+4}" y="${y+barH/2+4}" fill="#0a1628" font-size="9" font-weight="700">${100-d.inputPct}% out</text>`;
  }).join("");
  const leg = `<rect x="${padL}" y="${totalH-20}" width="9" height="9" fill="#5ee3a3" opacity="0.75"/>
               <text x="${padL+13}" y="${totalH-12}" fill="#4a5568" font-size="9">Input (healthy &lt; 65%)</text>
               <rect x="${padL+140}" y="${totalH-20}" width="9" height="9" fill="#a8beff" opacity="0.4"/>
               <text x="${padL+153}" y="${totalH-12}" fill="#4a5568" font-size="9">Output (healthy &lt; 35%)</text>`;
  return `<svg viewBox="0 0 ${W} ${totalH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">${bars}${leg}</svg>`;
}
// ─────────────────────────────────────────────────────────────────────────────

function renderAnalyticsView() {
  const ml = dashboardState?.mlAnalytics;
  if (!ml) {
    document.querySelector("#view-content").innerHTML = `
      <section class="tab-stage analytics-stage">
        <div class="analytics-empty">
          <p>Need at least 3 agent runs for ML analysis.</p>
          <button class="analytics-back-btn" onclick="currentView='tokens';renderCurrentView()">← Back to Token Coach</button>
        </div>
      </section>`;
    return;
  }

  const trendIcon = { rising: "↑", falling: "↓", stable: "→" }[ml.trendDirection] || "→";
  const trendClr = { rising: "red", falling: "green", stable: "muted" }[ml.trendDirection] || "muted";
  const wasteful = ml.clusteredAgents.filter(a => a.cluster === "Wasteful").length;
  const efficient = ml.clusteredAgents.filter(a => a.cluster === "Efficient").length;

  document.querySelector("#view-content").innerHTML = `
    <section class="tab-stage analytics-stage">
      <div class="analytics-header">
        <button class="analytics-back-btn" onclick="currentView='tokens';renderCurrentView()">← Token Coach</button>
        <div>
          <h2 class="analytics-title">ML Token Analytics</h2>
          <p class="analytics-subtitle">${ml.totalRuns} runs analysed — linear regression · z-score anomaly detection · percentile clustering</p>
        </div>
      </div>

      <div class="ml-stat-strip">
        <div class="ml-stat-item">
          <span>Cost trend</span>
          <strong class="${trendClr}">${trendIcon} ${ml.trendDirection.charAt(0).toUpperCase() + ml.trendDirection.slice(1)}</strong>
          <em>${ml.costSlopePerRun >= 0 ? "+" : ""}$${ml.costSlopePerRun}/run &nbsp; R²=${ml.costR2}</em>
        </div>
        <div class="ml-stat-item">
          <span>Anomalies (z &gt; 2)</span>
          <strong class="${ml.anomalyCount > 0 ? "red" : "green"}">${ml.anomalyCount} run${ml.anomalyCount !== 1 ? "s" : ""}</strong>
          <em>σ=${ml.tokenStd.toLocaleString()} tokens std dev</em>
        </div>
        <div class="ml-stat-item">
          <span>30-day forecast</span>
          <strong class="amber">$${ml.forecast30d}</strong>
          <em>regression extrapolation</em>
        </div>
        <div class="ml-stat-item">
          <span>Mean tokens/run</span>
          <strong>${ml.tokenMean.toLocaleString()}</strong>
          <em>σ=${ml.tokenStd.toLocaleString()}</em>
        </div>
        <div class="ml-stat-item">
          <span>Efficiency clusters</span>
          <strong class="${wasteful > 0 ? "red" : "green"}">${wasteful} wasteful</strong>
          <em>${efficient} efficient · ${ml.clusteredAgents.length - wasteful - efficient} moderate</em>
        </div>
      </div>

      <div class="charts-grid">
        <div class="chart-panel">
          <div class="chart-panel-header">
            <h3>Token Burn Rate</h3>
            <div class="chart-legend">
              <span><em style="background:#a8beff"></em> tokens/run</span>
              <span style="color:rgba(255,180,50,0.9)">— — trend</span>
              <span style="color:#ff6b6b">○ anomaly (z&gt;2)</span>
            </div>
          </div>
          <p class="chart-subtitle">Tokens consumed per run · dashed = linear regression · red = statistical outlier</p>
          <div class="chart-svg-wrap">${svgLineChart({ id:"burn", data:ml.burnTimeline, yKey:"tokens", y2Key:"tokenTrend", anomalyKey:"isAnomaly", color:"#a8beff", yFmt: v => v >= 1000 ? `${Math.round(v/1000)}k` : String(Math.round(v)) })}</div>
        </div>

        <div class="chart-panel">
          <div class="chart-panel-header">
            <h3>Cost per Run</h3>
            <div class="chart-legend">
              <span><em style="background:#5ee3a3"></em> cost/run</span>
              <span style="color:rgba(255,80,80,0.8)">— — regression</span>
            </div>
          </div>
          <p class="chart-subtitle">Actual cost per run · regression slope: ${ml.costSlopePerRun >= 0 ? "+" : ""}$${ml.costSlopePerRun}/run · confidence R²=${ml.costR2}</p>
          <div class="chart-svg-wrap">${svgLineChart({ id:"cost", data:ml.burnTimeline, yKey:"cost", y2Key:"costTrend", color:"#5ee3a3", color2:"rgba(255,80,80,0.7)", yFmt: v => `$${v.toFixed(4)}` })}</div>
        </div>

        <div class="chart-panel chart-panel--swimlane">
          <div class="chart-panel-header">
            <h3>Agent Efficiency Tiers</h3>
            <div class="chart-legend">
              <span style="color:#5ee3a3">● Efficient</span>
              <span style="color:#ffd580">● Moderate</span>
              <span style="color:#ff9a9a">● Wasteful</span>
            </div>
          </div>
          <p class="chart-subtitle">Agents grouped by cost percentile · bubble size = run count · sorted by avg cost/run</p>
          <div class="chart-svg-wrap">${svgSwimLane({ data:ml.clusteredAgents })}</div>
        </div>

        <div class="chart-panel">
          <div class="chart-panel-header">
            <h3>Input / Output Mix</h3>
          </div>
          <p class="chart-subtitle">Input% (red if &gt; 65%) vs output% per agent — imbalanced = prompt optimisation opportunity</p>
          <div class="chart-svg-wrap">${svgMixBars({ data:ml.clusteredAgents })}</div>
        </div>
      </div>

      ${ml.anomalyCount > 0 ? `
      <div class="anomaly-panel">
        <h3>Anomalous Runs — z-score &gt; 2.0</h3>
        <div class="anomaly-list">
          ${ml.anomalyRuns.map(r => `
          <div class="anomaly-row">
            <span class="anomaly-dot"></span>
            <strong>${r.agentName}</strong>
            <span>${r.tokens.toLocaleString()} tokens</span>
            <span class="anomaly-z">z=${r.zScore}</span>
            <span class="muted">${new Date(r.time).toLocaleString([], { month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" })}</span>
          </div>`).join("")}
        </div>
      </div>` : ""}
    </section>
  `;
}

function renderAiAdvisorPanel() {
  const advisor = aiAdvisorState || {
    status: "loading",
    provider: "ollama",
    model: "llama3.1",
    message: "Loading the AI Advisor..."
  };
  const provider = advisor.provider || "ollama";
  const model = advisor.model || "llama3.1";
  const isOpenRouter = provider === "openrouter";
  const providerName = isOpenRouter ? "OpenRouter" : provider === "ollama" ? "Local Llama" : provider;
  const providerLabel = `${escapeHtml(provider)} · ${escapeHtml(model)}`;
  const generatedAt = advisor.generatedAt ? formatDate(advisor.generatedAt) : "not generated yet";
  const setupEnv = advisor.setup?.env || {};
  const setupCommands = Object.entries(setupEnv).length
    ? Object.entries(setupEnv).map(([key, value]) => `${key}=${value}`)
    : isOpenRouter
      ? [
          "AI_ADVISOR_PROVIDER=openrouter",
          "AI_ADVISOR_MODEL=openrouter/free",
          "OPENROUTER_API_KEY=set in Render environment"
        ]
      : [
          "ollama pull llama3.1",
          "ollama serve",
          "AI_ADVISOR_PROVIDER=ollama",
          "OLLAMA_BASE_URL=http://127.0.0.1:11434"
        ];

  if (advisor.status === "ready") {
    const recommendations = advisor.recommendations || [];
    return `
      <article class="panel wide-panel ai-advisor-panel ai-advisor-panel--ready">
        <div class="ai-advisor-head">
          <div class="panel-title">
            <p class="eyebrow">AI Advisor</p>
            <h2>${escapeHtml(providerName)} recommendations for this tenant</h2>
          </div>
          <div class="ai-advisor-meta">
            <span>${providerLabel}</span>
            <span>${escapeHtml(advisor.confidence || "medium")} confidence</span>
            <span>${escapeHtml(advisor.priority || "quality")} priority</span>
          </div>
        </div>
        <div class="ai-advisor-summary">
          <strong>${escapeHtml(advisor.summary)}</strong>
          <span>Generated ${generatedAt}. ${escapeHtml(providerName)} reads Agent Prism telemetry and writes the advisor output; raw metrics below stay visible as evidence.</span>
        </div>
        <div class="ai-advisor-grid">
          ${recommendations.length ? recommendations.map((item, index) => `
            <div class="ai-advisor-card">
              <span class="advisor-step">${index + 1}</span>
              <h3>${escapeHtml(item.title)}</h3>
              <p>${escapeHtml(item.why)}</p>
              <div class="advisor-action">${escapeHtml(item.action)}</div>
              <div class="advisor-impact">
                <span>${escapeHtml(item.expectedImpact)}</span>
                <em>${escapeHtml(item.owner)} · ${escapeHtml(item.nextCheck)}</em>
              </div>
            </div>
          `).join("") : `<p class="muted">The advisor did not return recommendations. Refresh after another run.</p>`}
        </div>
        ${(advisor.questions || []).length ? `
        <div class="ai-advisor-questions">
          <span>Advisor needs business context</span>
          ${(advisor.questions || []).map(q => `<p>${escapeHtml(q)}</p>`).join("")}
        </div>` : ""}
      </article>
    `;
  }

  const isWaiting = advisor.status === "waiting_for_telemetry";
  return `
    <article class="panel wide-panel ai-advisor-panel ai-advisor-panel--setup">
      <div class="ai-advisor-head">
        <div class="panel-title">
          <p class="eyebrow">AI Advisor</p>
          <h2>${isWaiting ? "Waiting for agent telemetry" : `${escapeHtml(providerName)} advisor not connected`}</h2>
        </div>
        <div class="ai-advisor-meta">
          <span>${providerLabel}</span>
          <span>${escapeHtml(advisor.status || "unavailable")}</span>
        </div>
      </div>
      <div class="ai-advisor-empty">
        <p>${escapeHtml(advisor.message || "Check the advisor provider settings, then refresh Token Coach.")}</p>
        ${isWaiting ? "" : `
        <div class="advisor-command-grid">
          ${setupCommands.map(command => `<code>${escapeHtml(command)}</code>`).join("")}
        </div>
        <span>${isOpenRouter ? "For OpenRouter on Render, confirm the API key is saved, redeploy completed, and timeout is at least 30000 ms." : "For Render, this endpoint must be reachable from the Render service. Your laptop Ollama is only reachable when Agent Prism runs locally."}</span>`}
      </div>
    </article>
  `;
}

function renderPromptBurnPanel(efficiency) {
  const topAgents = efficiency.topAgents || [];
  const totalPromptTokens = efficiency.totalInputTokens || topAgents.reduce((sum, agent) => sum + (agent.tokensIn || 0), 0);
  const totalCompletionTokens = efficiency.totalOutputTokens || topAgents.reduce((sum, agent) => sum + (agent.tokensOut || 0), 0);
  const totalTokens = totalPromptTokens + totalCompletionTokens;
  const promptPercent = totalTokens > 0 ? Math.round((totalPromptTokens / totalTokens) * 100) : 0;
  const completionPercent = totalTokens > 0 ? 100 - promptPercent : 0;
  const breakdown = efficiency.promptBreakdown || {};
  const sourceBuckets = [
    ["User prompt", breakdown.userPromptTokens || 0],
    ["System prompt", breakdown.systemPromptTokens || 0],
    ["RAG/context", breakdown.contextTokens || 0],
    ["Tool results", breakdown.toolResultTokens || 0],
    ["Memory/history", breakdown.memoryTokens || 0],
    ["Unclassified prompt", breakdown.uncategorizedPromptTokens || 0]
  ];
  const capturedBucketTokens = breakdown.capturedPromptBucketTokens || sourceBuckets.slice(0, 5).reduce((sum, [, value]) => sum + value, 0);
  const promptBurners = [...topAgents]
    .filter((agent) => (agent.tokensIn || 0) > 0)
    .sort((a, b) => (b.tokensIn || 0) - (a.tokensIn || 0))
    .slice(0, 4);

  const actualCaptureNote = totalTokens > 0
    ? capturedBucketTokens > 0
      ? "Actuals from provider and SDK usage fields. Prompt buckets show captured source-level token burn only."
      : "Actuals from provider or SDK usage fields. Source-level prompt buckets require the SDK capture layer."
    : "No actual token usage has been captured yet. Send traffic through the gateway or SDK to populate this panel.";

  return `
    <article class="panel wide-panel prompt-burn-panel">
      <div class="panel-title">
        <p class="eyebrow">Prompt Burn Actuals</p>
        <h2>Where tokens are spent before the answer</h2>
      </div>
      <div class="prompt-burn-hero">
        <div class="prompt-burn-meter">
          <div class="prompt-burn-ring" style="--prompt-share:${promptPercent}%">
            <strong>${promptPercent}%</strong>
            <span>prompt side</span>
          </div>
          <p>${escapeHtml(actualCaptureNote)}</p>
        </div>
        <div class="prompt-burn-stats">
          <div>
            <span>Prompt/input tokens</span>
            <strong>${compactNumber(totalPromptTokens)}</strong>
            <em>Provider reported actuals</em>
          </div>
          <div>
            <span>Completion/output tokens</span>
            <strong>${compactNumber(totalCompletionTokens)}</strong>
            <em>${completionPercent}% of total usage</em>
          </div>
          <div>
            <span>Source breakdown</span>
            <strong>${totalTokens > 0 ? "Pending" : "Waiting"}</strong>
            <em>User, system, RAG, tools, memory</em>
          </div>
        </div>
      </div>
      <div class="prompt-source-grid">
        ${sourceBuckets.map(([label, value]) => {
          const sourcePct = totalPromptTokens > 0 && value > 0 ? Math.round((value / totalPromptTokens) * 100) : 0;
          const isCaptured = value > 0;
          const isUnclassified = label === "Unclassified prompt";
          return `
          <div class="prompt-source-card ${isCaptured ? "prompt-source-card--captured" : "prompt-source-card--pending"}">
            <span>${label}</span>
            <strong>${isCaptured ? compactNumber(value) : "Not captured"}</strong>
            <em>${isCaptured ? `${sourcePct}% of prompt actuals${isUnclassified ? " from provider total" : ""}` : "No approximation shown"}</em>
          </div>
        `}).join("")}
      </div>
      <div class="prompt-burn-list">
        <div class="prompt-burn-list-head">
          <span>Agent</span>
          <span>Prompt tokens</span>
          <span>Prompt share</span>
        </div>
        ${promptBurners.length ? promptBurners.map((agent) => {
          const agentTotal = (agent.tokensIn || 0) + (agent.tokensOut || 0);
          const agentPromptPct = agentTotal > 0 ? Math.round(((agent.tokensIn || 0) / agentTotal) * 100) : 0;
          return `
            <div class="prompt-burn-row">
              <div>
                <strong>${escapeHtml(agent.agentName)}</strong>
                <span>${escapeHtml(agent.provider)} · ${agent.runs} runs</span>
              </div>
              <strong>${compactNumber(agent.tokensIn || 0)}</strong>
              <span class="${agentPromptPct > 70 ? "amber" : ""}">${agentPromptPct}%</span>
            </div>
          `;
        }).join("") : `<p class="muted">Prompt-heavy agents will appear after actual token telemetry arrives.</p>`}
      </div>
    </article>
  `;
}

function renderModelFitnessPanel(mismatches) {
  if (!mismatches || mismatches.length === 0) {
    return `
    <article class="panel wide-panel">
      <div class="panel-title">
        <p class="eyebrow">Model Fitness</p>
        <h2>All runs using optimal models</h2>
      </div>
      <div class="leak-empty">
        <span class="leak-empty-icon">&#10003;</span>
        <p>No model mismatches detected. Every run matches the recommended tier for its task type.</p>
      </div>
    </article>`;
  }

  const fitnessBadgeClass = { mismatch: "leak-badge--high", suboptimal: "leak-badge--medium" };
  const taskLabel = { code: "Code", reasoning: "Reasoning", summarization: "Summarize", creative: "Creative", data: "Data", multi_tool: "Multi-tool", simple_qa: "Simple Q&A", general: "General" };

  return `
  <article class="panel wide-panel">
    <div class="panel-title">
      <p class="eyebrow">Model Fitness</p>
      <h2>${mismatches.length} run${mismatches.length !== 1 ? "s" : ""} with model optimization opportunities</h2>
    </div>
    <div class="leak-table fitness-table">
      <div class="leak-table-head">
        <span>Agent</span>
        <span>Task</span>
        <span>Model used</span>
        <span>Opportunity</span>
        <span>Recommended</span>
        <span title="Amount recoverable by switching to the recommended model">Recoverable</span>
      </div>
      ${mismatches.slice(0, 12).map(m => {
        const shortModel = (m.model || "").replace(/claude-/,"").replace(/-20\d{6}$/,"");
        const shortRec   = (m.recommendedModel || "").replace(/claude-/,"").replace(/-20\d{6}$/,"");
        const issueLabel = m.fitness === "mismatch"
          ? '<span class="leak-badge leak-badge--high" title="Under-powered model — quality or reliability at risk">Quality Risk</span>'
          : '<span class="leak-badge leak-badge--medium" title="Overkill model — same output at lower cost">Overpaying</span>';
        return `
      <div class="leak-row fitness-row">
        <div class="leak-agent">
          <strong>${escapeHtml(m.agentName)}</strong>
          <span>${escapeHtml(m.provider || "")}</span>
        </div>
        <span class="muted">${taskLabel[m.taskType] || m.taskType}</span>
        <code class="model-chip">${escapeHtml(shortModel)}</code>
        ${issueLabel}
        <code class="model-chip model-chip--rec">${escapeHtml(shortRec)}</code>
        <span class="leak-cost ${m.fitness === "mismatch" ? "red" : "amber"}" title="Recover this by switching to the recommended model">$${(m.costUsd || 0).toFixed(4)}</span>
      </div>`}).join("")}
    </div>
    <div class="leak-summary">
      ${(() => {
        const suboptimal = mismatches.filter(m => m.fitness === "suboptimal");
        const mismatch   = mismatches.filter(m => m.fitness === "mismatch");
        const wastedUsd  = suboptimal.reduce((s, m) => s + (m.costUsd || 0), 0);
        const parts = [];
        if (suboptimal.length) parts.push(`<strong class="green">Recover $${wastedUsd.toFixed(4)}</strong> by switching ${suboptimal.length} run${suboptimal.length !== 1 ? "s" : ""} to right-sized models`);
        if (mismatch.length)   parts.push(`<strong class="red">${mismatch.length} run${mismatch.length !== 1 ? "s" : ""} at quality risk</strong> — upgrade model to protect outcomes`);
        return parts.join(" &nbsp;·&nbsp; ") || "Switch models to recover spend";
      })()}
    </div>
  </article>`;
}

function renderTokenCoachView() {
  const efficiency = dashboardState.tokenEfficiency || {};
  const suggestions = efficiency.suggestions || [];
  const topAgents = efficiency.topAgents || [];
  const hotspots = efficiency.workflowHotspots || [];
  const leaks = (dashboardState.costLeaks || []).slice(0, 8);
  const modelMismatches = (dashboardState.modelMismatches || []).slice(0, 20);
  const ml = dashboardState.mlAnalytics || null;
  const score = efficiency.efficiencyScore ?? null;
  const scoreColor = score === null ? "muted" : score >= 80 ? "green" : score >= 60 ? "amber" : "red";
  const leakTypeStyle = {
    "Budget breach": { cls: "leak-badge--budget", icon: "&#128178;" },
    "Retry spiral":  { cls: "leak-badge--retry",  icon: "&#9851;" },
    "Low-value spend": { cls: "leak-badge--low",  icon: "&#128087;" }
  };
  const savingsBanners = detectCoachSavings(efficiency);

  document.querySelector("#view-content").innerHTML = `
    <section class="tab-stage token-stage">
      <article class="panel wide-panel token-hero">
        <div class="coach-hero-header">
          <div class="panel-title">
            <p class="eyebrow">Token Coach</p>
            <h2>Usage efficiency — act on these to reduce cost</h2>
          </div>
          <div style="display:flex;align-items:center;gap:16px;flex-shrink:0">
            ${score !== null ? `
            <div class="efficiency-score-badge">
              <span>Efficiency Score</span>
              <strong class="${scoreColor}">${score}/100</strong>
              <em>${score >= 80 ? "Well optimised" : score >= 60 ? "Room to improve" : "High waste detected"}</em>
            </div>
          ` : ""}
            <button class="ml-analytics-link ${ml ? "" : "ml-analytics-link--dim"}" onclick="currentView='analytics';renderCurrentView()">
              &#9685; ML Analytics →${ml ? "" : " (need 3+ runs)"}
            </button>
          </div>
        </div>
        ${ml ? `
        <div class="ml-mini-strip">
          <span class="ml-mini-item ${ml.trendDirection === "rising" ? "red" : ml.trendDirection === "falling" ? "green" : ""}">
            ${{ rising:"↑", falling:"↓", stable:"→" }[ml.trendDirection]} Cost ${ml.trendDirection} &nbsp;<em>R²=${ml.costR2}</em>
          </span>
          <span class="ml-mini-item ${ml.anomalyCount > 0 ? "red" : "green"}">
            ${ml.anomalyCount > 0 ? "&#9888;" : "&#10003;"} ${ml.anomalyCount} anomal${ml.anomalyCount !== 1 ? "ies" : "y"} detected
          </span>
          <span class="ml-mini-item amber">&#9685; 30d forecast $${ml.forecast30d}</span>
          <span class="ml-mini-item">${ml.clusteredAgents.filter(a => a.cluster === "Wasteful").length} wasteful / ${ml.clusteredAgents.filter(a => a.cluster === "Efficient").length} efficient agents</span>
        </div>` : ""}
        ${(() => {
          const inp = efficiency.inputTokenPercent || 0;
          const out = efficiency.outputTokenPercent || 0;
          const wst = efficiency.wastePercent || 0;
          const c1k = efficiency.costPer1kTokensUsd || 0;
          const prj = efficiency.projectedMonthlyCost || 0;
          const apr = efficiency.avgTokensPerRun || 0;
          const bup = dashboardState?.headlineMetrics?.budgetUsedPercent || 0;
          return `<div class="token-summary-rich">
            ${tokenStatCard("Total tokens", compactNumber(efficiency.totalTokens || 0),
              apr > 0 ? `${compactNumber(apr)}/run avg · ${efficiency.totalTokens > 0 ? "across all agents this period" : "no data yet"}` : "No token data yet",
              "neutral")}
            ${tokenStatCard("Input mix", `${inp}%`,
              inp > 75 ? "⚠ Very high — large system prompts driving cost. Target: under 65%."
              : inp > 65 ? "⚠ Slightly above target (65%). Review verbose system prompt templates."
              : inp > 0 ? "✓ Optimal — prompts are concise and well-structured."
              : "No data yet.",
              inp > 75 ? "bad" : inp > 65 ? "warn" : "good")}
            ${tokenStatCard("Output mix", `${out}%`,
              out > 50 ? "⚠ Very high — agents generating very long responses. Add max_tokens limits."
              : out > 35 ? "⚠ Elevated — consider constraining output format and response length."
              : out > 0 ? "✓ Healthy — agents responding concisely."
              : "No data yet.",
              out > 50 ? "bad" : out > 35 ? "warn" : "good")}
            ${tokenStatCard("Retry waste", `${wst}%`,
              wst > 8 ? "↑ Critical — agents failing repeatedly. Each retry burns budget. Fix the top retrying agents first."
              : wst > 3 ? "⚠ Above 3% target. Open Cost Leak Radar to see which agents retry most."
              : wst > 0 ? "✓ Minimal — agents completing tasks on first attempt."
              : "✓ No retries logged.",
              wst > 8 ? "bad" : wst > 3 ? "warn" : "good")}
            ${tokenStatCard("Cost / 1k tokens", c1k > 0 ? `$${c1k}` : "—",
              c1k > 0.008 ? "⚠ High — consider routing routine tasks to cheaper model tiers (Haiku / GPT-4o-mini)."
              : c1k > 0.003 ? "✓ Standard — typical for Sonnet / GPT-4o class models."
              : c1k > 0 ? "✓ Efficient — at or below market average for this model class."
              : "No cost data yet.",
              c1k > 0.008 ? "warn" : "good")}
            ${tokenStatCard("Projected / month", prj > 0 ? `$${prj}` : "—",
              prj > 0 ? `${bup}% of budget used · ${bup > 90 ? "⚠ approaching budget ceiling" : bup > 75 ? "⚠ monitor closely" : "✓ within policy"}`
              : "Insufficient run history to project.",
              bup > 90 ? "bad" : bup > 75 ? "warn" : "good")}
          </div>`;
        })()}
      </article>

      ${renderPromptBurnPanel(efficiency)}

      ${renderAiAdvisorPanel()}

      <article class="panel wide-panel cost-leak-radar-panel">
        <div class="panel-title">
          <p class="eyebrow">Cost Leak Radar</p>
          <h2>Flagged runs burning budget right now</h2>
        </div>
        ${leaks.length ? `
        <div class="leak-table">
          <div class="leak-table-head">
            <span>Agent</span>
            <span>Leak type</span>
            <span>Cost</span>
            <span>Budget</span>
            <span>Overspend</span>
            <span>Retries</span>
            <span>Fix</span>
          </div>
          ${leaks.map(leak => {
            const style = leakTypeStyle[leak.leakType] || { cls: "leak-badge--low", icon: "&#9888;" };
            const overUsd = Math.max(0, leak.costUsd - (leak.budgetUsd || 0));
            const overPct = leak.budgetUsd > 0 ? Math.round((overUsd / leak.budgetUsd) * 100) : null;
            return `
            <div class="leak-row">
              <div class="leak-agent">
                <strong>${leak.agentName}</strong>
                <span>${leak.provider} · ${leak.workflow}</span>
              </div>
              <span class="leak-badge ${style.cls}">${style.icon} ${leak.leakType}</span>
              <span class="leak-cost red">$${leak.costUsd.toFixed(4)}</span>
              <span class="leak-budget">$${(leak.budgetUsd || 0).toFixed(4)}</span>
              <span class="leak-over ${overUsd > 0 ? "red" : "muted"}">${overUsd > 0 ? `+$${overUsd.toFixed(4)}${overPct !== null ? ` (${overPct}%)` : ""}` : "—"}</span>
              <span class="leak-retries ${leak.retryCount >= 3 ? "amber" : "muted"}">${leak.retryCount}</span>
              <span class="leak-rec">${leak.recommendation}</span>
            </div>`;
          }).join("")}
        </div>
        <div class="leak-summary">
          Total flagged cost: <strong class="red">$${leaks.reduce((s, l) => s + l.costUsd, 0).toFixed(4)}</strong>
          &nbsp;·&nbsp; ${leaks.length} run${leaks.length !== 1 ? "s" : ""} flagged
          &nbsp;·&nbsp; Recoverable: <strong class="green">$${leaks.reduce((s, l) => s + Math.max(0, l.costUsd - (l.budgetUsd || 0)), 0).toFixed(4)}</strong>
        </div>
        ` : `
        <div class="leak-empty">
          <span class="leak-empty-icon">&#10003;</span>
          <p>No cost leaks detected. All runs within budget, no retry spirals, no low-value spend.</p>
        </div>
        `}
      </article>

      ${renderModelFitnessPanel(modelMismatches)}

      ${savingsBanners.length ? savingsBanners.map(b => {
        const safeKey = encodeURIComponent(b.title);
        const metricLabel = { inputTokenPercent: "Input mix", outputTokenPercent: "Output mix", wastePercent: "Retry waste", avgTokensPerRun: "Avg tokens/run", costPer1kTokensUsd: "Cost/1k tokens" }[b.metricKey] || b.metricKey;
        return `
        <div class="coach-savings-banner" id="coach-saving-${safeKey}">
          <span class="coach-savings-icon">&#127881;</span>
          <div class="coach-savings-text">
            <strong>Congratulations — you saved ${b.savedUsd > 0 ? `$${b.savedUsd.toFixed(2)}/month` : "tokens"} manually!</strong>
            <span>After reading "<em>${b.title}</em>", your ${metricLabel} dropped from ${b.before}${b.metricKey.includes("Usd") || b.metricKey === "avgTokensPerRun" ? "" : "%"} to ${b.after}${b.metricKey.includes("Usd") || b.metricKey === "avgTokensPerRun" ? "" : "%"}. Token Coach tracked your improvement.</span>
          </div>
          <button class="coach-savings-dismiss" onclick="dismissCoachSaving('${safeKey}')" title="Dismiss">&#10005;</button>
        </div>`;
      }).join("") : ""}

      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Action Plan</p>
          <h2>Do these — in order — to reduce token cost</h2>
        </div>
        <div class="coach-list">
          ${suggestions.length ? suggestions.map((item, index) => {
            const cardId = `coach-card-${index}`;
            const safeTitle = (item.title || "").replace(/"/g, "&quot;");
            const savingsShort = item.savingsEstimate
              ? (item.savingsEstimate.match(/\$[\d.]+\/month/) || [])[0] || ""
              : "";
            return `
            <div class="coach-card coach-card--actionable" id="${cardId}"
              data-title="${safeTitle}"
              data-metrickey="${item.metricKey || ""}"
              data-metricvalue="${item.metricSnapshot ?? ""}"
              data-monthly="${efficiency.projectedMonthlyCost || 0}">

              <div class="coach-row-summary" onclick="coachToggleDetails('${cardId}')">
                <span class="coach-rank">${index + 1}</span>
                <span class="coach-row-title">${item.title}</span>
                <div class="coach-row-meta">
                  ${item.effort ? `<span class="coach-effort coach-effort--${(item.effort || "").toLowerCase()}">${item.effort}</span>` : ""}
                  ${savingsShort ? `<span class="coach-savings-pill">${savingsShort}</span>` : ""}
                  <button class="coach-show-btn" onclick="event.stopPropagation();coachToggleDetails('${cardId}')">Show &#9662;</button>
                </div>
              </div>

              <div class="coach-details-body">
                <strong class="coach-impact">${item.impact}</strong>
                ${item.savingsEstimate ? `<div class="coach-savings">${item.savingsEstimate}</div>` : ""}

                ${item.diagnosis ? `
                <div class="coach-diagnostic-block coach-diagnostic-block--problem">
                  <div class="coach-diagnostic-label"><span class="coach-diagnostic-icon">&#9888;</span> What went wrong</div>
                  <p>${item.diagnosis}</p>
                </div>` : ""}

                ${item.whatToChange && item.whatToChange.length ? `
                <div class="coach-diagnostic-block coach-diagnostic-block--change">
                  <div class="coach-diagnostic-label"><span class="coach-diagnostic-icon">&#9998;</span> What to change</div>
                  <ol class="coach-change-list">
                    ${item.whatToChange.map(step => `<li>${step}</li>`).join("")}
                  </ol>
                </div>` : item.action ? `<p class="coach-action"><span class="coach-do-label">Do this:</span> ${item.action}</p>` : ""}

                ${item.howToTest ? `
                <div class="coach-diagnostic-block coach-diagnostic-block--test">
                  <div class="coach-diagnostic-label"><span class="coach-diagnostic-icon">&#10003;</span> How to verify the fix</div>
                  <p>${item.howToTest}</p>
                </div>` : ""}

                ${item.target ? `<div class="coach-target">${item.target}</div>` : ""}

                <div class="coach-apply-row">
                  <button class="coach-apply-btn" onclick="coachApply('${cardId}')">
                    &#9654; Apply this fix${savingsShort ? " — save " + savingsShort : ""}
                  </button>
                  <p class="coach-apply-note">Applying auto-configures your agent. Making the changes manually above also counts — Token Coach will detect the improvement on your next run.</p>
                </div>
              </div>
            </div>`;
          }).join("") : `<p class="muted">No token recommendations yet. Run agents through the proxy to generate coaching data.</p>`}
        </div>
      </article>

      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Top Agents by Token Cost</p>
          <h2>Where to focus first</h2>
        </div>
        <div class="token-list">
          ${topAgents.length ? topAgents.map((agent) => {
            const inputPct = (agent.tokensIn + agent.tokensOut) > 0
              ? Math.round((agent.tokensIn / (agent.tokensIn + agent.tokensOut)) * 100) : 0;
            return `
            <div class="token-row">
              <div>
                <strong>${agent.agentName}</strong>
                <span>${agent.provider} · ${agent.runs} runs · ${inputPct}% input</span>
              </div>
              <div>
                <strong>${compactNumber(agent.totalTokens)}</strong>
                <span>${compactNumber(agent.avgTokensPerRun)} avg/run · $${agent.costUsd.toFixed(4)}</span>
              </div>
            </div>
          `}).join("") : `<p class="muted">Token-heavy agents appear after telemetry arrives.</p>`}
        </div>
      </article>

      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Workflow Hotspots</p>
          <h2>Highest-token workflows</h2>
        </div>
        <div class="token-list">
          ${hotspots.length ? hotspots.map((workflow) => `
            <div class="token-row">
              <div>
                <strong>${workflow.workflow}</strong>
                <span>${workflow.runs} runs · ${workflow.retries} retries${workflow.retries > 0 ? " ⚠" : ""}</span>
              </div>
              <div>
                <strong>${compactNumber(workflow.totalTokens)}</strong>
                <span>${compactNumber(workflow.avgTokensPerRun)} avg/run</span>
              </div>
            </div>
          `).join("") : `<p class="muted">Workflow hotspots appear after telemetry arrives.</p>`}
        </div>
      </article>
    </section>
  `;
  // Restore expanded state after re-render
  expandedCoachCards.forEach(cardId => {
    const card = document.getElementById(cardId);
    if (card) {
      card.classList.add("coach-card--expanded");
      const btn = card.querySelector(".coach-show-btn");
      if (btn) btn.innerHTML = "Hide &#9652;";
    }
  });
}

function formatDate(value) {
  if (!value) return "Never";
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

let liveSessionsData = null;
let liveSessionsTimer = null;

function fmtTokens(n) {
  if (!n) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

function fmtAgo(ts) {
  if (!ts) return "—";
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return sec + "s ago";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
  return Math.floor(sec / 86400) + "d ago";
}

function shortModel(model) {
  if (!model) return "—";
  if (model.includes("sonnet")) return "sonnet4.6";
  if (model.includes("opus")) return "opus4";
  if (model.includes("haiku")) return "haiku4.5";
  return model.split("-").slice(-2).join("-");
}

function shortProject(dir) {
  if (!dir) return "—";
  return dir.replace(/^-Users-[^-]+-/, "").replace(/-/g, "/").slice(-24);
}

function ctxBarHtml(pct) {
  const cls = pct >= 90 ? "ctx-bar--crit" : pct >= 70 ? "ctx-bar--warn" : "ctx-bar--ok";
  return `<div class="ctx-bar-wrap"><div class="ctx-bar ${cls}" style="width:${pct}%"></div></div><span class="ctx-pct">${pct}%</span>`;
}

async function loadLiveSessions() {
  try {
    const [fleetData, rlData] = await Promise.all([
      fetch("/api/fleet/sessions", { headers: tenantApiKey ? { "x-api-key": tenantApiKey } : {} })
        .then((r) => r.ok ? r.json() : null)
        .catch(() => null),
      fetch("/api/rate-limits").then((r) => r.json()).catch(() => null)
    ]);

    if (fleetData && fleetData.machines && fleetData.machines.length > 0) {
      liveSessionsData = { mode: "fleet", fleet: fleetData, rateLimit: rlData };
    } else {
      const localData = await fetch("/api/local-sessions").then((r) => r.json()).catch(() => ({ sessions: [], processes: [], ports: [] }));
      liveSessionsData = { mode: "local", ...localData, rateLimit: rlData };
    }
    renderLiveSessionsContent();
  } catch (err) {
    const el = document.querySelector("#live-sessions-content");
    if (el) el.innerHTML = `<p class="ls-error">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

window.killPort = async function (port) {
  const btn = document.querySelector(`[data-kill-port="${port}"]`);
  if (btn) { btn.textContent = "Killing…"; btn.disabled = true; }
  try {
    const r = await fetch(`/api/local-sessions/kill-port/${port}`, { method: "POST" });
    const d = await r.json();
    if (r.ok) {
      await loadLiveSessions();
    } else {
      alert("Kill failed: " + (d.error || "unknown error"));
      if (btn) { btn.textContent = "Kill"; btn.disabled = false; }
    }
  } catch (err) {
    alert("Kill failed: " + err.message);
    if (btn) { btn.textContent = "Kill"; btn.disabled = false; }
  }
};

function renderLiveStatsPanel(stats) {
  const {
    machinesOnline = null, machinesTotal = null,
    activeSessions, totalSessions,
    totalTokens, contextCritical, contextWarning,
    orphanPorts, trackedSpend = null
  } = stats;

  const hasMachines = machinesTotal != null;
  const healthScore = (() => {
    let score = 100;
    score -= contextCritical * 18;
    score -= contextWarning * 8;
    score -= orphanPorts * 5;
    if (hasMachines && machinesOnline < machinesTotal) score -= ((machinesTotal - machinesOnline) / machinesTotal) * 15;
    return Math.max(0, Math.round(score));
  })();
  const healthCls = healthScore >= 80 ? "lss-health--good" : healthScore >= 55 ? "lss-health--warn" : "lss-health--crit";
  const healthLabel = healthScore >= 80 ? "Healthy" : healthScore >= 55 ? "Needs attention" : "Action required";

  const kpis = [
    hasMachines ? {
      icon: "&#x1F4BB;", label: "Machines", value: `${machinesOnline}<span class="lss-kpi-total">/${machinesTotal}</span>`,
      sub: `${machinesTotal - machinesOnline} offline`, cls: machinesOnline < machinesTotal ? "lss-kpi--warn" : "lss-kpi--ok"
    } : null,
    {
      icon: "&#x25CF;", label: "Active Sessions", value: String(activeSessions),
      sub: `${totalSessions} total (48h)`, cls: activeSessions > 0 ? "lss-kpi--ok" : "lss-kpi--dim"
    },
    {
      icon: "&#x26A1;", label: "Tokens In Flight", value: fmtTokens(totalTokens),
      sub: "across active sessions", cls: "lss-kpi--blue"
    },
    contextCritical > 0 ? {
      icon: "&#x26A0;", label: "Context Critical", value: String(contextCritical),
      sub: "sessions will lose work", cls: "lss-kpi--crit"
    } : {
      icon: "&#x2714;", label: "Context Pressure", value: contextWarning > 0 ? String(contextWarning) : "None",
      sub: contextWarning > 0 ? "sessions approaching limit" : "all sessions healthy", cls: contextWarning > 0 ? "lss-kpi--warn" : "lss-kpi--ok"
    },
    orphanPorts > 0 ? {
      icon: "&#x1F47B;", label: "Orphan Ports", value: String(orphanPorts),
      sub: "abandoned, still listening", cls: "lss-kpi--warn"
    } : {
      icon: "&#x1F517;", label: "Orphan Ports", value: "0",
      sub: "no abandoned ports", cls: "lss-kpi--ok"
    },
    trackedSpend != null ? {
      icon: "&#x1F4B0;", label: "Tracked Spend", value: `$${trackedSpend.toFixed(2)}`,
      sub: "session token cost", cls: "lss-kpi--blue"
    } : null
  ].filter(Boolean);

  return `
    <div class="ls-panel lss-panel">
      <div class="lss-header">
        <div class="ls-panel-head" style="margin:0">Fleet Overview <span class="ls-panel-sub">live</span></div>
        <div class="lss-health ${healthCls}">
          <span class="lss-health-score">${healthScore}</span>
          <span class="lss-health-label">${healthLabel}</span>
        </div>
      </div>
      <div class="lss-kpi-grid">
        ${kpis.map((k) => `
          <div class="lss-kpi ${k.cls}">
            <div class="lss-kpi-top">
              <span class="lss-kpi-icon">${k.icon}</span>
              <span class="lss-kpi-label">${k.label}</span>
            </div>
            <div class="lss-kpi-value">${k.value}</div>
            <div class="lss-kpi-sub">${k.sub}</div>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function rlBar(remaining, limit) {
  if (limit == null || limit === 0) return "";
  const pct = Math.min(100, Math.round((remaining / limit) * 100));
  const cls = pct <= 10 ? "ctx-bar--crit" : pct <= 30 ? "ctx-bar--warn" : "ctx-bar--ok";
  return `<div class="ctx-bar-wrap" style="flex:1"><div class="ctx-bar ${cls}" style="width:${pct}%"></div></div>`;
}

function rlResetIn(resetTs) {
  if (!resetTs) return "";
  const ms = new Date(resetTs).getTime() - Date.now();
  if (ms < 0) return "reset soon";
  if (ms < 60000) return `${Math.ceil(ms / 1000)}s`;
  return `${Math.ceil(ms / 60000)}m`;
}

function renderRateLimitsPanel(rl) {
  if (!rl?.anthropic) {
    return `<div class="ls-panel ls-panel--rl">
      <div class="ls-panel-head">Rate Limits <span class="ls-panel-sub">Anthropic API</span></div>
      <p class="ls-empty" style="padding:10px 0">No proxy calls yet — send traffic through<br><code style="font-size:10px">POST /v1/messages</code> to see live quota</p>
    </div>`;
  }
  const a = rl.anthropic;
  const rows = [
    ["Requests", a.requestsRemaining, a.requestsLimit, a.requestsReset],
    ["Tokens/min", a.tokensRemaining, a.tokensLimit, a.tokensReset],
    ["Input tok", a.inputTokensRemaining, a.inputTokensLimit, a.inputTokensReset],
    ["Output tok", a.outputTokensRemaining, a.outputTokensLimit, a.outputTokensReset],
  ].filter(([, rem]) => rem != null);

  const staleMs = Date.now() - (a.capturedAt || 0);
  const staleLabel = staleMs < 5000 ? "live" : staleMs < 60000 ? `${Math.round(staleMs / 1000)}s ago` : `${Math.round(staleMs / 60000)}m ago`;

  return `<div class="ls-panel ls-panel--rl">
    <div class="ls-panel-head">Rate Limits <span class="ls-panel-sub">Anthropic &mdash; ${staleLabel}</span></div>
    <table class="ls-table ls-rl-table">
      <thead><tr><th>Metric</th><th>Remaining</th><th>Quota</th><th>Resets</th></tr></thead>
      <tbody>
        ${rows.map(([label, rem, lim, reset]) => {
          const pct = lim ? Math.min(100, Math.round((rem / lim) * 100)) : null;
          const cls = pct != null && pct <= 10 ? "ls-tok" : pct != null && pct <= 30 ? "ls-amber" : "";
          return `<tr>
            <td class="ls-dim" style="font-size:11px">${label}</td>
            <td class="ls-right ${cls}" style="font-size:12px">${fmtTokens(rem)}</td>
            <td style="padding-left:8px;min-width:80px">${rlBar(rem, lim)}</td>
            <td class="ls-dim" style="font-size:10px;text-align:right">${rlResetIn(reset)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    ${a.retryAfter ? `<p class="ls-rl-warn">&#x26A0; Rate limited — retry in ${a.retryAfter}s</p>` : ""}
  </div>`;
}

function fleetStats(fleet) {
  const { machines = [], summary = {} } = fleet;
  const allSessions = machines.flatMap((m) => m.sessions);
  const orphanPorts = machines.reduce((n, m) =>
    n + m.ports.filter((p) => p.isAgentPort && p.pid === "ORPHAN").length, 0);
  const totalTokens = summary.totalTokens ||
    allSessions.reduce((n, s) => n + (s.totalInputTokens || 0) + (s.totalOutputTokens || 0), 0);
  const trackedSpend = allSessions.reduce((n, s) => {
    const toks = (s.totalInputTokens || 0) + (s.totalOutputTokens || 0);
    return n + toks * 0.000003;
  }, 0);
  return {
    machinesOnline: summary.onlineMachines || machines.filter((m) => m.online).length,
    machinesTotal: summary.totalMachines || machines.length,
    activeSessions: summary.activeSessions || allSessions.filter((s) => s.status === "active").length,
    totalSessions: summary.totalSessions || allSessions.length,
    totalTokens,
    contextCritical: allSessions.filter((s) => (s.contextPct || 0) >= 85).length,
    contextWarning: allSessions.filter((s) => (s.contextPct || 0) >= 70 && (s.contextPct || 0) < 85).length,
    orphanPorts,
    trackedSpend
  };
}

function renderFleetView(fleet, rateLimit) {
  const { machines = [], summary = {} } = fleet;
  const onlineMachines = machines.filter((m) => m.online);
  const offlineMachines = machines.filter((m) => !m.online);

  const machineCards = machines.length === 0
    ? `<div class="fleet-empty">
        <p>No collectors reporting yet.</p>
        <p>Run on each developer machine:</p>
        <pre class="fleet-cmd">node collector.js --url &lt;this-server&gt; --key acp_... --developer alice@company.com</pre>
       </div>`
    : machines.map((m) => {
        const totalTok = m.sessions.reduce((n, s) => n + (s.totalInputTokens || 0) + (s.totalOutputTokens || 0), 0);
        const activeSess = m.sessions.filter((s) => s.status === "active");
        const maxCtx = m.sessions.reduce((n, s) => Math.max(n, s.contextPct || 0), 0);
        const ctxCls = maxCtx >= 90 ? "ctx-bar--crit" : maxCtx >= 70 ? "ctx-bar--warn" : "ctx-bar--ok";
        const onlineCls = m.online ? "fleet-machine--online" : "fleet-machine--offline";
        const beatLabel = m.online ? `${m.ageSec}s ago` : fmtAgo(m.receivedAt);

        return `<div class="fleet-machine ${onlineCls}">
          <div class="fleet-machine-head">
            <span class="fleet-online-dot ${m.online ? "fleet-dot--on" : "fleet-dot--off"}">&#x25CF;</span>
            <span class="fleet-hostname">${escapeHtml(m.hostname)}</span>
            <span class="fleet-dev">${escapeHtml(m.developer || "")}</span>
            <span class="fleet-beat">${beatLabel}</span>
          </div>
          <div class="fleet-machine-stats">
            <span class="fleet-stat-chip fleet-chip--sessions">${activeSess.length} active / ${m.sessions.length} sessions</span>
            <span class="fleet-stat-chip fleet-chip--tokens">${fmtTokens(totalTok)} tokens</span>
            ${maxCtx > 0 ? `<span class="fleet-stat-chip fleet-chip--ctx ${ctxCls.replace("ctx-bar--", "fleet-ctx--")}">${maxCtx}% ctx</span>` : ""}
            ${m.processes.length > 0 ? `<span class="fleet-stat-chip fleet-chip--procs">${m.processes.length} procs</span>` : ""}
          </div>
          ${m.sessions.length > 0 ? `
          <table class="ls-table fleet-sess-table">
            <thead><tr><th>Session</th><th>Project</th><th>Model</th><th>Tokens</th><th>Context</th><th>Last seen</th></tr></thead>
            <tbody>
              ${m.sessions.slice(0, 5).map((s) => {
                const tok = (s.totalInputTokens || 0) + (s.totalOutputTokens || 0);
                return `<tr class="ls-row ls-row--${s.status}">
                  <td class="ls-mono ls-sid">${escapeHtml(s.sessionId.slice(0, 8))}</td>
                  <td class="ls-proj">${escapeHtml(shortProject(s.projectDir))}</td>
                  <td class="ls-model">${escapeHtml(shortModel(s.model))}</td>
                  <td class="ls-right ls-tok">${fmtTokens(tok)}</td>
                  <td class="ls-ctx">${ctxBarHtml(s.contextPct || 0)}</td>
                  <td class="ls-right ls-ago">${fmtAgo(s.lastActivity)}</td>
                </tr>`;
              }).join("")}
            </tbody>
          </table>` : ""}
        </div>`;
      }).join("");

  return `
    <div class="ls-stats-bar">
      <span class="ls-stat"><span class="fleet-dot--on">&#x25CF;</span> ${summary.onlineMachines || 0} online</span>
      <span class="ls-stat ls-dim">&#x25CB; ${(summary.totalMachines || 0) - (summary.onlineMachines || 0)} offline</span>
      <span class="ls-stat"><span class="ls-dot ls-dot--active">&#x25CF;</span> ${summary.activeSessions || 0} active sessions</span>
      <span class="ls-stat ls-dim">${summary.totalSessions || 0} total (48h)</span>
      <span class="ls-stat ls-tok">${fmtTokens(summary.totalTokens || 0)} tokens</span>
      <span class="ls-stat ls-dim fleet-mode-badge">&#x1F4E1; Fleet Mode</span>
    </div>
    <div class="ls-panel-grid">
      <div class="ls-panel ls-panel--sessions fleet-machines-panel">
        <div class="ls-panel-head">Developer Machines <span class="ls-panel-sub">live session state per machine</span></div>
        <div class="fleet-machines-list">${machineCards}</div>
      </div>
      <div class="ls-side-panels">
        ${renderLiveStatsPanel(fleetStats(fleet))}
        ${renderRateLimitsPanel(rateLimit)}
        <div class="ls-panel">
          <div class="ls-panel-head">Setup <span class="ls-panel-sub">add more machines</span></div>
          <p class="fleet-setup-hint">Run on each dev machine:</p>
          <pre class="fleet-cmd-small">node collector.js \\
  --url ${escapeHtml(window.location.origin)} \\
  --key acp_... \\
  --developer name@company.com</pre>
        </div>
      </div>
    </div>
  `;
}

function renderLiveSessionsContent() {
  const el = document.querySelector("#live-sessions-content");
  if (!el) return;

  const d = liveSessionsData;
  if (!d) { el.innerHTML = `<p class="ls-loading">Loading…</p>`; return; }

  if (d.mode === "fleet") {
    el.innerHTML = renderFleetView(d.fleet, d.rateLimit);
    return;
  }

  const { sessions = [], processes = [], ports = [], rateLimit } = d;
  const active = sessions.filter((s) => s.status === "active").length;
  const recent = sessions.filter((s) => s.status === "recent").length;

  const sessionRows = sessions.length === 0
    ? `<tr><td colspan="8" class="ls-empty">No sessions found in ~/.claude/projects (last 48h)</td></tr>`
    : sessions.map((s) => {
        const statusDot = s.status === "active" ? "&#x25CF;" : s.status === "recent" ? "&#x25CB;" : "&#x2219;";
        const statusCls = `ls-dot--${s.status}`;
        const totalTok = (s.totalInputTokens || 0) + (s.totalOutputTokens || 0);
        return `<tr class="ls-row ls-row--${s.status}">
          <td><span class="ls-dot ${statusCls}">${statusDot}</span></td>
          <td class="ls-mono ls-sid">${escapeHtml(s.sessionId.slice(0, 8))}</td>
          <td class="ls-proj" title="${escapeHtml(s.cwd || s.projectDir)}">${escapeHtml(shortProject(s.projectDir))}</td>
          <td class="ls-summary" title="${escapeHtml(s.summary || '')}">${escapeHtml((s.summary || "").slice(0, 40))}${s.summary && s.summary.length > 40 ? "…" : ""}</td>
          <td class="ls-right ls-model">${escapeHtml(shortModel(s.model))}</td>
          <td class="ls-right ls-tok">${fmtTokens(totalTok)}</td>
          <td class="ls-ctx">${ctxBarHtml(s.contextPct || 0)}</td>
          <td class="ls-right ls-ago">${fmtAgo(s.lastActivity)}</td>
        </tr>`;
      }).join("");

  const procRows = processes.length === 0
    ? `<tr><td colspan="4" class="ls-empty">No agent processes detected</td></tr>`
    : processes.map((p) => `<tr>
        <td class="ls-mono">${escapeHtml(p.pid)}</td>
        <td class="ls-type-tag">${escapeHtml(p.type)}</td>
        <td class="ls-right ls-dim">${p.cpu.toFixed(1)}%</td>
        <td class="ls-cmd" title="${escapeHtml(p.cmd)}">${escapeHtml(p.cmd.slice(0, 50))}</td>
      </tr>`).join("");

  const portRows = ports.length === 0
    ? `<tr><td colspan="3" class="ls-empty">No agent ports listening</td></tr>`
    : ports.filter((p) => p.isAgentPort).map((p) => `<tr>
        <td class="ls-mono ls-port-num">:${p.port}</td>
        <td class="ls-dim">${escapeHtml(p.process)} (pid ${escapeHtml(p.pid)})</td>
        <td><button class="ls-kill-btn" data-kill-port="${p.port}" onclick="killPort(${p.port})">&#x2715; Kill</button></td>
      </tr>`).join("") || `<tr><td colspan="3" class="ls-empty">No agent ports listening</td></tr>`;

  el.innerHTML = `
    <div class="ls-stats-bar">
      <span class="ls-stat"><span class="ls-dot ls-dot--active">&#x25CF;</span> ${active} active</span>
      <span class="ls-stat"><span class="ls-dot ls-dot--recent">&#x25CB;</span> ${recent} recent</span>
      <span class="ls-stat ls-dim">${sessions.length} sessions (48h)</span>
      <span class="ls-stat ls-dim">${processes.length} processes</span>
      <span class="ls-stat ls-dim">${ports.filter((p) => p.isAgentPort).length} ports</span>
    </div>

    <div class="ls-panel-grid">
      <div class="ls-panel ls-panel--sessions">
        <div class="ls-panel-head">Sessions <span class="ls-panel-sub">token burn &amp; context window</span></div>
        <div class="ls-table-wrap">
          <table class="ls-table">
            <thead><tr>
              <th></th>
              <th>ID</th>
              <th>Project</th>
              <th>Task</th>
              <th>Model</th>
              <th>Tokens</th>
              <th>Context</th>
              <th>Last seen</th>
            </tr></thead>
            <tbody>${sessionRows}</tbody>
          </table>
        </div>
      </div>

      <div class="ls-side-panels">
        ${renderLiveStatsPanel({
          activeSessions: active,
          totalSessions: sessions.length,
          totalTokens: sessions.reduce((n, s) => n + (s.totalInputTokens || 0) + (s.totalOutputTokens || 0), 0),
          contextCritical: sessions.filter((s) => (s.contextPct || 0) >= 85).length,
          contextWarning: sessions.filter((s) => (s.contextPct || 0) >= 70 && (s.contextPct || 0) < 85).length,
          orphanPorts: ports.filter((p) => p.isAgentPort).length
        })}
        ${renderRateLimitsPanel(rateLimit)}

        <div class="ls-panel ls-panel--ports">
          <div class="ls-panel-head">Ports <span class="ls-panel-sub">orphan detection</span></div>
          <table class="ls-table">
            <thead><tr><th>Port</th><th>Process</th><th></th></tr></thead>
            <tbody>${portRows}</tbody>
          </table>
        </div>

        <div class="ls-panel ls-panel--procs">
          <div class="ls-panel-head">Processes <span class="ls-panel-sub">live agent processes</span></div>
          <table class="ls-table">
            <thead><tr><th>PID</th><th>Type</th><th>CPU</th><th>Command</th></tr></thead>
            <tbody>${procRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderLiveSessionsView() {
  document.querySelector("#view-content").innerHTML = `
    <section class="tab-stage ls-stage">
      <div class="ls-header">
        <div>
          <h2 class="ls-title">Live Sessions</h2>
          <p class="ls-subtitle">Claude Code &middot; Codex CLI &middot; OpenCode &mdash; discovered from local process state</p>
        </div>
        <div class="ls-header-actions">
          <label class="ls-auto-label">
            <input type="checkbox" id="ls-auto-refresh" checked /> auto-refresh 5s
          </label>
          <button class="ls-refresh-btn" onclick="loadLiveSessions()">&#x21BA; Refresh</button>
        </div>
      </div>
      <div id="live-sessions-content"><p class="ls-loading">Scanning local processes…</p></div>
    </section>
  `;

  document.querySelector("#ls-auto-refresh")?.addEventListener("change", (e) => {
    if (e.target.checked) {
      startLiveSessionsPolling();
    } else {
      clearInterval(liveSessionsTimer);
      liveSessionsTimer = null;
    }
  });

  loadLiveSessions();
  startLiveSessionsPolling();
}

function startLiveSessionsPolling() {
  clearInterval(liveSessionsTimer);
  liveSessionsTimer = setInterval(() => {
    if (currentView === "live-sessions") loadLiveSessions();
    else { clearInterval(liveSessionsTimer); liveSessionsTimer = null; }
  }, 5000);
}

function renderAdminView() {
  const tenant = tenantSummary?.tenant || {};
  const connectors = tenantSummary?.connectors || [];
  const currentKeyPrefix = tenantApiKey ? tenantApiKey.slice(0, 12) : "";

  const quickTryAgents = [
    { provider: "github-copilot", label: "GitHub Copilot", icon: "&#xea84;", desc: "Coding agent" },
    { provider: "openai",         label: "OpenAI Agent",   icon: "&#x2B22;", desc: "Responses API" },
    { provider: "anthropic",      label: "Claude Agent",   icon: "&#x2736;", desc: "Messages API" },
    { provider: "generic-webhook",label: "Custom Agent",   icon: "&#x229C;", desc: "Any framework" },
  ];

  document.querySelector("#view-content").innerHTML = `
    <section class="tab-stage admin-stage">

      <article class="panel wide-panel admin-hero">
        <div class="admin-workspace-header">
          <div>
            <p class="eyebrow">Workspace</p>
            <h2>${tenant.name || "Your workspace"}</h2>
          </div>
          <div class="workspace-stats">
            <div><span>Plan</span><strong>${tenant.plan || "Trial"}</strong></div>
            <div><span>Agent runs</span><strong>${tenantSummary?.runCount || 0}</strong></div>
            <div><span>Connected sources</span><strong>${connectors.length}</strong></div>
          </div>
        </div>
      </article>

      <article class="panel wide-panel quick-connect-panel">
        <div class="panel-title">
          <p class="eyebrow">Quick Connect</p>
          <h2>See your agents in Agent Prism — in seconds</h2>
          <p class="panel-subtitle">Pick your agent type below. We'll send a sample run so you can see the dashboard populate live. No code needed.</p>
        </div>
        <div class="quick-try-grid">
          ${quickTryAgents.map((a) => `
            <button class="quick-try-btn test-source-button" data-provider="${a.provider}" type="button">
              <span class="quick-try-icon">${a.icon}</span>
              <strong>${a.label}</strong>
              <span>${a.desc}</span>
              <em>Send sample run &rarr;</em>
            </button>
          `).join("")}
        </div>
        <p class="quick-connect-hint">After clicking, switch to the <strong>Overview</strong> tab to see the run appear live. To connect your real agent, use the sources below.</p>
      </article>

      <article class="panel wide-panel dev-setup-panel">
        <div class="panel-title">
          <p class="eyebrow">For Your Developers</p>
          <h2>Share this with your team — they add 3 lines to their agent</h2>
          <p class="panel-subtitle">Pick the agent type your team built. Copy the snippet and send it to them. That's the entire integration.</p>
        </div>
        <div class="dev-tabs">
          <button class="dev-tab active" data-tab="copilot" type="button">Copilot / Custom</button>
          <button class="dev-tab" data-tab="openai" type="button">OpenAI Agent</button>
          <button class="dev-tab" data-tab="claude" type="button">Claude Agent</button>
        </div>
        <div class="dev-snippet-panels">
          <div class="dev-snippet-panel active" data-panel="copilot">
            <p class="dev-snippet-desc">Your developer adds this after each agent run. Replace the field values with the real agent name, task type, and outcome.</p>
            <div class="dev-snippet-block">
              <button class="copy-snippet-btn" data-target="snippet-copilot" type="button">Copy</button>
              <pre id="snippet-copilot"><code>// 1. Install once: copy src/sdk/index.js into your project as agent-prism-sdk.js
// 2. Add this after each agent run

import { AgentPrism } from "./agent-prism-sdk.js";

const prism = new AgentPrism({
  clientSecret: "${tenantApiKey || "YOUR_AGENT_PRISM_KEY"}",
  endpoint: "${window.location.origin}"
});

await prism.logRun({
  source: "copilot",
  payload: {
    session_id:         "unique-run-id",
    agent_name:         "Your Agent Name",
    intent:             "code-generation",   // what the agent did
    outcome:            "success",           // or "failed"
    started_at:         runStartTime,
    completed_at:       new Date().toISOString(),
    duration_ms:        elapsedMs,
    prompt_tokens:      inputTokens,
    completion_tokens:  outputTokens,
    promptBreakdown: {
      userPromptTokens:   userPromptTokenActuals,
      systemPromptTokens: systemPromptTokenActuals,
      contextTokens:      ragOrRepoContextTokenActuals,
      toolResultTokens:   toolResultTokenActuals,
      memoryTokens:       memoryOrHistoryTokenActuals
    },
    estimated_cost_usd: costUsd,
    workflow:           "your-workflow-name",
    team:               "engineering"
  }
});</code></pre>
            </div>
          </div>
          <div class="dev-snippet-panel" data-panel="openai">
            <p class="dev-snippet-desc">Change one line in your OpenAI agent — swap the base URL. Agent Prism proxies to OpenAI and records every run automatically.</p>
            <div class="dev-snippet-block">
              <button class="copy-snippet-btn" data-target="snippet-openai" type="button">Copy</button>
              <pre id="snippet-openai"><code>// Before — calls OpenAI directly:
// const response = await fetch("https://api.openai.com/v1/responses", ...)

// After — route through Agent Prism (no other changes needed):
const response = await fetch("${window.location.origin}/v1/responses", {
  method: "POST",
  headers: {
    "Content-Type":  "application/json",
    "Authorization": "Bearer ${tenantApiKey || "YOUR_AGENT_PRISM_KEY"}"
    // Agent Prism forwards your OpenAI key automatically once configured
  },
  body: JSON.stringify({
    model: "gpt-4.1-mini",
    input: "Your agent prompt here"
  })
});</code></pre>
            </div>
          </div>
          <div class="dev-snippet-panel" data-panel="claude">
            <p class="dev-snippet-desc">Same idea — change the base URL in your Claude agent. Agent Prism proxies to Anthropic and records the run.</p>
            <div class="dev-snippet-block">
              <button class="copy-snippet-btn" data-target="snippet-claude" type="button">Copy</button>
              <pre id="snippet-claude"><code>// Before — calls Anthropic directly:
// const response = await fetch("https://api.anthropic.com/v1/messages", ...)

// After — route through Agent Prism (no other changes needed):
const response = await fetch("${window.location.origin}/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type":  "application/json",
    "x-api-key":     "${tenantApiKey || "YOUR_AGENT_PRISM_KEY"}"
    // Agent Prism forwards your Claude key automatically once configured
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: "Your agent prompt here" }]
  })
});</code></pre>
            </div>
          </div>
        </div>
      </article>

      <article class="panel wide-panel connector-marketplace">
        <div class="panel-title">
          <p class="eyebrow">Agent Sources</p>
          <h2>Connect your AI agents</h2>
        </div>
        ${adminActionMessage ? `<p class="admin-message">${adminActionMessage}</p>` : ""}
        <div class="connector-grid">
          ${connectorCatalog.length ? connectorCatalog.map((item) => {
            const existing = connectors.find((connector) => connector.provider === item.provider);
            const isConnected = !!existing;
            const hasSecret = !!existing?.hasSecret;
            const fullyReady = isConnected && (!item.requiresSecret || hasSecret);
            const needsKey = item.requiresSecret && (!isConnected || !hasSecret);
            const statusLabel = fullyReady ? "Active" : needsKey ? "Needs setup" : "Not connected";

            return `
            <div class="connector-card ${fullyReady ? "connector-card--active" : ""}">
              <div class="connector-card-top">
                <div>
                  <strong>${item.name}</strong>
                  <span>${item.category}</span>
                </div>
                <span class="connector-status ${fullyReady ? "connected" : ""}">${statusLabel}</span>
              </div>
              <p>${item.setup}</p>
              ${needsKey ? `
                <div class="connector-action-zone primary-action">
                  <form class="connector-form" data-provider="${item.provider}" data-name="${item.name}" data-mode="${item.mode}">
                    <input name="apiKey" placeholder="${item.provider === "anthropic" ? "Paste your Claude API key" : "Paste your OpenAI API key"}" />
                    <button type="submit">${isConnected ? "Save" : "Connect"}</button>
                  </form>
                </div>
              ` : !item.requiresSecret && !isConnected ? `
                <div class="connector-action-zone">
                  <button class="ghost connect-source-button" data-provider="${item.provider}" data-name="${item.name}" data-mode="${item.mode}" type="button">Add source</button>
                </div>
              ` : item.requiresSecret && fullyReady ? `
                <div class="connector-action-zone">
                  <button class="ghost rotate-key-button" data-provider="${item.provider}" type="button">Rotate API key</button>
                </div>
              ` : ""}
              <div class="connector-footer">
                <button class="ghost test-source-button" data-provider="${item.provider}" type="button">Send sample run</button>
              </div>
            </div>
          `}).join("") : `<p class="muted">Loading agent sources…</p>`}
        </div>
      </article>

      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Access Keys</p>
          <h2>Workspace credentials</h2>
        </div>
        <div class="inline-admin-form-row">
          <form id="create-key-form" class="inline-admin-form">
            <input name="name" placeholder="Key name — e.g. Production agent" value="Demo agent key" />
            <button type="submit">Create key</button>
          </form>
          <div class="key-bulk-actions">
            ${tenantApiKeys.filter(k => k.status !== "active").length > 0
              ? `<button id="revoke-all-button" class="ghost danger-ghost">Revoke all inactive</button>`
              : ""}
            ${tenantApiKeys.length > 1
              ? `<button id="delete-all-keys-button" class="ghost danger-ghost">🗑 Delete all keys</button>`
              : ""}
          </div>
        </div>
        <p id="new-key-output" class="secret-output" hidden></p>
        <div class="admin-list">
          ${tenantApiKeys.length ? tenantApiKeys.map((key) => {
            const isCurrentKey = key.prefix === currentKeyPrefix;
            const isRevoked = key.status !== "active";
            return `
            <div class="admin-row ${isRevoked ? "admin-row--revoked" : ""}">
              <div>
                <strong>${escapeHtml(key.name)}</strong>
                <span class="${isRevoked ? "muted" : ""}">
                  ${isRevoked ? '<span class="leak-badge leak-badge--high">Revoked</span>' : '<span class="leak-badge leak-badge--low">Active</span>'}
                  ${isCurrentKey ? " · this session" : ""} · created ${formatDate(key.createdAt)} · last used ${formatDate(key.lastUsedAt)}
                </span>
              </div>
              <div class="key-actions">
                ${!isRevoked && !isCurrentKey ? `<button class="ghost revoke-key-button" data-key-id="${key.id}">Revoke</button>` : ""}
                ${isCurrentKey ? `<span class="muted">In use</span>` : ""}
                ${isRevoked ? `<button class="ghost danger-ghost delete-key-button" data-key-id="${key.id}" data-key-name="${escapeHtml(key.name)}">Delete</button>` : ""}
              </div>
            </div>
          `}).join("") : `<p class="muted">No access keys yet.</p>`}
        </div>
      </article>

      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Compliance</p>
          <h2>Activity log</h2>
        </div>
        <div class="admin-actions">
          <button id="export-audit-button" type="button">Download CSV</button>
        </div>
        <p class="muted" style="margin-bottom:12px">Scoped to this workspace. Never includes full API secrets. For long-term retention use <code>STORAGE_BACKEND=postgres</code>.</p>
        <div id="audit-log-table-wrap" class="audit-log-wrap">
          <p class="muted">Loading activity log…</p>
        </div>
      </article>

      <article class="panel wide-panel danger-zone-panel">
        <div class="panel-title">
          <p class="eyebrow" style="color:var(--red)">Danger Zone</p>
          <h2>Workspace data</h2>
        </div>
        <div class="danger-zone-row">
          <div>
            <strong>Reset tenant data</strong>
            <p class="muted" style="margin:4px 0 0;font-size:0.83rem">Wipes all agent runs, audit logs, and token coach snapshots for this workspace. Connectors and API keys are kept. Cannot be undone.</p>
          </div>
          <button id="reset-data" class="danger-ghost ghost">Reset tenant data</button>
        </div>
      </article>
    </section>
  `;

  document.querySelectorAll(".dev-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".dev-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".dev-snippet-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.querySelector(`.dev-snippet-panel[data-panel="${tab.dataset.tab}"]`).classList.add("active");
    });
  });
  document.querySelectorAll(".copy-snippet-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const pre = document.getElementById(btn.dataset.target);
      navigator.clipboard.writeText(pre.innerText).then(() => {
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy"; }, 2000);
      });
    });
  });
  document.querySelector("#create-key-form").addEventListener("submit", createTenantKey);
  document.querySelectorAll(".revoke-key-button").forEach((button) => {
    button.addEventListener("click", () => revokeTenantKey(button.dataset.keyId));
  });
  document.querySelectorAll(".delete-key-button").forEach((button) => {
    button.addEventListener("click", () => deleteTenantKey(button.dataset.keyId, button.dataset.keyName));
  });
  if (document.querySelector("#revoke-all-button")) {
    document.querySelector("#revoke-all-button").addEventListener("click", revokeAllInactiveKeys);
  }
  if (document.querySelector("#delete-all-keys-button")) {
    document.querySelector("#delete-all-keys-button").addEventListener("click", deleteAllTenantKeys);
  }
  loadAuditLogTable();
  document.querySelector("#reset-data").addEventListener("click", async () => {
    if (!tenantApiKey && !currentUser) {
      renderSetupScreen("login", "Sign in before resetting data.");
      return;
    }
    if (!confirm("Reset all agent runs and audit logs for this workspace? API keys and connectors are kept. This cannot be undone.")) return;
    await postAction("/api/reset");
    localStorage.removeItem(COACH_SNAPSHOTS_KEY);
    certificationData = null;
  });
  document.querySelectorAll(".connector-form").forEach((form) => {
    form.addEventListener("submit", connectCatalogSource);
  });
  document.querySelectorAll(".connect-source-button").forEach((button) => {
    button.addEventListener("click", () => connectCatalogSource(null, button.dataset));
  });
  document.querySelectorAll(".rotate-key-button").forEach((button) => {
    button.addEventListener("click", () => showRotateKeyForm(button.dataset.provider));
  });
  document.querySelectorAll(".test-source-button").forEach((button) => {
    button.addEventListener("click", () => testCatalogSource(button.dataset.provider));
  });
  document.querySelector("#export-audit-button").addEventListener("click", exportAuditCsv);
}

function showRotateKeyForm(provider) {
  const source = connectorCatalog.find((item) => item.provider === provider);
  adminActionMessage = `Paste the new ${source?.name || provider} API key below and click Save.`;
  const connector = tenantSummary?.connectors?.find((item) => item.provider === provider);
  if (connector) {
    connector.hasSecret = false;
  }
  renderCurrentView();
}

function renderCurrentView() {
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === currentView);
  });
  document.querySelector("#metrics-grid").hidden = currentView === "admin" || currentView === "live-sessions";

  const workspace = document.querySelector(".workspace");
  if (workspace) {
    const needsScroll = currentView === "admin" || currentView === "tokens" || currentView === "analytics" || currentView === "governance" || currentView === "activity" || currentView === "advisor" || currentView === "live-sessions";
    workspace.classList.toggle("admin-scroll", needsScroll);
  }

  if (currentView !== "live-sessions") {
    clearInterval(liveSessionsTimer);
    liveSessionsTimer = null;
  }

  if (currentView === "activity") {
    renderActivityView();
  } else if (currentView === "tokens") {
    renderTokenCoachView();
  } else if (currentView === "analytics") {
    renderAnalyticsView();
  } else if (currentView === "governance") {
    renderGovernanceView();
  } else if (currentView === "advisor") {
    renderAdvisorView();
  } else if (currentView === "live-sessions") {
    renderLiveSessionsView();
  } else if (currentView === "admin") {
    renderAdminView();
  } else {
    renderOverview();
  }
}

function attachViewTabs() {
  document.querySelectorAll(".view-tab").forEach((button) => {
    button.addEventListener("click", () => {
      currentView = button.dataset.view;
      renderCurrentView();
    });
  });
}

function renderAgentList(agents) {
  document.querySelector("#agent-list").innerHTML =
    agents.length === 0
      ? `<article class="agent-card"><p>No runs yet. Ingest your first Copilot or Claude session to start monitoring.</p></article>`
      : agents
          .map((agent, index) => {
            const latest = agent.latestRun;
            return `
              <article class="agent-card compact-agent-card ${index === 0 ? "active" : ""}">
                <div class="agent-top">
                  <div>
                    <div class="agent-name">${agent.agentName}</div>
                    <div class="agent-role">${latest.taskType} · ${agent.team}</div>
                  </div>
                  <span class="status-label ${statusClass(agent.status)}">${agent.status}</span>
                </div>
                <div class="progress-track">
                  <div class="progress-bar" style="width: ${agent.progressPercent}%"></div>
                </div>
                <div class="agent-microstats">
                  <span class="microstat">${agent.tasksDone} done</span>
                  <span class="microstat">${Math.round(agent.avgLatencyMs / 1000)}s avg</span>
                  <span class="microstat">${compactNumber(agent.totalTokens)} tok</span>
                </div>
              </article>
            `;
          })
          .join("");
}

function renderSelectedAgent(agent) {
  if (!agent) {
    document.querySelector("#selected-agent-panel").innerHTML = `
      <div class="detail-subpanel">
        <p class="eyebrow">Getting Started</p>
        <h3 class="detail-task">No agent runs yet</h3>
        <p class="usp-summary">Create a Copilot connector, emit telemetry to <code>/api/ingest</code>, and your first agent will appear here.</p>
      </div>
    `;
    return;
  }

  const logs = (agent.latestRun.breadcrumbs || [])
    .map(
      (entry, index) => {
        const text = typeof entry === "string"
          ? entry
          : entry.message || entry.value || JSON.stringify(entry);
        return `
        <div class="log-row">
          <div class="feed-time">${new Date(new Date(agent.latestRun.startTime).getTime() + index * 15000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
          <div class="feed-level ${levelClass(index % 4 === 0 ? "info" : index % 4 === 1 ? "tool" : index % 4 === 2 ? "warn" : "success")}">${index % 4 === 0 ? "INFO" : index % 4 === 1 ? "TOOL" : index % 4 === 2 ? "WARN" : "DONE"}</div>
          <div class="feed-agent">${agent.agentName}</div>
          <div>${text}</div>
        </div>
      `;
      }
    )
    .join("");

  document.querySelector("#selected-agent-panel").innerHTML = `
    <div class="detail-header">
      <div class="detail-icon">AI</div>
      <div>
        <h2>${agent.agentName}</h2>
        <p class="detail-copy">${agent.latestRun.taskType} · ${agent.provider} · ${agent.model}</p>
      </div>
    </div>

    <div class="detail-subpanel">
      <p class="eyebrow">Current Task</p>
      <h3 class="detail-task">${agent.currentTask}</h3>
      <div class="detail-progress-row">
        <span>${agent.workflow}</span>
        <span>${agent.progressPercent}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-bar" style="width: ${agent.progressPercent}%"></div>
      </div>
    </div>

      <div class="detail-stats">
      <div class="detail-stat-card">
        <span class="muted">Status</span>
        <strong>${agent.status}</strong>
      </div>
      <div class="detail-stat-card">
        <span class="muted">Tasks Done</span>
        <strong>${agent.tasksDone}</strong>
      </div>
      <div class="detail-stat-card">
        <span class="muted">Tokens</span>
        <strong>${compactNumber(agent.totalTokens)}</strong>
      </div>
      <div class="detail-stat-card">
        <span class="muted">Latency</span>
        <strong>${Math.round(agent.avgLatencyMs / 1000)}s</strong>
      </div>
    </div>

    <div class="detail-subpanel">
      <p class="eyebrow">Agent Logs</p>
      <div class="detail-logs">${logs || "<p class='muted'>No logs available.</p>"}</div>
    </div>
  `;
}

function renderActivityFeed(feed) {
  document.querySelector("#activity-feed").innerHTML =
    feed.length === 0
      ? `<div class="detail-subpanel"><p class="usp-summary">Activity will appear here once your tenant starts sending agent traces.</p></div>`
      : feed
          .map(
            (item) => `
              <div class="feed-row">
                <div class="feed-time">${new Date(item.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                <div class="feed-agent">${item.agentName}</div>
                <div class="feed-level ${levelClass(item.level)}">${item.level.toUpperCase()}</div>
                <div class="feed-message">${item.message}</div>
              </div>
            `
          )
          .join("");
}


function renderLeaks(leaks) {
  document.querySelector("#leak-list").innerHTML =
    leaks.length === 0
      ? `<article class="leak-card"><h3>No active cost leaks</h3><p>Spend is within expected limits for this tenant.</p></article>`
      : leaks
          .map(
            (leak) => `
              <article class="leak-card">
                <p class="eyebrow">${leak.leakType}</p>
                <h3>${leak.agentName}</h3>
                <p>${leak.workflow} · ${leak.provider}</p>
                <div class="row-between"><span class="muted">Spend</span><strong>${currency(leak.costUsd)}</strong></div>
                <div class="row-between"><span class="muted">Budget</span><strong>${currency(leak.budgetUsd)}</strong></div>
                <div class="row-between"><span class="muted">Retries</span><strong>${leak.retryCount}</strong></div>
                <p>${leak.recommendation}</p>
              </article>
            `
          )
          .join("");
}

function renderWorkflows(workflows) {
  document.querySelector("#workflow-cards").innerHTML =
    workflows.length === 0
      ? `<article class="workflow-card"><p>No workflow analytics yet. Start ingesting tenant telemetry.</p></article>`
      : workflows
          .map(
            (item) => `
              <article class="workflow-card">
                <p class="eyebrow">${item.workflow}</p>
                <h3>${currency(item.costUsd)} spend</h3>
                <div class="row-between"><span class="muted">Latency</span><strong>${Math.round(item.avgLatencyMs / 1000)}s</strong></div>
                <div class="row-between"><span class="muted">Control score</span><strong>${item.avgScore}</strong></div>
                <div class="row-between"><span class="muted">Failures</span><strong>${item.failures}</strong></div>
              </article>
            `
          )
          .join("");
}

function renderUsp(usp) {
  document.querySelector("#usp-name").textContent = usp.name;
  document.querySelector("#usp-summary").textContent = usp.summary;
  document.querySelector("#usp-pillars").innerHTML = usp.pillars
    .map((pillar) => `<span class="badge">${pillar}</span>`)
    .join("");
}

function renderAuditLogs(logs) {
  document.querySelector("#audit-logs-body").innerHTML =
    (!logs || logs.length === 0)
      ? `<tr><td colspan="3">No audit logs found.</td></tr>`
      : logs.map(log => `
          <tr>
            <td>${new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
            <td>${log.actor}</td>
            <td>${log.action}</td>
          </tr>
        `).join("");
}

function renderDashboard(data) {
  dashboardState = data;
  purgeStaleSavingsSnapshots(data.headlineMetrics);
  renderMetrics(data.headlineMetrics);
  renderCurrentView();
}

function purgeStaleSavingsSnapshots(metrics) {
  // Snapshots saved against old data (e.g. before a tenant reset) produce
  // absurd savings banners. Purge any snapshot whose projected monthly cost
  // at view-time is more than 5× the current projected cost, AND current
  // run count is tiny — that combination means the data context changed.
  const currMonthly = metrics?.projectedMonthlyCost || 0;
  const currRuns = metrics?.totalRuns || 0;
  const snaps = getCoachSnapshots();
  let changed = false;
  for (const [key, snap] of Object.entries(snaps)) {
    const staleHighCost = (snap.projectedAtView || 0) > Math.max(currMonthly * 5, 1);
    const fewRunsNow = currRuns < 5;
    if (staleHighCost && fewRunsNow) { delete snaps[key]; changed = true; }
  }
  if (changed) localStorage.setItem(COACH_SNAPSHOTS_KEY, JSON.stringify(snaps));
}

async function loadTenantSummary() {
  const data = await request("/api/tenant");
  tenantSummary = data;
  const userLabel = currentUser ? `${currentUser.name || currentUser.email} · ` : "";
  document.querySelector("#active-agents").textContent = `${userLabel}${data.tenant.name} · ${data.connectors.length} connectors`;
}

async function loadDashboard() {
  const [data, auditData, keysData, catalogData, advisorData] = await Promise.all([
    request("/api/dashboard"),
    request("/api/audit").catch(() => ({ auditLogs: [] })),
    request("/api/tenant/api-keys").catch(() => ({ keys: [] })),
    request("/api/connectors/catalog").catch(() => ({ connectors: [] })),
    request("/api/ai-advisor").catch((error) => ({
      status: "unavailable",
      provider: "ollama",
      model: "llama3.1",
      message: error.message || "AI Advisor is unavailable."
    }))
  ]);
  dashboardAuditLogs = auditData.auditLogs || [];
  tenantApiKeys = keysData.keys || [];
  connectorCatalog = catalogData.connectors || [];
  aiAdvisorState = advisorData;
  renderDashboard(data);
}

async function createTenantKey(event) {
  event.preventDefault();
  adminActionMessage = "";
  try {
    const form = new FormData(event.currentTarget);
    const result = await request("/api/tenant/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.get("name") || "Tenant API key" })
    });
    await loadTenantSummary();
    await loadDashboard();
    currentView = "admin";
    renderCurrentView();
    const output = document.querySelector("#new-key-output");
    output.hidden = false;
    output.textContent = `New key: ${result.apiKey}`;
  } catch (error) {
    adminActionMessage = error.message;
    renderCurrentView();
  }
}

async function revokeTenantKey(keyId) {
  adminActionMessage = "";
  try {
    await request(`/api/tenant/api-keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
    adminActionMessage = "API key revoked.";
    await loadTenantSummary();
    await loadDashboard();
    currentView = "admin";
    renderCurrentView();
  } catch (error) {
    adminActionMessage = error.message;
    renderCurrentView();
  }
}

async function connectCatalogSource(event, dataset = null) {
  if (event) event.preventDefault();
  adminActionMessage = "";
  const source = dataset || event.currentTarget.dataset;
  const form = event ? new FormData(event.currentTarget) : null;
  const apiKey = form ? String(form.get("apiKey") || "") : "";
  const button = event
    ? event.currentTarget.querySelector("button")
    : document.querySelector(`.connect-source-button[data-provider="${source.provider}"]`);
  const originalLabel = button?.textContent;

  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Connecting...";
    }
    await request("/api/connectors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: source.provider,
        name: source.name,
        mode: source.mode || "webhook",
        apiKey: apiKey || undefined,
        setupMethod: "connector-marketplace"
      })
    });
    adminActionMessage = `${source.name} is connected for this tenant. Use Send test event to confirm dashboard telemetry.`;
    await loadTenantSummary();
    await loadDashboard();
    currentView = "admin";
    renderCurrentView();
  } catch (error) {
    adminActionMessage = error.message;
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
    renderCurrentView();
  }
}

async function testCatalogSource(provider) {
  adminActionMessage = "";
  const button = document.querySelector(`.test-source-button[data-provider="${provider}"]`);
  const originalLabel = button?.textContent;
  try {
    if (button) {
      button.disabled = true;
      button.textContent = "Sending...";
    }
    const result = await request("/api/connectors/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider })
    });
    adminActionMessage = `${result.normalizedRun.agentName} test event sent. Overview and Token Coach now include this source.`;
    await loadTenantSummary();
    await loadDashboard();
    currentView = "admin";
    renderCurrentView();
  } catch (error) {
    adminActionMessage = error.message;
    if (button) {
      button.disabled = false;
      button.textContent = originalLabel;
    }
    renderCurrentView();
  }
}

async function deleteTenantKey(keyId, keyName) {
  if (!confirm(`Permanently delete key "${keyName}"? This cannot be undone.`)) return;
  adminActionMessage = "";
  try {
    await request(`/api/tenant/api-keys/${encodeURIComponent(keyId)}/permanent`, { method: "DELETE" });
    adminActionMessage = `Key "${keyName}" permanently deleted.`;
    await loadTenantSummary();
    await loadDashboard();
    currentView = "admin";
    renderCurrentView();
  } catch (error) {
    adminActionMessage = error.message;
    renderCurrentView();
  }
}

async function revokeAllInactiveKeys() {
  if (!confirm("Revoke all non-active keys? Active keys in use will not be affected.")) return;
  adminActionMessage = "";
  try {
    const { keys } = await request("/api/tenant/api-keys");
    const inactive = (keys || []).filter((k) => k.status !== "active");
    await Promise.all(inactive.map((k) => request(`/api/tenant/api-keys/${encodeURIComponent(k.id)}`, { method: "DELETE" })));
    adminActionMessage = `${inactive.length} key${inactive.length !== 1 ? "s" : ""} revoked.`;
    await loadTenantSummary();
    await loadDashboard();
    currentView = "admin";
    renderCurrentView();
  } catch (error) {
    adminActionMessage = error.message;
    renderCurrentView();
  }
}

async function deleteAllTenantKeys() {
  if (!confirm("Permanently delete ALL access keys except the one in use right now?\n\nThis cannot be undone.")) return;
  adminActionMessage = "";
  const btn = document.querySelector("#delete-all-keys-button");
  if (btn) { btn.disabled = true; btn.textContent = "Deleting…"; }
  try {
    const result = await request("/api/tenant/api-keys", { method: "DELETE" });
    adminActionMessage = `Deleted ${result.deleted} key${result.deleted !== 1 ? "s" : ""}. Workspace is clean.`;
    await loadTenantSummary();
    await loadDashboard();
    currentView = "admin";
    renderCurrentView();
  } catch (error) {
    adminActionMessage = `Delete failed: ${error.message}`;
    if (btn) { btn.disabled = false; btn.textContent = "🗑 Delete all keys"; }
    renderCurrentView();
  }
}

async function loadAuditLogTable() {
  const wrap = document.querySelector("#audit-log-table-wrap");
  if (!wrap) return;
  try {
    const data = await request("/api/audit");
    const logs = data.auditLogs || [];
    if (!logs.length) {
      wrap.innerHTML = `<p class="muted">No activity recorded yet.</p>`;
      return;
    }
    wrap.innerHTML = `
      <div class="audit-scroll">
        <table class="audit-table">
          <thead><tr>
            <th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>IP</th>
          </tr></thead>
          <tbody>
            ${logs.slice(0, 100).map((log) => `
              <tr>
                <td class="muted">${formatDate(log.timestamp)}</td>
                <td>${escapeHtml(log.actor || "")}</td>
                <td><strong>${escapeHtml(log.action || "")}</strong></td>
                <td class="muted">${escapeHtml(log.resource || "")}</td>
                <td class="muted">${escapeHtml(log.ip || "")}</td>
              </tr>`).join("")}
          </tbody>
        </table>
        ${logs.length > 100 ? `<p class="muted" style="padding:8px">Showing 100 of ${logs.length} entries. Download CSV for full export.</p>` : ""}
      </div>`;
  } catch {
    wrap.innerHTML = `<p class="muted">Could not load activity log.</p>`;
  }
}

async function exportAuditCsv() {
  const response = await fetch("/api/audit/export", {
    headers: tenantApiKey ? { "x-api-key": tenantApiKey } : {}
  });

  if (!response.ok) {
    throw new Error("Could not export audit data.");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "agent-prism-audit.csv";
  link.click();
  URL.revokeObjectURL(url);
}

async function postAction(path) {
  await request(path, { method: "POST" });
  await loadDashboard();
}

function renderSplash() {
  document.querySelector("#workspace").innerHTML = `
    <div class="ap-splash">
      <div class="login-orbs">
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
        <div class="orb orb-3"></div>
      </div>
      <div class="login-grid"></div>
      <div class="ap-splash-center">
        <div class="ap-splash-mark">AP</div>
        <div class="ap-splash-title">Agent Prism</div>
        <div class="ap-splash-sub">AI Governance Command Center</div>
        <div class="ap-splash-dots"><span></span><span></span><span></span></div>
      </div>
    </div>`;
}

async function initializeApp() {
  renderSplash();
  try {
    const bootstrap = await request("/api/bootstrap/status");

    if (!bootstrap.bootstrapped) {
      renderSetupScreen("bootstrap");
      return;
    }

    if (!tenantApiKey) {
      try {
        const me = await request("/api/me");
        currentUser = me.user;
      } catch {
        const ssoError = new URLSearchParams(window.location.search).get("sso_error");
        const msg = ssoError ? `SSO error: ${decodeURIComponent(ssoError)}` : "";
        renderSetupScreen("login", msg);
        return;
      }
    }

    // Parallel: tenant info + critical dashboard data — eliminates serial waterfall
    const [, dashData] = await Promise.all([
      loadTenantSummary(),
      request("/api/dashboard")
    ]);
    // Render shell ONCE with real tenant name (was rendering twice before)
    const tName = tenantSummary?.tenant?.name || "";
    document.querySelector("#workspace").innerHTML = buildWorkspaceShell(tName);
    document.querySelector("#workspace").classList.add("workspace-business");
    attachViewTabs();
    // Overview renders immediately without waiting for secondary tabs
    renderDashboard(dashData);
    // Deferred: audit/keys/catalog/advisor load in background, unblock the overview
    Promise.all([
      request("/api/audit").catch(() => ({ auditLogs: [] })),
      request("/api/tenant/api-keys").catch(() => ({ keys: [] })),
      request("/api/connectors/catalog").catch(() => ({ connectors: [] })),
      request("/api/ai-advisor").catch((e) => ({
        status: "unavailable",
        provider: "ollama",
        model: "llama3.1",
        message: e.message || "AI Advisor is unavailable."
      }))
    ]).then(([auditData, keysData, catalogData, advisorData]) => {
      dashboardAuditLogs = auditData.auditLogs || [];
      tenantApiKeys = keysData.keys || [];
      connectorCatalog = catalogData.connectors || [];
      aiAdvisorState = advisorData;
      if (currentView === "admin" || currentView === "advisor") renderCurrentView();
    });
  } catch (error) {
    if (error.status === 401) {
      tenantApiKey = "";
      localStorage.removeItem("acp_api_key");
      currentUser = null;
      renderSetupScreen("login", error.message);
      return;
    }

    document.body.innerHTML = `<pre>${error.message}</pre>`;
  }
}

document.querySelector("#save-api-key").addEventListener("click", () => {
  renderSetupScreen("api-key");
});


document.querySelector("#logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  tenantApiKey = "";
  currentUser = null;
  localStorage.removeItem("acp_api_key");
  renderSetupScreen("login");
});

// ── Theme toggle ─────────────────────────────────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem("ap_theme") || "dark";
  applyTheme(saved);
})();

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("ap_theme", theme);
  const iconDark  = document.querySelector(".theme-icon-dark");
  const iconLight = document.querySelector(".theme-icon-light");
  if (iconDark)  iconDark.style.display  = theme === "dark"  ? "inline" : "none";
  if (iconLight) iconLight.style.display = theme === "light" ? "inline" : "none";
}

document.getElementById("theme-toggle")?.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme || "dark";
  applyTheme(current === "dark" ? "light" : "dark");
});

// ── Dashboard entrance animation ──────────────────────────────────────────────
function triggerDashEntrance() {
  requestAnimationFrame(() => {
    document.querySelectorAll(".business-card").forEach((card, i) => {
      card.classList.add("dash-animate");
      card.style.animationDelay = `${i * 55}ms`;
    });
  });
}

// ── Scroll reveal (IntersectionObserver) ─────────────────────────────────────
let _scrollObserver = null;
function initScrollReveal() {
  if (_scrollObserver) _scrollObserver.disconnect();
  _scrollObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("revealed");
          _scrollObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );
  document.querySelectorAll(".reveal-on-scroll").forEach((el) => {
    _scrollObserver.observe(el);
  });
}

initializeApp().then(() => {
  setTimeout(() => {
    triggerDashEntrance();
    initScrollReveal();
  }, 200);
}).catch(() => {});
