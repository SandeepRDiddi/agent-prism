import { config } from "./config.js";

const ADVISOR_SCHEMA = {
  summary: "One business-readable sentence about what needs attention.",
  confidence: "high | medium | low",
  priority: "cost | reliability | governance | quality",
  recommendations: [
    {
      title: "Short action title",
      why: "Why the telemetry indicates this matters",
      action: "Concrete operational change to make",
      expectedImpact: "Business impact in cost, reliability, speed, or risk",
      owner: "Suggested owner",
      nextCheck: "What to inspect after the next run"
    }
  ],
  questions: ["Any missing business context the advisor needs"]
};

export function buildAdvisorTelemetry({ tenant, snapshot, runs }) {
  const recentRuns = [...runs]
    .sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0))
    .slice(0, 12)
    .map((run) => ({
      agentName: run.agentName,
      provider: run.provider,
      model: run.model,
      taskType: run.taskType,
      workflow: run.workflow,
      status: run.status,
      latencyMs: run.latencyMs,
      tokensIn: run.tokensIn || 0,
      tokensOut: run.tokensOut || 0,
      costUsd: run.costUsd || 0,
      budgetUsd: run.budgetUsd || 0,
      retryCount: run.retryCount || 0,
      policyViolations: run.policyViolations || 0,
      userSatisfaction: run.userSatisfaction || 0,
      controlScore: run.controlScore,
      startTime: run.startTime
    }));

  return {
    tenant: {
      id: tenant?.id,
      name: tenant?.name,
      plan: tenant?.plan
    },
    headline: {
      totalRuns: snapshot.headlineMetrics?.totalRuns || 0,
      successRate: snapshot.headlineMetrics?.successRate || 0,
      activeAgents: snapshot.agentProfiles?.length || 0,
      totalCostUsd: snapshot.headlineMetrics?.totalCostUsd || 0,
      averageLatencyMs: snapshot.headlineMetrics?.averageLatencyMs || 0,
      averageScore: snapshot.headlineMetrics?.averageControlScore || 0
    },
    tokenEfficiency: {
      efficiencyScore: snapshot.tokenEfficiency?.efficiencyScore,
      totalTokens: snapshot.tokenEfficiency?.totalTokens,
      inputTokenPercent: snapshot.tokenEfficiency?.inputTokenPercent,
      outputTokenPercent: snapshot.tokenEfficiency?.outputTokenPercent,
      wastePercent: snapshot.tokenEfficiency?.wastePercent,
      projectedMonthlyCost: snapshot.tokenEfficiency?.projectedMonthlyCost,
      topAgents: snapshot.tokenEfficiency?.topAgents?.slice(0, 5) || [],
      workflowHotspots: snapshot.tokenEfficiency?.workflowHotspots?.slice(0, 5) || []
    },
    costLeaks: (snapshot.costLeaks || []).slice(0, 6).map((leak) => ({
      agentName: leak.agentName,
      provider: leak.provider,
      workflow: leak.workflow,
      leakType: leak.leakType,
      costUsd: leak.costUsd,
      budgetUsd: leak.budgetUsd,
      retryCount: leak.retryCount
    })),
    providerScorecard: (snapshot.providerComparison || []).slice(0, 6),
    workflowScorecard: (snapshot.workflowInsights || []).slice(0, 6),
    recentRuns
  };
}

export function parseAdvisorJson(content) {
  if (!content || typeof content !== "string") {
    throw new Error("Advisor returned an empty response.");
  }

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : content;
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Advisor response did not contain JSON.");
  }

  const parsed = JSON.parse(raw.slice(first, last + 1));
  return {
    summary: String(parsed.summary || "The advisor did not provide a summary."),
    confidence: ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
    priority: ["cost", "reliability", "governance", "quality"].includes(parsed.priority) ? parsed.priority : "quality",
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.slice(0, 5).map((item) => ({
          title: String(item.title || "Review agent telemetry"),
          why: String(item.why || "The advisor did not explain the signal."),
          action: String(item.action || "Review the latest run and decide the next operational change."),
          expectedImpact: String(item.expectedImpact || "Improved control over agent usage."),
          owner: String(item.owner || "Agent owner"),
          nextCheck: String(item.nextCheck || "Review the next successful run.")
        }))
      : [],
    questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 4).map(String) : []
  };
}

function advisorPrompt(telemetry) {
  return [
    "You are Agent Prism AI Advisor for an enterprise AI operations team.",
    "Use only the telemetry JSON. Do not invent secrets, vendors, incidents, or dollar amounts.",
    "Write recommendations for a business and platform owner, not for a hobby demo.",
    "Return strict JSON matching this schema:",
    JSON.stringify(ADVISOR_SCHEMA),
    "Telemetry:",
    JSON.stringify(telemetry)
  ].join("\n\n");
}

async function callOllama(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiAdvisor.timeoutMs);
  try {
    const response = await fetch(`${config.aiAdvisor.ollamaBaseUrl.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.aiAdvisor.model,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: "You produce concise enterprise AI operations advice as valid JSON only." },
          { role: "user", content: prompt }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}`);
    }

    const data = await response.json();
    return data.message?.content || data.response || "";
  } finally {
    clearTimeout(timeout);
  }
}

async function callOpenRouter(prompt) {
  if (!config.aiAdvisor.openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is not set");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiAdvisor.timeoutMs);
  try {
    const response = await fetch(`${config.aiAdvisor.openRouterBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${config.aiAdvisor.openRouterApiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "https://agent-prism.onrender.com",
        "X-Title": "Agent Prism AI Advisor"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.aiAdvisor.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You produce concise enterprise AI operations advice as valid JSON only." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`OpenRouter returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateAiAdvisor({ tenant, snapshot, runs }) {
  const provider = config.aiAdvisor.provider;
  const model = config.aiAdvisor.model;

  if (!runs.length) {
    return {
      status: "waiting_for_telemetry",
      source: "llm",
      provider,
      model,
      generatedAt: new Date().toISOString(),
      message: "Run at least one agent through Agent Prism before asking the AI Advisor for recommendations.",
      recommendations: []
    };
  }

  if (!["ollama", "openrouter"].includes(provider)) {
    return {
      status: "unavailable",
      source: "llm",
      provider,
      model,
      generatedAt: new Date().toISOString(),
      message: `AI Advisor provider "${provider}" is not enabled in this build. Use "ollama" or "openrouter".`,
      recommendations: []
    };
  }

  const telemetry = buildAdvisorTelemetry({ tenant, snapshot, runs });
  try {
    const prompt = advisorPrompt(telemetry);
    const content = provider === "openrouter" ? await callOpenRouter(prompt) : await callOllama(prompt);
    return {
      status: "ready",
      source: "llm",
      provider,
      model,
      generatedAt: new Date().toISOString(),
      telemetryWindow: {
        runs: telemetry.headline.totalRuns,
        recentRuns: telemetry.recentRuns.length
      },
      ...parseAdvisorJson(content)
    };
  } catch (error) {
    const setup = provider === "openrouter"
      ? {
          env: {
            AI_ADVISOR_PROVIDER: "openrouter",
            AI_ADVISOR_MODEL: model,
            OPENROUTER_API_KEY: "set in Render environment"
          }
        }
      : {
          install: "Install Ollama, then run: ollama pull llama3.1",
          run: "ollama serve",
          env: {
            AI_ADVISOR_PROVIDER: "ollama",
            AI_ADVISOR_MODEL: "llama3.1",
            OLLAMA_BASE_URL: "http://127.0.0.1:11434"
          }
        };
    return {
      status: "unavailable",
      source: "llm",
      provider,
      model,
      generatedAt: new Date().toISOString(),
      message: `${provider === "openrouter" ? "OpenRouter advisor" : "Local Llama advisor"} is unavailable: ${error.message}. Check the provider key/settings, then refresh Token Coach.`,
      setup,
      recommendations: []
    };
  }
}
