let dashboardState = null;
let dashboardAuditLogs = [];
let tenantSummary = null;
let tenantApiKeys = [];
let connectorCatalog = [];
let adminActionMessage = "";
let currentView = "overview";
let tenantApiKey = localStorage.getItem("acp_api_key") || "";

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
            adminEmail: form.get("adminEmail")
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
      renderSetupScreen("api-key", error.message);
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
      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Provider Control</p>
          <h2>Performance by platform</h2>
        </div>
        <div id="provider-table"></div>
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
  renderProviderTable(dashboardState.providerComparison);
  renderLeaks(dashboardState.costLeaks);
  renderAuditLogs(dashboardAuditLogs);
}

function renderTokenCoachView() {
  const efficiency = dashboardState.tokenEfficiency || {};
  const suggestions = efficiency.suggestions || [];
  const topAgents = efficiency.topAgents || [];
  const hotspots = efficiency.workflowHotspots || [];

  document.querySelector("#view-content").innerHTML = `
    <section class="tab-stage token-stage">
      <article class="panel wide-panel token-hero">
        <div class="panel-title">
          <p class="eyebrow">Token Coach</p>
          <h2>Usage efficiency recommendations</h2>
        </div>
        <div class="token-summary">
          <div>
            <span>Total tokens</span>
            <strong>${compactNumber(efficiency.totalTokens || 0)}</strong>
          </div>
          <div>
            <span>Input mix</span>
            <strong>${efficiency.inputTokenPercent || 0}%</strong>
          </div>
          <div>
            <span>Output mix</span>
            <strong>${efficiency.outputTokenPercent || 0}%</strong>
          </div>
          <div>
            <span>Retry waste</span>
            <strong>${compactNumber(efficiency.retryWasteTokens || 0)}</strong>
          </div>
        </div>
      </article>

      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Recommendations</p>
          <h2>What to change next</h2>
        </div>
        <div class="coach-list">
          ${suggestions.length ? suggestions.map((item, index) => `
            <div class="coach-card">
              <div class="coach-rank">${index + 1}</div>
              <div>
                <h3>${item.title}</h3>
                <strong>${item.impact}</strong>
                <p>${item.action}</p>
              </div>
            </div>
          `).join("") : `<p class="muted">No token recommendations yet.</p>`}
        </div>
      </article>

      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Top Agents</p>
          <h2>Token-heavy agents</h2>
        </div>
        <div class="token-list">
          ${topAgents.length ? topAgents.map((agent) => `
            <div class="token-row">
              <div>
                <strong>${agent.agentName}</strong>
                <span>${agent.provider} · ${agent.workflow}</span>
              </div>
              <div>
                <strong>${compactNumber(agent.totalTokens)}</strong>
                <span>${compactNumber(agent.avgTokensPerRun)} avg/run</span>
              </div>
            </div>
          `).join("") : `<p class="muted">Token-heavy agents appear after telemetry arrives.</p>`}
        </div>
      </article>

      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Workflow Hotspots</p>
          <h2>Where tokens concentrate</h2>
        </div>
        <div class="token-list">
          ${hotspots.length ? hotspots.map((workflow) => `
            <div class="token-row">
              <div>
                <strong>${workflow.workflow}</strong>
                <span>${workflow.runs} runs · ${workflow.retries} retries</span>
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
  const users = tenantSummary?.users || [];
  const connectors = tenantSummary?.connectors || [];
  const currentKeyPrefix = tenantApiKey ? tenantApiKey.slice(0, 12) : "";
  const configuredProviders = new Set(connectors.map((connector) => connector.provider));

  document.querySelector("#view-content").innerHTML = `
    <section class="tab-stage admin-stage">
      <article class="panel wide-panel admin-hero">
        <div class="panel-title">
          <p class="eyebrow">Workspace Admin</p>
          <h2>${tenant.name || "Tenant workspace"}</h2>
        </div>
        <div class="admin-summary">
          <div><span>Tenant ID</span><strong>${tenant.id || "Unknown"}</strong></div>
          <div><span>Plan</span><strong>${tenant.plan || "Trial"}</strong></div>
          <div><span>Users</span><strong>${users.length}</strong></div>
          <div><span>Runs</span><strong>${tenantSummary?.runCount || 0}</strong></div>
        </div>
      </article>

      <article class="panel wide-panel connector-marketplace">
        <div class="panel-title">
          <p class="eyebrow">Integration Hub</p>
          <h2>Connect agent platforms</h2>
        </div>
        ${adminActionMessage ? `<p class="admin-message">${adminActionMessage}</p>` : ""}
        <div class="active-source-strip">
          <span>Active tenant sources</span>
          <strong>${connectors.length ? connectors.map((connector) => connector.name).join(", ") : "None yet"}</strong>
        </div>
        <div class="connector-grid">
          ${connectorCatalog.length ? connectorCatalog.map((item) => {
            const existing = connectors.find((connector) => connector.provider === item.provider);
            const isConnected = !!existing;
            const hasSecret = !!existing?.hasSecret;
            const statusLabel = isConnected
              ? item.requiresSecret && !hasSecret
                ? "needs key"
                : "connected"
              : "not connected";
            return `
            <div class="connector-card">
              <div class="connector-card-top">
                <div>
                  <strong>${item.name}</strong>
                  <span>${item.category} · ${item.mode}</span>
                </div>
                <span class="connector-status ${isConnected ? "connected" : ""}">${statusLabel}</span>
              </div>
              ${item.requiresSecret && (!isConnected || !hasSecret) ? `
                <div class="connector-action-zone primary-action">
                  <label>${item.name} API key</label>
                  <form class="connector-form" data-provider="${item.provider}" data-name="${item.name}" data-mode="${item.mode}">
                    <input name="apiKey" placeholder="${item.provider === "anthropic" ? "Paste Claude key sk-ant-..." : "Paste OpenAI key sk-..."}" />
                    <button type="submit">${isConnected ? "Save key" : "Connect"}</button>
                  </form>
                </div>
              ` : ""}
              <div class="connector-health ${isConnected ? "ok" : "idle"}">
                ${isConnected
                  ? item.requiresSecret && !hasSecret
                    ? "Source exists. Add a provider key to enable gateway routing."
                    : `${item.name} is connected for this tenant. New ${item.name} agent activity can now be tracked by Agent Prism.`
                  : "Ready to add for this tenant."}
              </div>
              <p>${item.setup}</p>
              ${item.requiresSecret && isConnected && hasSecret ? `
                <div class="connector-action-zone">
                  <label>Credential vault</label>
                  <button class="ghost rotate-key-button" data-provider="${item.provider}" type="button">Rotate provider key</button>
                </div>
              ` : !item.requiresSecret ? `
                <div class="connector-action-zone">
                  <label>Source registration</label>
                  <button class="ghost connect-source-button" data-provider="${item.provider}" data-name="${item.name}" data-mode="${item.mode}" type="button">${isConnected ? "Refresh Source" : "Add Source"}</button>
                </div>
              ` : ""}
              <div class="connector-footer">
                <span>${item.endpoint}</span>
                <button class="test-source-button" data-provider="${item.provider}" type="button">Send test event</button>
              </div>
            </div>
          `}).join("") : `<p class="muted">Connector catalog is loading.</p>`}
        </div>
      </article>

      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">API Keys</p>
          <h2>Tenant-scoped access</h2>
        </div>
        <form id="create-key-form" class="inline-admin-form">
          <input name="name" placeholder="Key name" value="Demo agent key" />
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
                <span>${key.prefix} · ${key.status}${isCurrentKey ? " · current browser key" : ""} · last used ${formatDate(key.lastUsedAt)}</span>
              </div>
              <button class="ghost revoke-key-button" data-key-id="${key.id}" ${key.status !== "active" || isCurrentKey ? "disabled" : ""}>${isCurrentKey ? "In use" : "Revoke"}</button>
            </div>
          `}).join("") : `<p class="muted">No API keys found.</p>`}
        </div>
      </article>

      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Connectors</p>
          <h2>Active sources</h2>
        </div>
        <div class="admin-list">
          ${connectors.length ? connectors.map((connector) => `
            <div class="admin-row">
              <div>
                <strong>${connector.name}</strong>
                <span>${connector.provider} · ${connector.status} · ${connector.hasSecret ? "secret configured" : "no secret stored"}</span>
              </div>
              <span class="admin-pill">${connector.mode || "webhook"}</span>
            </div>
          `).join("") : `<p class="muted">No connectors configured.</p>`}
        </div>
      </article>

      <article class="panel wide-panel">
        <div class="panel-title">
          <p class="eyebrow">Audit</p>
          <h2>Evidence controls</h2>
        </div>
        <div class="admin-actions">
          <button id="export-audit-button" type="button">Export audit CSV</button>
        </div>
        <p class="muted">Audit exports are tenant-scoped and never include provider secrets or full API keys.</p>
      </article>
    </section>
  `;

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
  adminActionMessage = `Paste the new ${source?.name || provider} key below and click Save key.`;
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

  if (currentView === "activity") {
    renderActivityView();
  } else if (currentView === "tokens") {
    renderTokenCoachView();
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

function renderProviderTable(rows) {
  document.querySelector("#provider-table").innerHTML =
    rows.length === 0
      ? `<div class="detail-subpanel"><p class="usp-summary">Provider benchmarks show up after the first few tenant runs.</p></div>`
      : `
        <table class="table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Runs</th>
              <th>Cost</th>
              <th>Success</th>
              <th>Avg Score</th>
            </tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (row) => `
                  <tr>
                    <td>${row.provider}</td>
                    <td>${row.runs}</td>
                    <td>${currency(row.costUsd)}</td>
                    <td>${row.successRate}%</td>
                    <td>${row.avgScore}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      `;
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
  document.querySelector("#active-agents").textContent = `${data.tenant.name} · ${data.connectors.length} connectors`;
}

async function loadDashboard() {
  const [data, auditData, keysData, catalogData] = await Promise.all([
    request("/api/dashboard"),
    request("/api/audit").catch(() => ({ auditLogs: [] })),
    request("/api/tenant/api-keys").catch(() => ({ keys: [] })),
    request("/api/connectors/catalog").catch(() => ({ connectors: [] }))
  ]);
  dashboardAuditLogs = auditData.auditLogs || [];
  tenantApiKeys = keysData.keys || [];
  connectorCatalog = catalogData.connectors || [];
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
      renderSetupScreen("api-key");
      return;
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
      renderSetupScreen("api-key", error.message);
      return;
    }

    document.body.innerHTML = `<pre>${error.message}</pre>`;
  }
}

document.querySelector("#save-api-key").addEventListener("click", () => {
  renderSetupScreen("api-key");
});

document.querySelector("#reset-data").addEventListener("click", async () => {
  if (!tenantApiKey) {
    renderSetupScreen("api-key", "Connect a tenant before resetting data.");
    return;
  }

  await postAction("/api/reset");
});

initializeApp();
