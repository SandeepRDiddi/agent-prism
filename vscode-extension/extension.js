const vscode = require("vscode");

const SECRET_KEY = "agentPrism.apiKey";

function config() {
  return vscode.workspace.getConfiguration("agentPrism");
}

function nowIso() {
  return new Date().toISOString();
}

function safeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function selectedText() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return "";
  const text = editor.document.getText(editor.selection);
  return text.trim();
}

function workspaceName() {
  return vscode.workspace.name || "local-workspace";
}

function activeFileContext() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return {};
  return {
    fileName: editor.document.fileName,
    languageId: editor.document.languageId
  };
}

async function getApiKey(context) {
  const secretValue = await context.secrets.get(SECRET_KEY);
  return secretValue || config().get("apiKey") || "";
}

async function requireSettings(context) {
  const endpoint = String(config().get("endpoint") || "").replace(/\/$/, "");
  const apiKey = await getApiKey(context);

  if (!endpoint) {
    vscode.window.showErrorMessage("Agent Prism endpoint is not configured.");
    return null;
  }

  if (!apiKey) {
    const choice = await vscode.window.showWarningMessage(
      "Agent Prism API key is not configured.",
      "Configure now"
    );
    if (choice === "Configure now") {
      await configure(context);
    }
    return null;
  }

  return { endpoint, apiKey };
}

function buildRunPayload(input) {
  const startedAt = input.startedAt || nowIso();
  const completedAt = input.completedAt || nowIso();
  const file = activeFileContext();
  const tokensIn = safeNumber(input.tokensIn);
  const tokensOut = safeNumber(input.tokensOut);
  const userPromptTokens = safeNumber(input.userPromptTokens);
  const systemPromptTokens = safeNumber(input.systemPromptTokens);
  const contextTokens = safeNumber(input.contextTokens);
  const toolResultTokens = safeNumber(input.toolResultTokens);
  const memoryTokens = safeNumber(input.memoryTokens);

  return {
    source: "generic",
    payload: {
      id: input.id || `vscode_${Date.now()}`,
      source: "vscode",
      agentName: input.agentName || config().get("defaultAgentName") || "VS Code Agent",
      provider: input.provider || "VS Code",
      model: input.model || "unknown",
      taskType: input.taskType || "prompt-activity",
      status: input.status || "success",
      startTime: startedAt,
      endTime: completedAt,
      latencyMs: safeNumber(input.latencyMs),
      tokensIn,
      tokensOut,
      promptBreakdown: {
        userPromptTokens,
        systemPromptTokens,
        contextTokens,
        toolResultTokens,
        memoryTokens
      },
      costUsd: safeNumber(input.costUsd),
      budgetUsd: safeNumber(input.budgetUsd, 1),
      autonomyLevel: safeNumber(input.autonomyLevel, 2),
      retryCount: safeNumber(input.retryCount),
      toolCalls: safeNumber(input.toolCalls),
      policyViolations: safeNumber(input.policyViolations),
      userSatisfaction: safeNumber(input.userSatisfaction, 4),
      environment: "developer-workstation",
      workflow: input.workflow || workspaceName(),
      team: input.team || config().get("team") || "engineering",
      tags: ["vscode", "prompt-capture", input.captureLevel || "activity"].filter(Boolean),
      breadcrumbs: [
        {
          type: "capture_level",
          value: input.captureLevel || "activity",
          message: input.captureMessage || "Prompt activity captured from VS Code."
        },
        file
      ],
      notes: input.notes || ""
    }
  };
}

async function sendRun(context, input) {
  const settings = await requireSettings(context);
  if (!settings) return null;

  const payload = buildRunPayload(input);
  const response = await fetch(`${settings.endpoint}/api/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data.message || data.error || `Agent Prism returned HTTP ${response.status}`);
  }

  return data;
}

async function configure(context) {
  const currentEndpoint = config().get("endpoint") || "https://agent-prism.onrender.com";
  const endpoint = await vscode.window.showInputBox({
    title: "Agent Prism Endpoint",
    prompt: "Enter your Agent Prism URL.",
    value: currentEndpoint,
    ignoreFocusOut: true
  });
  if (!endpoint) return;

  const apiKey = await vscode.window.showInputBox({
    title: "Agent Prism Tenant API Key",
    prompt: "Paste your tenant API key beginning with acp_. It will be stored in VS Code SecretStorage.",
    password: true,
    ignoreFocusOut: true
  });
  if (!apiKey) return;

  await config().update("endpoint", endpoint.replace(/\/$/, ""), vscode.ConfigurationTarget.Workspace);
  await context.secrets.store(SECRET_KEY, apiKey.trim());
  vscode.window.showInformationMessage("Agent Prism workspace configured.");
}

async function capturePrompt(context) {
  const promptText = selectedText() || await vscode.window.showInputBox({
    title: "Prompt activity",
    prompt: "Paste the prompt text or short description. Token values are not estimated.",
    ignoreFocusOut: true
  });

  if (!promptText) return;

  const agentName = await vscode.window.showInputBox({
    title: "Agent name",
    value: config().get("defaultAgentName") || "VS Code Agent",
    ignoreFocusOut: true
  });

  try {
    await sendRun(context, {
      agentName,
      provider: "VS Code",
      model: "unknown",
      taskType: "prompt-activity",
      workflow: workspaceName(),
      captureLevel: "activity",
      captureMessage: "Activity captured. Exact token usage was not exposed by the local tool.",
      notes: `Prompt activity captured from VS Code. Exact tokens unavailable unless the model provider or SDK supplies actual usage. Prompt preview: ${promptText.slice(0, 600)}`
    });
    vscode.window.showInformationMessage("Agent Prism captured prompt activity. Token actuals were not estimated.");
  } catch (error) {
    vscode.window.showErrorMessage(`Agent Prism capture failed: ${error.message}`);
  }
}

async function captureRunActuals(context) {
  const agentName = await vscode.window.showInputBox({
    title: "Agent name",
    value: config().get("defaultAgentName") || "VS Code Agent",
    ignoreFocusOut: true
  });
  if (!agentName) return;

  const provider = await vscode.window.showQuickPick(["OpenAI", "Anthropic", "GitHub Copilot", "Local Llama", "Other"], {
    title: "Provider"
  });
  if (!provider) return;

  const model = await vscode.window.showInputBox({
    title: "Model",
    value: provider === "OpenAI" ? "gpt-4.1-mini" : provider === "Anthropic" ? "claude-sonnet-4-5" : "unknown",
    ignoreFocusOut: true
  });

  const tokensIn = await vscode.window.showInputBox({
    title: "Actual prompt/input tokens",
    prompt: "Enter actual usage returned by the provider/tool. Leave blank if unavailable.",
    ignoreFocusOut: true
  });
  const tokensOut = await vscode.window.showInputBox({
    title: "Actual completion/output tokens",
    prompt: "Enter actual usage returned by the provider/tool. Leave blank if unavailable.",
    ignoreFocusOut: true
  });
  const userPromptTokens = await vscode.window.showInputBox({ title: "Actual user prompt tokens", prompt: "Leave blank if unavailable.", ignoreFocusOut: true });
  const systemPromptTokens = await vscode.window.showInputBox({ title: "Actual system prompt tokens", prompt: "Leave blank if unavailable.", ignoreFocusOut: true });
  const contextTokens = await vscode.window.showInputBox({ title: "Actual RAG/context tokens", prompt: "Leave blank if unavailable.", ignoreFocusOut: true });
  const toolResultTokens = await vscode.window.showInputBox({ title: "Actual tool result tokens", prompt: "Leave blank if unavailable.", ignoreFocusOut: true });
  const memoryTokens = await vscode.window.showInputBox({ title: "Actual memory/history tokens", prompt: "Leave blank if unavailable.", ignoreFocusOut: true });

  try {
    await sendRun(context, {
      agentName,
      provider,
      model,
      taskType: "agent-run",
      workflow: workspaceName(),
      captureLevel: "usage-actuals",
      captureMessage: "Actual token usage supplied by the local tool or provider output.",
      tokensIn,
      tokensOut,
      userPromptTokens,
      systemPromptTokens,
      contextTokens,
      toolResultTokens,
      memoryTokens,
      notes: "Token actuals manually supplied from provider/tool output. No token estimates were generated by the extension."
    });
    vscode.window.showInformationMessage("Agent Prism captured run token actuals.");
  } catch (error) {
    vscode.window.showErrorMessage(`Agent Prism capture failed: ${error.message}`);
  }
}

async function sendSampleRun(context) {
  try {
    await sendRun(context, {
      agentName: "VS Code Prompt Demo Agent",
      provider: "VS Code",
      model: "activity-capture",
      taskType: "prompt-governance-demo",
      workflow: workspaceName(),
      captureLevel: "prompt-breakdown-actuals",
      captureMessage: "Sample run with actual prompt bucket fields.",
      tokensIn: 3200,
      tokensOut: 900,
      userPromptTokens: 700,
      systemPromptTokens: 500,
      contextTokens: 1300,
      toolResultTokens: 500,
      memoryTokens: 200,
      costUsd: 0.012,
      budgetUsd: 0.05,
      latencyMs: 2400,
      notes: "Sample VS Code prompt telemetry with bucket actuals."
    });
    vscode.window.showInformationMessage("Agent Prism sample run sent. Refresh Token Coach.");
  } catch (error) {
    vscode.window.showErrorMessage(`Agent Prism sample failed: ${error.message}`);
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand("agentPrism.configure", () => configure(context)),
    vscode.commands.registerCommand("agentPrism.capturePrompt", () => capturePrompt(context)),
    vscode.commands.registerCommand("agentPrism.captureRunActuals", () => captureRunActuals(context)),
    vscode.commands.registerCommand("agentPrism.sendSampleRun", () => sendSampleRun(context))
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
