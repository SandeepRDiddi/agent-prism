// Executive View — leadership.js
// Uses same /api/dashboard shape as main app (headlineMetrics, agentProfiles, etc.)

const content    = document.getElementById("lv-content");
const authOverlay = document.getElementById("lv-auth");
const authForm   = document.getElementById("lv-auth-form");
const authError  = document.getElementById("lv-auth-error");
const logoutBtn  = document.getElementById("lv-logout");
const refreshEl  = document.getElementById("lv-refresh-time");

function esc(str) {
  return String(str ?? "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function currency(v) {
  const n = Number(v) || 0;
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(5)}`;
  if (n < 1)    return `$${n.toFixed(4)}`;
  if (n < 100)  return `$${n.toFixed(2)}`;
  return `$${n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
}

function compact(n) {
  if (n >= 1e9) return `${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(0)}k`;
  return String(Math.round(n));
}

function scoreColor(sc) {
  return sc >= 70 ? "#10b981" : sc >= 55 ? "#f59e0b" : "#f87171";
}

function diagnose(a) {
  const run = a.latestRun || {};
  const issues = [];
  if ((run.retryCount || 0) > 2)
    issues.push({ why: `${run.retryCount} retries on last run`, fix: `Set max_retries=2 in agent config. Add explicit exit condition.`, verify: `Retry count ≤ 2 for 5 runs` });
  if ((run.policyViolations || 0) > 0)
    issues.push({ why: `${run.policyViolations} policy violation${run.policyViolations !== 1?"s":""}`, fix: `Restrict tool scopes in connector config. Review Audit Trail.`, verify: `0 violations for 10 consecutive runs` });
  if ((run.budgetUsd || 0) > 0 && (run.costUsd || 0) > run.budgetUsd)
    issues.push({ why: `$${((run.costUsd||0) - run.budgetUsd).toFixed(4)} over budget`, fix: `Raise budget to ${currency((run.costUsd||0)*1.3)} or switch to lighter model.`, verify: `costUsd ≤ budgetUsd for 5 runs` });
  if (!issues.length)
    issues.push({ why: `Control score ${a.controlScore}/100 — below 70`, fix: `Open Token Coach to identify prompt inefficiencies.`, verify: `Score rises above 70` });
  return issues[0];
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getApiKey() {
  // 1. Try session cookie
  try {
    const r = await fetch("/api/me", { credentials: "same-origin" });
    if (r.ok) return null; // session-based, no key needed
  } catch (_) {}
  // 2. Fallback to localStorage
  return localStorage.getItem("acp_api_key") || null;
}

function headers(key) {
  return key ? { "x-api-key": key } : {};
}

logoutBtn.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method:"POST", credentials:"same-origin" }).catch(()=>{});
  localStorage.removeItem("acp_api_key");
  window.location.href = "/";
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const key = document.getElementById("lv-api-key").value.trim();
  if (!key) return;
  const r = await fetch("/api/dashboard", { headers: { "x-api-key": key } });
  if (r.ok) {
    localStorage.setItem("acp_api_key", key);
    authOverlay.style.display = "none";
    render(await r.json(), key);
  } else {
    authError.textContent = r.status === 401 ? "Invalid API key — try again." : "Connection error.";
  }
});

// ── Fetch + render ────────────────────────────────────────────────────────────

async function load() {
  const key = await getApiKey();
  const r = await fetch("/api/dashboard", {
    credentials: "same-origin",
    headers: headers(key)
  });
  if (r.status === 401) {
    authOverlay.style.display = "flex";
    return;
  }
  if (!r.ok) { content.innerHTML = `<div class="lv-loading">Failed to load dashboard.</div>`; return; }
  authOverlay.style.display = "none";
  const data = await r.json();
  render(data, key);
  refreshEl.textContent = `Updated ${new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}`;
}

function render(data, _key) {
  const m         = data.headlineMetrics || {};
  const profiles  = data.agentProfiles   || [];
  const leaks     = data.costLeaks       || [];
  const eff       = data.tokenEfficiency || {};
  const ml        = data.mlAnalytics     || null;
  const providers = (data.providerComparison || []).slice(0, 4);
  const topAgents = (eff.topAgents       || []).slice(0, 8);
  const workflows = (eff.workflowHotspots|| []).slice(0, 5);

  const score     = m.averageControlScore ?? 0;
  const sc        = scoreColor(score);
  const circumference = 251.2;
  const filled    = Math.round((score / 100) * circumference);

  const band = score >= 85
    ? { label:"Strong",           color:"#10b981", bg:"rgba(16,185,129,0.08)", border:"rgba(16,185,129,0.2)", icon:"✓", desc:"Fleet performing above benchmark. Safe to scale." }
    : score >= 70
    ? { label:"Stable",           color:"#60a5fa", bg:"rgba(96,165,250,0.08)", border:"rgba(96,165,250,0.2)", icon:"✓", desc:"Operating within acceptable range. Monitor cost efficiency." }
    : score >= 55
    ? { label:"Needs Attention",  color:"#f59e0b", bg:"rgba(245,158,11,0.08)", border:"rgba(245,158,11,0.2)", icon:"⚠", desc:"Several agents underperforming. Review before scaling." }
    :   { label:"At Risk",        color:"#f87171", bg:"rgba(248,113,113,0.08)", border:"rgba(248,113,113,0.2)", icon:"!", desc:"Fleet reliability below threshold. Immediate review required." };

  const overBudget = (data.recentRuns || []).filter(r => r.costUsd > r.budgetUsd).length;
  const atRisk     = profiles.filter(a => a.controlScore < 70).slice(0, 4);
  const healthy    = profiles.filter(a => a.controlScore >= 70);

  // ROI calculation: each run replaces ~15 min of eng time @ $100/hr = $25/run
  const totalRuns   = m.totalRuns || 0;
  const aiCost      = m.totalCostUsd || 0;
  const humanSaved  = totalRuns * 25;
  const roi         = aiCost > 0 ? (humanSaved / aiCost).toFixed(1) : humanSaved > 0 ? "∞" : "0";

  // bar row helper
  const barRow = (label, pct, good, detail) => {
    const w = Math.min(100, Math.max(0, Math.round(pct)));
    const bg = good ? "#10b981" : w >= 50 ? "#f59e0b" : "#f87171";
    return `<div class="lv-bar-row">
      <div class="lv-bar-meta">
        <span class="lv-bar-label">${label}</span>
        <span class="lv-bar-detail">${detail}</span>
      </div>
      <div class="lv-bar-track"><div class="lv-bar-fill" style="width:${w}%;background:${bg}"></div></div>
    </div>`;
  };

  // score map for scoreboard
  const scoreMap = {};
  profiles.forEach(p => { scoreMap[p.agentName] = p.controlScore; });

  content.innerHTML = `
    <!-- KPI strip -->
    <div class="lv-kpi-strip">
      <div class="lv-kpi">
        <div class="lv-kpi-label">Fleet Health Score</div>
        <div class="lv-kpi-value" style="color:${sc}">${score}<span style="font-size:1rem;font-weight:400;color:rgba(200,215,255,0.35)">/100</span></div>
        <div class="lv-kpi-sub" style="color:${sc}">${band.label}</div>
      </div>
      <div class="lv-kpi">
        <div class="lv-kpi-label">Total AI Spend</div>
        <div class="lv-kpi-value">${currency(aiCost)}</div>
        <div class="lv-kpi-sub">${m.budgetUsedPercent ?? 0}% of budget</div>
      </div>
      <div class="lv-kpi">
        <div class="lv-kpi-label">Runs Completed</div>
        <div class="lv-kpi-value">${totalRuns.toLocaleString()}</div>
        <div class="lv-kpi-sub" style="color:${m.successRate>=80?"#10b981":m.successRate>=60?"#f59e0b":"#f87171"}">${m.successRate ?? 0}% success rate</div>
      </div>
      <div class="lv-kpi">
        <div class="lv-kpi-label">Active Agents</div>
        <div class="lv-kpi-value">${profiles.length}</div>
        <div class="lv-kpi-sub">${atRisk.length > 0 ? `<span class="amber">${atRisk.length} need review</span>` : "<span class='green'>all healthy</span>"}</div>
      </div>
      <div class="lv-kpi">
        <div class="lv-kpi-label">ROI Multiplier</div>
        <div class="lv-kpi-value green">${roi}×</div>
        <div class="lv-kpi-sub">AI vs human labor cost</div>
      </div>
    </div>

    <!-- main 3-col grid -->
    <div class="lv-grid">

      <!-- Fleet Health -->
      <article class="panel lv-health">
        <p class="eyebrow">AI Fleet Health</p>
        <div class="lv-gauge-row">
          <div class="lv-gauge">
            <svg viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" stroke-width="9"/>
              <circle cx="50" cy="50" r="40" fill="none"
                stroke="${band.color}" stroke-width="9"
                stroke-dasharray="${filled} ${circumference}"
                stroke-linecap="round"
                transform="rotate(-90 50 50)" opacity="0.9"/>
            </svg>
            <div class="lv-gauge-inner">
              <span class="lv-gauge-num" style="color:${band.color}">${score}</span>
              <span class="lv-gauge-den">/100</span>
            </div>
          </div>
          <div>
            <div class="lv-band-pill" style="color:${band.color};background:${band.bg};border:1px solid ${band.border}">${band.icon}&nbsp;${band.label}</div>
            <p class="lv-band-desc">${band.desc}</p>
            <div class="lv-kpi-row">
              <div class="lv-kpi-cell"><span style="color:${m.successRate>=80?"#10b981":m.successRate>=60?"#f59e0b":"#f87171"}">${m.successRate??0}%</span><label>Success</label></div>
              <div class="lv-kpi-cell"><span>${profiles.length}</span><label>Agents</label></div>
              <div class="lv-kpi-cell"><span style="color:${leaks.length>0?"#f59e0b":"#10b981"}">${leaks.length}</span><label>Leaks</label></div>
              <div class="lv-kpi-cell"><span>${totalRuns.toLocaleString()}</span><label>Runs</label></div>
            </div>
          </div>
        </div>
        <div class="lv-bars">
          ${barRow("Task Success Rate", m.successRate??0, (m.successRate??0)>=80, `${m.successRate??0}% tasks completed`)}
          ${barRow("Budget Control", Math.max(0,100-Math.max(0,(m.budgetUsedPercent??0)-100)), (m.budgetUsedPercent??0)<=100, overBudget>0?`${overBudget} agents over budget`:`${m.budgetUsedPercent??0}% budget used`)}
          ${barRow("Response Speed", Math.max(0,100-Math.round((m.averageLatencyMs||0)/200)), (m.averageLatencyMs||0)<10000, `${((m.averageLatencyMs||0)/1000).toFixed(1)}s avg latency`)}
          ${barRow("Policy Compliance", leaks.filter(l=>l.leakType==="Policy violation").length===0?100:60, leaks.length===0, leaks.length>0?`${leaks.length} cost leak${leaks.length!==1?"s":""} flagged`:"No violations detected")}
        </div>
        ${ml ? `<div style="margin-top:14px;padding:10px 12px;border-radius:8px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);font-size:0.78rem;">
          <span style="color:rgba(200,215,255,0.45)">ML insight: </span>
          <span style="color:${ml.trendDirection==="rising"?"#f87171":ml.trendDirection==="falling"?"#10b981":"#c8d6ff"}">
            Cost trend ${{ rising:"↑ rising", falling:"↓ falling", stable:"→ stable" }[ml.trendDirection]||"—"}
          </span>
          ${ml.anomalyCount>0?` &nbsp;·&nbsp; <span class="red">${ml.anomalyCount} anomal${ml.anomalyCount!==1?"ies":"y"} detected</span>`:""}
          &nbsp;·&nbsp; <span class="amber">30d forecast: $${ml.forecast30d||0}</span>
        </div>` : ""}
      </article>

      <!-- Financial Governance -->
      <article class="panel lv-finance">
        <p class="eyebrow">Financial Governance</p>
        <div class="lv-spend-hero">${currency(aiCost)}</div>
        <div class="lv-spend-sub">Total AI spend · ${m.budgetUsedPercent??0}% of allocated budget</div>
        <div class="lv-fl-row"><span class="lv-fl-label">Monthly forecast</span><strong class="amber">${currency(m.projectedMonthlyCost||aiCost*2.2)}</strong></div>
        <div class="lv-fl-row"><span class="lv-fl-label">Avg cost per run</span><strong>${totalRuns>0?currency(aiCost/totalRuns):"—"}</strong></div>
        <div class="lv-fl-row" style="${leaks.length>0?"color:#f59e0b":""}"><span class="lv-fl-label">Recoverable waste</span><strong style="${leaks.length>0?"color:#f59e0b":""}">${leaks.length>0?`${currency(leaks.length*14)}/mo`:"None found"}</strong></div>
        <div class="lv-fl-row"><span class="lv-fl-label">Token efficiency</span><strong class="${(eff.efficiencyScore||0)>=80?"green":(eff.efficiencyScore||0)>=60?"amber":"red"}">${eff.efficiencyScore??0}/100</strong></div>
        ${providers.length ? `<p class="eyebrow" style="margin-top:16px;margin-bottom:10px">Provider breakdown</p>
        ${providers.map(p=>`<div class="lv-fl-row">
          <span class="lv-fl-label">${esc(p.provider)}</span>
          <div style="text-align:right">
            <strong>${currency(p.costUsd)}</strong>
            <span style="font-size:0.7rem;color:rgba(200,215,255,0.35);display:block">${p.runs} runs · ${p.successRate}% success</span>
          </div>
        </div>`).join("")}` : ""}
      </article>

      <!-- ROI -->
      <article class="panel lv-roi">
        <p class="eyebrow">Return on AI Investment</p>
        <div class="lv-roi-multiplier" style="margin:12px 0">
          <div class="lv-roi-mult-num">${roi}×</div>
          <div class="lv-roi-mult-label">Net ROI multiplier</div>
        </div>
        <div class="lv-roi-grid">
          <div class="lv-roi-cell">
            <label>AI Compute Cost</label>
            <strong class="red">${currency(aiCost)}</strong>
          </div>
          <div class="lv-roi-cell">
            <label>Human Labor Saved</label>
            <strong class="green">${currency(humanSaved)}</strong>
          </div>
        </div>
        <p class="lv-roi-note">Based on ${totalRuns.toLocaleString()} completed runs × 15 min/task at $100/hr eng rate ($25 saved per run). Adjust assumptions with your actual labor cost.</p>
        ${m.successRate >= 80 ? `<div style="margin-top:12px;padding:8px 12px;border-radius:8px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);font-size:0.76rem;color:#10b981">
          ✓ ${m.successRate}% success rate confirms agents are completing tasks reliably.
        </div>` : `<div style="margin-top:12px;padding:8px 12px;border-radius:8px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.2);font-size:0.76rem;color:#f59e0b">
          ⚠ ${100-(m.successRate??0)}% failure rate reduces effective ROI — fix failing agents to recover value.
        </div>`}
      </article>
    </div>

    <!-- second row: scoreboard + risk + workflows -->
    <div class="lv-grid" style="margin-top:0">

      <!-- Agent Scoreboard -->
      <article class="panel lv-scoreboard" style="grid-column:1/-1">
        <p class="eyebrow" style="margin-bottom:4px">Agent Scoreboard</p>
        <p style="font-size:0.78rem;color:rgba(200,215,255,0.4);margin-bottom:0">All agents · sorted by total token spend · score = control reliability</p>
        <table class="lv-sb-table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Workflow</th>
              <th>Score</th>
              <th>Runs</th>
              <th>Tokens</th>
              <th>Spend</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${topAgents.length ? topAgents.map(a => {
              const sc2 = scoreMap[a.agentName];
              const sc2Color = typeof sc2 === "number" ? scoreColor(sc2) : "#8898b0";
              const sc2Label = typeof sc2 === "number" ? sc2 : "—";
              const wf = (a.workflow||"general").replace(/-/g," ");
              const statusTag = typeof sc2==="number" ? (sc2>=70?"✓ Healthy":"⚠ Review") : "—";
              const statusColor = typeof sc2==="number" ? (sc2>=70?"#10b981":"#f59e0b") : "#8898b0";
              return `<tr>
                <td class="lv-sb-name">${esc(a.agentName)}</td>
                <td class="lv-sb-wf">${esc(wf)}</td>
                <td><span class="lv-score-pill" style="background:${sc2Color}18;color:${sc2Color}">${sc2Label}</span></td>
                <td class="lv-sb-mono">${a.runs}</td>
                <td class="lv-sb-mono">${compact(a.totalTokens||0)}</td>
                <td class="lv-sb-mono">${currency(a.costUsd)}</td>
                <td style="font-size:0.74rem;color:${statusColor}">${statusTag}</td>
              </tr>`;
            }).join("") : `<tr><td colspan="7" style="color:rgba(200,215,255,0.3);padding:16px 0;font-size:0.82rem">No agent data yet</td></tr>`}
          </tbody>
        </table>
      </article>
    </div>

    <!-- third row: risk + workflows + action -->
    <div class="lv-grid" style="margin-top:0">

      <!-- Risk Posture -->
      <article class="panel lv-risk">
        <p class="eyebrow">Risk Posture</p>
        ${(() => {
          const violations = (data.recentRuns||[]).reduce((s,r)=>s+(r.policyViolations||0),0);
          const anomalies  = ml?.anomalyCount ?? 0;
          const overBudgetCount = (data.recentRuns||[]).filter(r=>r.costUsd>r.budgetUsd).length;
          return `
          <div class="lv-risk-row"><span class="lv-risk-label">Policy violations</span><strong style="color:${violations>0?"#f87171":"#10b981"}">${violations}</strong></div>
          <div class="lv-risk-row"><span class="lv-risk-label">Over-budget runs</span><strong style="color:${overBudgetCount>0?"#f59e0b":"#10b981"}">${overBudgetCount}</strong></div>
          <div class="lv-risk-row"><span class="lv-risk-label">Cost leaks flagged</span><strong style="color:${leaks.length>0?"#f59e0b":"#10b981"}">${leaks.length}</strong></div>
          <div class="lv-risk-row"><span class="lv-risk-label">Statistical anomalies</span><strong style="color:${anomalies>0?"#f87171":"#10b981"}">${anomalies}</strong></div>
          <div class="lv-risk-row"><span class="lv-risk-label">Agents needing review</span><strong style="color:${atRisk.length>0?"#f59e0b":"#10b981"}">${atRisk.length}</strong></div>
          <div class="lv-risk-row"><span class="lv-risk-label">Avg latency</span><strong>${((m.averageLatencyMs||0)/1000).toFixed(1)}s</strong></div>
          <div class="lv-risk-row"><span class="lv-risk-label">Token efficiency score</span><strong class="${(eff.efficiencyScore||0)>=80?"green":(eff.efficiencyScore||0)>=60?"amber":"red"}">${eff.efficiencyScore??0}/100</strong></div>
          ${leaks.length>0?`<div style="margin-top:14px;padding:10px 12px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.18);border-radius:8px;font-size:0.76rem;color:rgba(200,215,255,0.55)">
            💡 Estimated recoverable waste: <strong class="amber">${currency(leaks.length*14)}/month</strong> — see Token Coach for details.
          </div>`:""}`;
        })()}
      </article>

      <!-- Workflow Distribution -->
      <article class="panel lv-workflow">
        <p class="eyebrow">Workflow Distribution</p>
        <p style="font-size:0.76rem;color:rgba(200,215,255,0.38);margin-bottom:14px">What the AI fleet is doing — by token volume</p>
        ${workflows.length ? workflows.map(h => {
          const maxT = Math.max(...workflows.map(x=>x.totalTokens),1);
          const pct  = Math.round((h.totalTokens/maxT)*100);
          const wf   = (h.workflow||"general").replace(/-/g," ");
          return `<div class="lv-wf-row">
            <div class="lv-wf-meta">
              <span class="lv-wf-name">${esc(wf)}${h.retries>0?` <span style="color:#f59e0b;font-size:0.68rem">⟳${h.retries} retries</span>`:""}</span>
              <span class="lv-wf-stat">${h.runs} runs · ${compact(h.avgTokensPerRun||0)}/run</span>
            </div>
            <div class="lv-wf-track"><div class="lv-wf-fill" style="width:${pct}%"></div></div>
          </div>`;
        }).join("") : `<p style="color:rgba(200,215,255,0.3);font-size:0.82rem">No workflow data yet</p>`}
      </article>

      <!-- Action Required -->
      <article class="panel lv-action">
        <p class="eyebrow">${atRisk.length>0?"⚠ Action Required":"✓ All Clear"}</p>
        ${atRisk.length>0 ? `
          <p class="lv-action-intro">${atRisk.length} agent${atRisk.length!==1?"s":""} flagged — top issue per agent:</p>
          ${atRisk.map(a => {
            const dotColor = a.controlScore>=55?"#f59e0b":"#f87171";
            const issue = diagnose(a);
            return `<div class="lv-agent-row">
              <div class="lv-agent-dot" style="background:${dotColor}"></div>
              <div class="lv-agent-info">
                <div class="lv-agent-name">${esc(a.agentName)} <span style="font-size:0.7rem;font-family:monospace;color:${dotColor};font-weight:400">${a.controlScore}/100</span></div>
                <div class="lv-agent-why">⚑ ${esc(issue.why)}</div>
                <div class="lv-agent-fix">→ ${esc(issue.fix)}</div>
                <div class="lv-agent-verify">✓ ${esc(issue.verify)}</div>
              </div>
            </div>`;
          }).join("")}
        ` : `
          <p class="lv-action-intro">All ${profiles.length} agents operating within policy.</p>
          ${healthy.slice(0,4).map(a=>`<div class="lv-agent-row">
            <div class="lv-agent-dot" style="background:#10b981"></div>
            <div class="lv-agent-info">
              <div class="lv-agent-name">${esc(a.agentName)}</div>
              <div class="lv-agent-why" style="color:#10b981">Score ${a.controlScore}/100 · on target</div>
            </div>
          </div>`).join("")}
        `}
      </article>
    </div>
  `;
}

load();
