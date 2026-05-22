import { AgentPrism } from "./src/sdk/index.js";

const prism = new AgentPrism();

const now = Date.now();

const scenarios = [
  {
    minutesAgo: 10,
    agent_name: "GitHub Copilot Coding Agent",
    intent: "pull-request-implementation",
    workflow: "github-copilot-pr-build",
    prompt_tokens: 12480,
    completion_tokens: 2860,
    duration_ms: 18200,
    retry_count: 1,
    tool_invocations: 7,
    summary: "Copilot implemented the requested dashboard tab and pushed telemetry into Agent Prism.",
    trace: [
      "loaded pull request requirements",
      "scanned changed dashboard files",
      "generated implementation patch",
      "retried after lint context mismatch",
      "submitted final telemetry to Agent Prism"
    ]
  },
  {
    minutesAgo: 7,
    agent_name: "GitHub Copilot Coding Agent",
    intent: "test-generation",
    workflow: "github-copilot-pr-build",
    prompt_tokens: 6840,
    completion_tokens: 1320,
    duration_ms: 9300,
    retry_count: 0,
    tool_invocations: 4,
    summary: "Copilot generated focused test coverage for token efficiency analytics.",
    trace: [
      "read analytics behavior",
      "generated token efficiency assertions",
      "checked edge case with empty telemetry",
      "recorded test telemetry"
    ]
  },
  {
    minutesAgo: 3,
    agent_name: "GitHub Copilot Review Agent",
    intent: "code-review",
    workflow: "github-copilot-review",
    prompt_tokens: 9140,
    completion_tokens: 4200,
    duration_ms: 14800,
    retry_count: 2,
    tool_invocations: 5,
    summary: "Copilot reviewed the implementation and produced a concise remediation plan.",
    trace: [
      "loaded repository context",
      "reviewed dashboard rendering logic",
      "retried after duplicated context block",
      "flagged token-heavy prompt path",
      "sent optimization hints to Agent Prism"
    ]
  }
];

function buildPayload(scenario, index) {
  const startedAt = new Date(now - scenario.minutesAgo * 60000).toISOString();
  const completedAt = new Date(now - scenario.minutesAgo * 60000 + scenario.duration_ms).toISOString();
  const totalTokens = scenario.prompt_tokens + scenario.completion_tokens;

  return {
    source: "copilot",
    payload: {
      session_id: `copilot_demo_${now}_${index}`,
      agent_name: scenario.agent_name,
      model_name: process.env.COPILOT_MODEL || "copilot-gpt-4.1",
      intent: scenario.intent,
      outcome: "success",
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: scenario.duration_ms,
      prompt_tokens: scenario.prompt_tokens,
      completion_tokens: scenario.completion_tokens,
      estimated_cost_usd: Number((totalTokens * 0.000012).toFixed(4)),
      budget_usd: 0.25,
      autonomy_level: 4,
      retry_count: scenario.retry_count,
      tool_invocations: scenario.tool_invocations,
      policy_alerts: 0,
      user_score: 4,
      environment: "production-demo",
      workflow: scenario.workflow,
      team: "engineering",
      labels: ["copilot", "demo", "token-efficiency"],
      trace: scenario.trace,
      summary: scenario.summary
    }
  };
}

async function main() {
  console.log("Starting Copilot demo telemetry agent...");
  console.log(`Sending ${scenarios.length} Copilot agent runs to ${prism.endpoint}...`);

  for (const [index, scenario] of scenarios.entries()) {
    const response = await prism.logRun(buildPayload(scenario, index + 1));
    console.log(
      `Recorded ${response.normalizedRun.agentName} · ${response.normalizedRun.workflow} · ${response.normalizedRun.tokensIn + response.normalizedRun.tokensOut} tokens`
    );
  }

  console.log("\nCopilot telemetry is live in Agent Prism.");
  console.log("Open the dashboard and select the Token Coach tab for usage suggestions.");
}

main().catch((error) => {
  console.error("Error running Copilot demo agent:", error.message);
  console.error("Make sure ~/.agent-prism/credentials.json exists or pass credentials through the Agent Prism SDK.");
  process.exitCode = 1;
});
