let dashboardState = null;
let tenantApiKey = localStorage.getItem("acp_api_key") || "";

const workspaceShell = `
  <section class="business-dashboard">
    <section class="metrics-grid cockpit-metrics" id="metrics-grid"></section>

    <section class="business-grid">
      <article class="panel fleet-panel">
        <div class="panel-title">
          <p class="eyebrow">Fleet</p>
          <h2>Connected agents</h2>
        </div>
        <div id="agent-list" class="agent-list compact-agent-list"></div>
      </article>

      <section class="ops-column">
        <article class="panel detail-panel cockpit-detail" id="selected-agent-panel"></article>

        <article class="panel feed-panel compact-panel">
          <div class="panel-title">
            <p class="eyebrow">Live Activity</p>
            <h2>Execution trail</h2>
          </div>
          <div id="activity-feed" class="activity-feed compact-feed"></div>
        </article>
      </section>

      <section class="governance-column">
        <article class="panel compact-panel">
          <div class="panel-title">
            <p class="eyebrow">Provider Control</p>
            <h2>Performance by platform</h2>
          </div>
          <div id="provider-table"></div>
        </article>

        <article class="panel compact-panel">
          <div class="panel-title">
            <p class="eyebrow">Cost Risk</p>
            <h2>Leak radar</h2>
          </div>
          <div id="leak-list" class="stack compact-stack"></div>
        </article>

        <article class="panel compact-panel">
          <div class="panel-title">
            <p class="eyebrow">Workflows</p>
            <h2>Reliability by function</h2>
          </div>
          <div id="workflow-cards" class="stack compact-stack"></div>
        </article>

        <article class="panel compact-panel">
          <div class="panel-title">
            <p class="eyebrow">Audit</p>
            <h2>Security trail</h2>
          </div>
          <div class="audit-table-container compact-audit">
            <table class="audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody id="audit-logs-body">
                <tr><td colspan="3">Loading audit logs...</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </section>
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
  renderAgentList(data.agentProfiles);
  renderSelectedAgent(data.selectedAgent);
  renderActivityFeed(data.activityFeed);
  renderProviderTable(data.providerComparison);
  renderLeaks(data.costLeaks);
  renderWorkflows(data.workflowInsights);
}

async function loadTenantSummary() {
  const data = await request("/api/tenant");
  document.querySelector("#active-agents").textContent = `${data.tenant.name} · ${data.connectors.length} connectors`;
}

async function loadDashboard() {
  const [data, auditData] = await Promise.all([
    request("/api/dashboard"),
    request("/api/audit").catch(() => ({ auditLogs: [] }))
  ]);
  renderDashboard(data);
  renderAuditLogs(auditData.auditLogs);
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
