// Chart.js global defaults for dark mode aesthetics
Chart.defaults.color = '#a1a1aa';
Chart.defaults.font.family = 'Inter, sans-serif';
Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.05)';

document.addEventListener("DOMContentLoaded", () => {
  const authOverlay = document.getElementById("auth-overlay");
  const authForm = document.getElementById("auth-form");
  const apiKeyInput = document.getElementById("api-key-input");
  const authError = document.getElementById("auth-error");
  const activeAgentsLabel = document.getElementById("active-agents");
  const logoutBtn = document.getElementById("logout");

  let spendChartInstance = null;
  let teamChartInstance = null;

  // Authentication
  const savedKey = localStorage.getItem("acp_api_key");
  if (savedKey) {
    authOverlay.style.display = "none";
    fetchDashboard(savedKey);
  } else {
    authOverlay.style.display = "flex";
  }

  authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const key = apiKeyInput.value.trim();
    if (key) {
      localStorage.setItem("acp_api_key", key);
      authOverlay.style.display = "none";
      fetchDashboard(key);
    }
  });

  logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("acp_api_key");
    window.location.reload();
  });

  async function fetchDashboard(apiKey) {
    try {
      const res = await fetch("/api/dashboard", {
        headers: { "x-api-key": apiKey }
      });
      if (res.status === 401) {
        localStorage.removeItem("acp_api_key");
        authError.textContent = "Invalid API Key";
        authOverlay.style.display = "flex";
        return;
      }
      if (!res.ok) throw new Error("Failed to load dashboard data");
      const data = await res.json();

      activeAgentsLabel.textContent = data.tenant.name;
      renderExecutiveDashboard(data);

    } catch (err) {
      console.error(err);
      activeAgentsLabel.textContent = "Connection Error";
    }
  }

  function renderExecutiveDashboard(data) {
    const runs = data.runs || [];
    
    // Calculate global stats
    let totalSpend = 0;
    let totalViolations = 0;
    let totalGuardrails = 0;
    let maxLatency = 0;
    
    // Grouping
    const spendByTeam = {};
    const cumulativeSpendData = [];
    
    // Sort runs chronologically for the cumulative chart
    const sortedRuns = [...runs].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    sortedRuns.forEach(run => {
      // Global metrics
      totalSpend += run.costUsd || 0;
      totalViolations += run.policyViolations || 0;
      totalGuardrails += (run.tags?.includes('guardrail_hit') ? 1 : 0);
      if (run.latencyMs > maxLatency) maxLatency = run.latencyMs;

      // Team allocation
      const team = run.team || 'Unassigned';
      if (!spendByTeam[team]) spendByTeam[team] = 0;
      spendByTeam[team] += run.costUsd || 0;

      // Cumulative trend
      cumulativeSpendData.push({
        x: new Date(run.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
        y: totalSpend
      });
    });

    // Populate Top Metrics
    const metricsGrid = document.getElementById("executive-metrics");
    metricsGrid.innerHTML = `
      <div class="metric-card">
        <div class="metric-label">Total AI Compute Spend</div>
        <div class="metric-value">$${totalSpend.toFixed(4)}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Total Automated Actions</div>
        <div class="metric-value">${runs.length}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Active Autonomous Agents</div>
        <div class="metric-value">${new Set(runs.map(r => r.agentName)).size}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Avg Cost per Action</div>
        <div class="metric-value">$${(runs.length > 0 ? totalSpend / runs.length : 0).toFixed(4)}</div>
      </div>
    `;

    // Populate ROI Calculator
    // Assumption: 1 agent run saves 15 minutes of an engineer's time at $100/hr ($25 saved)
    const humanCostSaved = runs.length * 25.00;
    document.getElementById("roi-ai-cost").textContent = `$${totalSpend.toFixed(2)}`;
    document.getElementById("roi-human-cost").textContent = `$${humanCostSaved.toFixed(2)}`;
    
    let multiplier = "0x";
    if (totalSpend > 0) {
      multiplier = (humanCostSaved / totalSpend).toFixed(0) + "x";
    } else if (humanCostSaved > 0) {
      multiplier = "∞";
    }
    document.getElementById("roi-multiplier").textContent = multiplier;

    // Populate Risk Posture
    document.getElementById("kpi-violations").textContent = totalViolations;
    document.getElementById("kpi-guardrails").textContent = totalGuardrails;
    document.getElementById("kpi-latency").textContent = `${maxLatency}ms`;

    // Render Charts
    renderSpendTrendChart(cumulativeSpendData);
    renderTeamChart(spendByTeam);
  }

  function renderSpendTrendChart(dataPoints) {
    const ctx = document.getElementById('spendTrendChart').getContext('2d');
    
    if (spendChartInstance) {
      spendChartInstance.destroy();
    }

    // Default to at least 0 if no data
    if (dataPoints.length === 0) {
      dataPoints = [{x: "Now", y: 0}];
    }

    // Creating a beautiful gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(139, 92, 246, 0.5)'); // Purple
    gradient.addColorStop(1, 'rgba(139, 92, 246, 0.0)');

    spendChartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dataPoints.map(d => d.x),
        datasets: [{
          label: 'Cumulative Spend ($)',
          data: dataPoints.map(d => d.y),
          borderColor: '#8b5cf6',
          backgroundColor: gradient,
          borderWidth: 2,
          pointRadius: 0,
          pointHitRadius: 10,
          fill: true,
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: 'rgba(24, 24, 27, 0.9)',
            titleColor: '#fff',
            bodyColor: '#a1a1aa',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              callback: function(value) { return '$' + value; }
            }
          },
          x: {
            grid: { display: false }
          }
        }
      }
    });
  }

  function renderTeamChart(spendByTeam) {
    // FIX: Changed from 'teamChartInstance' to 'teamAllocationChart' (the actual canvas ID)
    const cCtx = document.getElementById('teamAllocationChart').getContext('2d');
    
    if (teamChartInstance) {
      teamChartInstance.destroy();
    }

    const labels = Object.keys(spendByTeam);
    const data = Object.values(spendByTeam);

    // Modern color palette
    const colors = [
      '#3b82f6', // blue
      '#8b5cf6', // purple
      '#10b981', // emerald
      '#f59e0b', // amber
      '#ef4444'  // red
    ];

    teamChartInstance = new Chart(cCtx, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['No Data'],
        datasets: [{
          data: data.length ? data : [1],
          backgroundColor: labels.length ? colors.slice(0, labels.length) : ['#27272a'],
          borderWidth: 0,
          hoverOffset: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '75%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: '#a1a1aa', padding: 20, usePointStyle: true }
          }
        }
      }
    });
  }
});
