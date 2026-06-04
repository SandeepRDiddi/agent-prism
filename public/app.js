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

const workspaceShell = `
  <section class="clean-dashboard">
    <nav class="view-tabs" aria-label="Dashboard views">
      <button class="view-tab active" data-view="overview" type="button">Overview</button>
      <button class="view-tab" data-view="activity" type="button">Activity</button>
      <button class="view-tab" data-view="tokens" type="button">Token Coach</button>
      <button class="view-tab" data-view="governance" type="button">Governance</button>
      <button class="view-tab" data-view="admin" type="button">Admin</button>
    </nav>
    <section class="metrics-grid cockpit-metrics" id="metrics-grid"></section>
    <section class="view-content" id="view-content"></section>
  </section>
`;

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

function renderSetupScreen(type, message = "") {
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
          ${message ? `<p class="usp-summary">${message}</p>` : ""}
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
    workspace.innerHTML = `
      <section class="setup-screen">
        <article class="panel setup-card setup-card--login">
          <p class="eyebrow">Enterprise Login</p>
          <h2>Sign in to your tenant workspace</h2>
          <p class="usp-summary">Use your company admin account. Agent API keys remain available for SDKs and automation.</p>
          <form id="login-form" class="field-stack">
            <input name="email" type="email" placeholder="Work email" required />
            <input name="password" type="password" placeholder="Password" minlength="8" required />
            <div class="setup-actions">
              <button type="submit">Sign in</button>
            </div>
          </form>
          <details class="setup-secondary">
            <summary>Developer API key access</summary>
            <form id="api-key-form" class="compact-auth-form">
              <input name="apiKey" placeholder="Paste tenant API key, acp_..." />
              <button type="submit">Connect</button>
            </form>
          </details>
          <details class="setup-secondary">
            <summary>Generate browser key with admin secret</summary>
            <form id="generate-api-key-form" class="compact-auth-form">
              <input name="adminSecret" type="password" placeholder="Admin secret" required />
              <button type="submit">Generate key</button>
            </form>
          </details>
          ${message ? `<p class="usp-summary">${message}</p>` : ""}
        </article>
      </section>
    `;

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

    attachApiKeySetupForms("login");
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
    ["Control Score", metrics.averageControlScore, `${Math.round(metrics.averageLatencyMs / 1000)}s avg latency`, "blue"]
  ];

  document.querySelector("#metrics-grid").innerHTML = cards
    .map(
      ([label, value, detail, tone]) => `
        <article class="metric-card">
          <p class="eyebrow">${label}</p>
          <div class="metric-value ${tone}">${value}</div>
          <p>${detail}</p>
        </article>
      `
    )
    .join("");
}

function providerInitial(provider) {
  return String(provider || "?").slice(0, 1).toUpperCase();
}

function topAgent() {
  return dashboardState.agentProfiles[0] || null;
}

function renderOverview() {
  const agent = topAgent();
  const providers = dashboardState.providerComparison.slice(0, 3);
  const latestRuns = dashboardState.recentRuns.slice(0, 3);
  const topWorkflow = dashboardState.workflowInsights[0];
  const leakCount = dashboardState.costLeaks.length;

  document.querySelector("#view-content").innerHTML = `
    <section class="overview-stage">
      <article class="panel hero-agent-card">
        <div class="hero-copy">
          <p class="eyebrow">Primary Signal</p>
          <h2>${agent ? agent.agentName : "No active agent runs yet"}</h2>
          <p>${agent ? agent.currentTask : "Connect Claude, OpenAI, Copilot, or a custom agent to start comparing cost, quality, and risk."}</p>
        </div>
        <div class="hero-score">
          <span>Control Score</span>
          <strong>${dashboardState.headlineMetrics.averageControlScore}</strong>
        </div>
        <div class="hero-strip">
          <div><span>Status</span><strong>${agent ? agent.status : "Waiting"}</strong></div>
          <div><span>Workflow</span><strong>${agent ? agent.workflow : "Not started"}</strong></div>
          <div><span>Spend</span><strong>${currency(dashboardState.headlineMetrics.totalCostUsd)}</strong></div>
        </div>
      </article>

      <article class="panel business-card">
        <p class="eyebrow">Provider Mix</p>
        <div class="provider-tiles">
          ${providers.length ? providers.map((row) => `
            <div class="provider-tile">
              <div class="provider-mark">${providerInitial(row.provider)}</div>
              <div>
                <strong>${row.provider}</strong>
                <span>${row.runs} runs · ${row.successRate}% success</span>
              </div>
            </div>
          `).join("") : `<p class="muted">Provider comparison appears after the first run.</p>`}
        </div>
      </article>

      <article class="panel business-card">
        <p class="eyebrow">Risk Posture</p>
        <div class="risk-posture ${leakCount ? "watch" : "clear"}">
          <strong>${leakCount ? `${leakCount} cost leaks` : "No active cost leaks"}</strong>
          <span>${leakCount ? "Review governance tab before scaling this workflow." : "Spend is inside expected budget limits."}</span>
        </div>
        <div class="compact-fact">
          <span>Top workflow</span>
          <strong>${topWorkflow ? topWorkflow.workflow : "No workflow data"}</strong>
        </div>
      </article>

      <article class="panel business-card">
        <p class="eyebrow">Latest Signals</p>
        <div class="signal-list">
          ${latestRuns.length ? latestRuns.map((run) => `
            <div class="signal-row">
              <span>${run.agentName}</span>
              <strong>${currency(run.costUsd)} · ${Math.round(run.latencyMs / 1000)}s</strong>
            </div>
          `).join("") : `<p class="muted">Telemetry will appear here after ingestion.</p>`}
        </div>
      </article>
    </section>
  `;
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
          ${feed.length ? feed.map((item) => `
            <div class="clean-feed-row">
              <span>${new Date(item.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
              <strong>${item.agentName}</strong>
              <em class="feed-level ${levelClass(item.level)}">${item.level.toUpperCase()}</em>
              <p>${item.message}</p>
            </div>
          `).join("") : `<p class="muted">No activity yet.</p>`}
        </div>
      </article>
    </section>
  `;
}

function renderGovernanceView() {
  document.querySelector("#view-content").innerHTML = `
    <section class="tab-stage governance-stage">
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
    { key: "avgScore",       label: "Control Score",      unit: "",     higherBetter: true,  fmt: (v) => v },
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

function svgScatter({ data, xKey, yKey, nameKey, clusterKey, W = 420, H = 280 }) {
  if (!data.length) return `<svg viewBox="0 0 ${W} ${H}"><text x="${W/2}" y="${H/2}" fill="#4a5568" text-anchor="middle" font-size="12">No agents yet</text></svg>`;
  const pad = { t: 28, r: 20, b: 44, l: 60 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const xs = data.map(d => d[xKey]), ys = data.map(d => d[yKey]);
  const maxX = Math.max(...xs) * 1.2 || 1;
  const maxY = Math.max(...ys) * 1.25 || 0.001;
  const sx = v => pad.l + (v / maxX) * cw;
  const sy = v => pad.t + (1 - v / maxY) * ch;
  const clrMap = { Efficient: "#5ee3a3", Moderate: "#ffd580", Wasteful: "#ff9a9a" };
  const dots = data.map(d => {
    const c = clrMap[d[clusterKey]] || "#a8beff";
    const r = Math.max(8, Math.min(18, 6 + d.runs * 2));
    const cx = sx(d[xKey]), cy = sy(d[yKey]);
    const lbl = (d[nameKey] || "").length > 14 ? d[nameKey].slice(0, 13) + "…" : d[nameKey];
    // flip label below dot when near top, above when near bottom
    const nearTop = cy < pad.t + 20;
    const lblY = nearTop ? cy + r + 12 : cy - r - 5;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" fill-opacity="0.18" stroke="${c}" stroke-width="1.5"/>
            <text x="${cx}" y="${lblY}" fill="${c}" font-size="9" text-anchor="middle" font-family="monospace">${lbl}</text>`;
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

        <div class="chart-panel">
          <div class="chart-panel-header">
            <h3>Agent Efficiency Scatter</h3>
            <div class="chart-legend">
              <span style="color:#5ee3a3">● Efficient</span>
              <span style="color:#ffd580">● Moderate</span>
              <span style="color:#ff9a9a">● Wasteful</span>
            </div>
          </div>
          <p class="chart-subtitle">X = avg tokens/run · Y = avg cost/run · dot size = run count · colour = percentile cluster</p>
          <div class="chart-svg-wrap">${svgScatter({ data:ml.clusteredAgents, xKey:"avgTokens", yKey:"avgCost", nameKey:"name", clusterKey:"cluster" })}</div>
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

function renderTokenCoachView() {
  const efficiency = dashboardState.tokenEfficiency || {};
  const suggestions = efficiency.suggestions || [];
  const topAgents = efficiency.topAgents || [];
  const hotspots = efficiency.workflowHotspots || [];
  const leaks = (dashboardState.costLeaks || []).slice(0, 8);
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
        <div class="token-summary">
          <div>
            <span>Total tokens</span>
            <strong>${compactNumber(efficiency.totalTokens || 0)}</strong>
          </div>
          <div>
            <span>Input mix</span>
            <strong class="${(efficiency.inputTokenPercent || 0) > 70 ? "amber" : ""}">${efficiency.inputTokenPercent || 0}%</strong>
          </div>
          <div>
            <span>Output mix</span>
            <strong class="${(efficiency.outputTokenPercent || 0) > 40 ? "amber" : ""}">${efficiency.outputTokenPercent || 0}%</strong>
          </div>
          <div>
            <span>Retry waste</span>
            <strong class="${(efficiency.wastePercent || 0) > 5 ? "red" : ""}">${efficiency.wastePercent || 0}%</strong>
          </div>
          <div>
            <span>Cost / 1k tokens</span>
            <strong>$${efficiency.costPer1kTokensUsd || 0}</strong>
          </div>
          <div>
            <span>Projected / month</span>
            <strong class="amber">$${efficiency.projectedMonthlyCost || 0}</strong>
          </div>
        </div>
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
                    &#9654; Apply this fix${savingsShort ? " — " + savingsShort : ""}
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
        <form id="create-key-form" class="inline-admin-form">
          <input name="name" placeholder="Key name — e.g. Production agent" value="Demo agent key" />
          <button type="submit">Create key</button>
        </form>
        <p id="new-key-output" class="secret-output" hidden></p>
        <div class="admin-list">
          ${tenantApiKeys.length ? tenantApiKeys.map((key) => {
            const isCurrentKey = key.prefix === currentKeyPrefix;
            return `
            <div class="admin-row">
              <div>
                <strong>${key.name}</strong>
                <span>${key.status === "active" ? "Active" : "Revoked"}${isCurrentKey ? " · this session" : ""} · last used ${formatDate(key.lastUsedAt)}</span>
              </div>
              <button class="ghost revoke-key-button" data-key-id="${key.id}" ${key.status !== "active" || isCurrentKey ? "disabled" : ""}>${isCurrentKey ? "In use" : "Revoke"}</button>
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
          <button id="export-audit-button" type="button">Download activity report</button>
        </div>
        <p class="muted">Reports are scoped to this workspace and never include API secrets or full keys.</p>
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
  document.querySelector("#metrics-grid").hidden = currentView === "admin";

  const workspace = document.querySelector(".workspace");
  if (workspace) {
    const needsScroll = currentView === "admin" || currentView === "tokens" || currentView === "analytics";
    workspace.classList.toggle("admin-scroll", needsScroll);
  }

  if (currentView === "activity") {
    renderActivityView();
  } else if (currentView === "tokens") {
    renderTokenCoachView();
  } else if (currentView === "analytics") {
    renderAnalyticsView();
  } else if (currentView === "governance") {
    renderGovernanceView();
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
      (entry, index) => `
        <div class="log-row">
          <div class="feed-time">${new Date(new Date(agent.latestRun.startTime).getTime() + index * 15000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
          <div class="feed-level ${levelClass(index % 4 === 0 ? "info" : index % 4 === 1 ? "tool" : index % 4 === 2 ? "warn" : "success")}">${index % 4 === 0 ? "INFO" : index % 4 === 1 ? "TOOL" : index % 4 === 2 ? "WARN" : "DONE"}</div>
          <div class="feed-agent">${agent.agentName}</div>
          <div>${entry}</div>
        </div>
      `
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
  renderMetrics(data.headlineMetrics);
  renderCurrentView();
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

async function initializeApp() {
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
        renderSetupScreen("login");
        return;
      }
    }

    document.querySelector("#workspace").innerHTML = workspaceShell;
    document.querySelector("#workspace").classList.add("workspace-business");
    attachViewTabs();
    await loadTenantSummary();
    await loadDashboard();
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

document.querySelector("#reset-data").addEventListener("click", async () => {
  if (!tenantApiKey && !currentUser) {
    renderSetupScreen("login", "Sign in before resetting data.");
    return;
  }

  await postAction("/api/reset");
});

document.querySelector("#logout").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  tenantApiKey = "";
  currentUser = null;
  localStorage.removeItem("acp_api_key");
  renderSetupScreen("login");
});

initializeApp();
