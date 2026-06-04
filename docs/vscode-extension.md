# Agent Prism VS Code Extension

The Agent Prism VS Code extension captures local agent prompt activity from VS Code and sends it to your Agent Prism tenant.

It is intentionally honest about token capture:

- Activity capture records prompt metadata, repo/workspace, file context, and audit evidence.
- Usage capture records actual token values only when you paste actuals from the provider/tool output.
- Prompt bucket capture records actual user/system/context/tool/memory token fields only when those values are available.
- The extension does not estimate tokens.

## Run Locally

1. Open the extension folder in VS Code:

```bash
code /Users/sandeepdiddi/Documents/agent-prism/agent-prism/vscode-extension
```

2. Press `F5`.

3. VS Code opens a new Extension Development Host window.

4. In the new window, open Command Palette:

```text
Cmd+Shift+P
```

5. Run:

```text
Agent Prism: Configure Workspace
```

6. Enter:

```text
Endpoint: https://agent-prism.onrender.com
API key: acp_your_tenant_key
```

The API key is stored in VS Code SecretStorage.

## Send A Demo Event

In the Extension Development Host window, run:

```text
Agent Prism: Send Sample Run
```

Then open Agent Prism and refresh:

```text
Token Coach
```

You should see the Prompt Burn panel populate with actual bucket values.

## Capture Prompt Activity

Use this when you type a prompt in Copilot, Claude, or another VS Code workflow but the tool does not expose exact tokens.

1. Select the prompt text in VS Code.
2. Right-click.
3. Click:

```text
Agent Prism: Capture Prompt Activity
```

This sends activity metadata only. Token values remain unavailable and are not estimated.

## Capture Actual Tokens

Use this when the tool/provider gives you actual usage numbers.

1. Run:

```text
Agent Prism: Capture Run With Token Actuals
```

2. Enter the provider, model, prompt tokens, completion tokens, and any actual bucket values you have:

```text
userPromptTokens
systemPromptTokens
contextTokens
toolResultTokens
memoryTokens
```

3. Refresh Agent Prism:

```text
Token Coach
```

## Enterprise Capture Levels

Agent Prism should present VS Code prompt capture in three levels:

| Level | Meaning |
| --- | --- |
| Activity captured | Prompt event, user workflow, repo/file context, timestamp |
| Usage actuals captured | Provider-reported input/output tokens |
| Prompt breakdown captured | Actual user/system/context/tool/memory buckets |

For closed tools like GitHub Copilot Chat, exact token usage depends on what the provider exposes. Agent Prism should not invent token values.
