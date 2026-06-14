import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Lazy-initialized Gemini API client
let aiClient: GoogleGenAI | null = null;
function getAi(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("GEMINI_API_KEY is not defined in the environment. Falling back to high-fidelity logic-engine simulation.");
      return null;
    }
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

// 1. Health Endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// 2. Simulated Telemetry Proxy logs
const mockLogPool = [
  { level: "PASS", message: "initial proxy connection established safely", service: "prism-proxy-node" },
  { level: "INBOUND", message: "Intercepted execution query on Gem-3.5-Flash (user: 418)", service: "core-gateway" },
  { level: "METRIC", message: "Aggregated tokens for user session: +14,200 (Cost: $0.05)", service: "prism-cost-analyzer" },
  { level: "INTERPRET", message: "Validating agent stop codes against loop heuristics - Passed", service: "sledgehammer-gate" },
  { level: "INBOUND", message: "Redirected Claude-3-Sonnet prompt parameters dynamically to Gem-3.5-Lite (Cost cut: -84%)", service: "optimizer" },
  { level: "PASS", message: "Response compiled safely inside 89ms; tracing metadata appended", service: "core-gateway" },
  { level: "INBOUND", message: "Intercepted deep recursive search agent thread. Heuristics OK", service: "sledgehammer-gate" },
  { level: "METRIC", message: "Runaway loop prevention checks: 0 anomalies detected in last 50 queries.", service: "sledgehammer-gate" },
  { level: "WARNING", message: "Token burst detected on endpoint. Multi-agent negotiation stabilized.", service: "prism-proxy-node" },
  { level: "PASS", message: "Autopsy report created for trace-id prism_3910_err", service: "forensics-core" }
];

app.get("/api/telemetry-logs", (req, res) => {
  // Return some random logs or the entire set
  const count = parseInt(req.query.count as string) || 10;
  const result = [];
  for (let i = 0; i < count; i++) {
    const base = mockLogPool[Math.floor(Math.random() * mockLogPool.length)];
    const timestamp = new Date(Date.now() - i * 1500).toLocaleTimeString();
    result.unshift({
      timestamp: `[${timestamp}]`,
      level: base.level,
      message: base.message,
      service: base.service
    });
  }
  res.json(result);
});

// 3. Simulated prompt submission to the Proxy
app.post("/api/proxy-simulation", (req, res) => {
  const { prompt, model } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "No prompt text provided for intercept testing." });
  }

  const promptLower = prompt.toLowerCase();
  const isRecursiveLoop = promptLower.includes("loop") || promptLower.includes("recurs") || promptLower.includes("infinite") || promptLower.includes("again and again");

  let intercepted = false;
  let action = "PROXIED_SUCCESS";
  let analysis = "Passed heuristics parsing safely.";
  let savedCost = 0.0;
  let simulatedCost = 0.002;
  let tokens = Math.floor(prompt.length / 4.4) + 120;

  if (isRecursiveLoop) {
    intercepted = true;
    action = "SLEDGEHAMMER_Killed";
    analysis = "Infinite prompt reflection loop prevented. Rule: Sledgehammer recursive filter matched.";
    savedCost = 14.20;
    simulatedCost = 0.00;
  } else if (model === "high-cost") {
    action = "OPTIMIZER_DOWN_ROUTED";
    analysis = "Cross-provider interrogator assessed prompt context suitable for lighter model. Saved 82% cost.";
    savedCost = 0.12;
    simulatedCost = 0.02;
  }

  res.json({
    prompt,
    intercepted,
    action,
    analysis,
    tokens,
    simulatedCost,
    savedCost,
    timestamp: new Date().toLocaleTimeString()
  });
});

// 4. Gemini Forensic Autopsy Core API
app.post("/api/autopsy", async (req, res) => {
  const { prompt, traceLog } = req.body;
  if (!prompt && !traceLog) {
    return res.status(400).json({ error: "Missing prompt or traceLog in request body." });
  }

  const ai = getAi();
  if (!ai) {
    // Beautiful simulation fallback
    const mockAnalysis = simulateAutopsy(prompt, traceLog);
    return res.json(mockAnalysis);
  }

  try {
    const autopsyPrompt = `You are Agent Prism's Forensic Autopsy Core. You analyze failed, runaway, or broken multi-agent execution traces, prompts, or prompt loops.
Analyze the following input prompt and/or trace logs and return a JSON object that adheres strictly to the structure below.
Do NOT include markdown formatted blocks (do not wrap in \`\`\`json or \`\`\`), do NOT include any descriptive markdown text before or after, just output the raw parsed JSON string.

Adhere strictly to this typescript schema structure:
{
  "verdict": "SLEDGEHAMMER_ALERT" | "COST_ANOMALY" | "LOGIC_LOCK" | "HEALTHY",
  "loopRiskScore": number (relative value from 0 to 100),
  "rootCause": string,
  "leakedTokens": number,
  "estimatedWastedCost": number,
  "reconstructedFlow": string[],
  "patchedPrompt": string,
  "preventionRecommendation": string
}

INPUT FOR ANALYSIS:
Prompt Content:
"${prompt || "No user prompt provided"}"

Trace Logs:
"${traceLog || "No trace logs provided"}"
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: autopsyPrompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const responseText = response.text || "{}";
    // Parse to ensure validity, then return
    try {
      const data = JSON.parse(responseText.trim());
      return res.json(data);
    } catch {
      // If parsing fails for any reason, clean up or resolve fallback
      const cleanJson = responseText.replace(/```json/g, "").replace(/```/g, "").trim();
      return res.json(JSON.parse(cleanJson));
    }
  } catch (error: any) {
    console.error("Gemini Autopsy Core failure:", error);
    // Graceful fallback to rich simulation on engine failure rather than throwing server 500
    const faultFallback = simulateAutopsy(prompt, traceLog);
    return res.json({
      ...faultFallback,
      rootCause: "Analyst Core fell back to local diagnostics. Primary engine notice: " + error.message
    });
  }
});

// High-fidelity fallback simulated analysis structure
function simulateAutopsy(prompt: string, traceLog: string) {
  const lowerPrompt = (prompt || "").toLowerCase();
  const lowerTrace = (traceLog || "").toLowerCase();

  let verdict = "LOGIC_LOCK";
  let loopRiskScore = 65;
  let rootCause = "The multi-agent coordinator entered a deadlocked state while waiting for secondary format validation callbacks without timeout parameters.";
  let leakedTokens = 24150;
  let estimatedWastedCost = 1.85;
  let reconstructedFlow = [
    "User transmitted prompt target",
    "Agent A dispatched subtask to Agent B",
    "Agent B returned schema validation objection",
    "Agent A entered reflection state to auto-correct schema",
    "Reflection cycle repeatedly attempted correction without formatting advances"
  ];
  let patchedPrompt = (prompt || "Prompt target") + "\n\nCRITICAL SYSTEM BOUNDARY:\nFormat strictly as markdown lists. If an output error occurs, output a raw Error summary and exit cleanly. Do not attempt correction cycles.";
  let preventionRecommendation = "Configure strict Max Recursion limits (Max: 2) on the gateway coordinator configuration.";

  if (lowerPrompt.includes("loop") || lowerPrompt.includes("recurse") || lowerPrompt.includes("infinite") || lowerTrace.includes("loop") || lowerTrace.includes("stack overflow")) {
    verdict = "SLEDGEHAMMER_ALERT";
    loopRiskScore = 96;
    rootCause = "Infinite semantic cycle triggered. The model was instructed to continually reflect on its previous refinement recursively with no termination condition.";
    leakedTokens = 142800;
    estimatedWastedCost = 11.42;
    reconstructedFlow = [
      "Initial dispatch parsing completed",
      "Gateway registered recursive callback prompt",
      "Exponential growth of query length observed in proxy",
      "Sledgehammer safety middleware triggered at 142k tokens"
    ];
    patchedPrompt = `${prompt || "Core task"}\n\nCRITICAL CONSTRAINTS:\n- Perform refinement exactly ONCE.\n- Under no circumstances make recursive sub-requests.\n- Terminate with <|PRISM_TERMINAL|>.`;
    preventionRecommendation = "Establish system rules with token threshold-breakers and auto-kill matching patterns.";
  } else if (lowerPrompt.includes("cost") || lowerPrompt.includes("price") || lowerTrace.includes("rate limit") || lowerPrompt.includes("expensive")) {
    verdict = "COST_ANOMALY";
    loopRiskScore = 40;
    rootCause = "Agent requested maximum parameter expansion on high-resource model parameters with excessive output lengths.";
    leakedTokens = 85200;
    estimatedWastedCost = 6.81;
    reconstructedFlow = [
      "User issued broad exploratory command",
      "Agent spawned 5 concurrent analytical prompt tasks",
      "High-cost endpoints returned large unstructured responses simultaneously",
      "Aggregate cost spiked safely below workspace budget limit"
    ];
    patchedPrompt = `Perform summary analysis of the task using maximum concise language. Under 150 words total. Optimize token allocation.`;
    preventionRecommendation = "Inject Prompt Optimizer to down-route analytical subtasks to lightweight local equivalents.";
  }

  return {
    verdict,
    loopRiskScore,
    rootCause,
    leakedTokens,
    estimatedWastedCost,
    reconstructedFlow,
    patchedPrompt,
    preventionRecommendation
  };
}

// Vite integration
async function start() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Agent Prism Central] Service online binding to port ${PORT}`);
  });
}

start();
