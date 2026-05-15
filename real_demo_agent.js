import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { AgentPrism } from "./src/sdk/index.js";
import http from 'http';

// Ensure API keys are present
const anthropicKey = process.env.ANTHROPIC_API_KEY;
const acpKey = process.env.ACP_API_KEY;

if (!anthropicKey || anthropicKey.startsWith('your_')) {
  console.error("❌ Error: Missing ANTHROPIC_API_KEY in .env file.");
  process.exit(1);
}
if (!acpKey || acpKey.startsWith('your_')) {
  console.error("❌ Error: Missing ACP_API_KEY in .env file.");
  process.exit(1);
}

const anthropic = new Anthropic({
  apiKey: anthropicKey,
});

// A sample PR diff payload to analyze
const samplePRDiff = `
diff --git a/src/auth.js b/src/auth.js
index 83f912c..d8e41a2 100644
--- a/src/auth.js
+++ b/src/auth.js
@@ -10,7 +10,7 @@ function login(req, res) {
   const user = db.findUser(username);
   
-  if (user && bcrypt.compareSync(password, user.passwordHash)) {
+  if (user && password == user.password) { // simplified for testing
     const token = jwt.sign({ id: user.id }, "secret_key");
     res.cookie("auth_token", token);
     return res.json({ success: true });
`;

async function runDemo() {
  console.log("🚀 Starting Claude PR Review Agent...");
  const startTime = Date.now();

  try {
    // 1. Call real Claude to review the PR
    console.log("⏳ Sending PR diff to Claude for review...");
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: "You are an expert Principal Engineer. Review the following GitHub Pull Request diff. Point out any security vulnerabilities, bugs, or bad practices. Be concise and format your response in markdown.",
      messages: [
        { role: "user", content: "Please review this PR diff:\n\n" + samplePRDiff }
      ]
    });

    const endTime = Date.now();
    const elapsedMs = endTime - startTime;

    // 2. Extract Telemetry from Claude's response
    const inputTokens = message.usage.input_tokens;
    const outputTokens = message.usage.output_tokens;
    
    // Calculate cost based on Claude 3.5 Sonnet pricing ($3/1M input, $15/1M output)
    const costUsd = (inputTokens / 1_000_000 * 3.00) + (outputTokens / 1_000_000 * 15.00);

    console.log("\n✅ Claude returned the review!");
    console.log("================ REVIEW OUTPUT ================");
    console.log(message.content[0].text);
    console.log("===============================================\n");

    // 3. Format payload for Agent Prism
    const prismPayload = JSON.stringify({
      source: "claude",
      payload: {
        runId: `pr_review_${Date.now()}`,
        agent: "Security Code Reviewer",
        model: message.model,
        jobType: "pr-review",
        status: "success",
        startedAt: new Date(startTime).toISOString(),
        finishedAt: new Date(endTime).toISOString(),
        elapsedMs: elapsedMs,
        inputTokens: inputTokens,
        outputTokens: outputTokens,
        costUsd: costUsd,
        budgetUsd: 0.05,
        autonomyLevel: 4,
        retries: 0,
        toolCalls: 0,
        guardrailHits: 0,
        feedbackScore: null,
        environment: "production",
        flow: "github-actions-ci",
        team: "engineering",
        tags: ["security", "review"],
        breadcrumbs: ["fetched diff", "analyzed security", "posted comment"],
        notes: "Real PR review processed successfully."
      }
    });

    // 4. Send telemetry to Agent Prism using the official SDK
    console.log("📡 Initializing Agent Prism SDK...");
    
    const prism = new AgentPrism({
      clientId: process.env.CLIENT_ID || "tenant_8f7cfd4a2cbd",
      clientSecret: acpKey,
      endpoint: process.env.AGENT_PRISM_URL || 'http://127.0.0.1:3000'
    });

    try {
      console.log("📡 Pushing telemetry...");
      await prism.logRun(JSON.parse(prismPayload));
      console.log(`✅ Success! Agent run logged via SDK. Cost: $${costUsd.toFixed(5)}`);
      console.log(`👉 Check your dashboard to see the real data!`);
    } catch (err) {
      console.error(`❌ SDK Error:`, err.message);
    }

  } catch (err) {
    console.error("❌ Error running agent:", err);
  }
}

runDemo();
