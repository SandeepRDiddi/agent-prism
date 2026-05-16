import Anthropic from "@anthropic-ai/sdk";
import { AgentPrism } from "./src/sdk/index.js";

// 1. We NO LONGER need dotenv or hardcoded API keys!
// The AgentPrism SDK automatically reads your `agent-prism login` CLI credentials.
const prism = new AgentPrism();

// 2. We point the standard Anthropic SDK at our secure Gateway Proxy!
// We pass the Agent Prism token as the API key, so the Proxy knows who you are.
const anthropic = new Anthropic({
  apiKey: prism.clientSecret,
  baseURL: prism.endpoint
});

const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";

// A dummy vulnerable code snippet for the AI to review
const PR_DIFF = `
@@ -45,7 +45,7 @@
 function authenticateUser(req, res) {
   const { username, password } = req.body;
   const user = db.findUser(username);
-  if (user && bcrypt.compareSync(password, user.passwordHash)) {
+  if (user && password == user.passwordHash) { // simplified for testing
     const token = jwt.sign({ id: user.id }, "secret_key");
     res.cookie("auth_token", token);
     return res.json({ success: true });
`;

async function main() {
  console.log("🚀 Starting 100% Keyless Claude PR Review Agent...");

  try {
    console.log("⏳ Sending PR diff through the Agent Prism Gateway Proxy...");

    // This request hits Agent Prism, NOT Anthropic.
    // Agent Prism forwards it and handles all telemetry for you!
    const response = await anthropic.messages.create({
      model,
      max_tokens: 1000,
      temperature: 0,
      system: "You are an expert security engineer reviewing a pull request. Identify vulnerabilities and provide a fix. Output exactly what the developer should do.",
      messages: [
        {
          role: "user",
          content: `Review this PR diff for security issues:\n\n${PR_DIFF}`
        }
      ]
    });

    console.log("\n✅ Claude returned the review (Proxied through Agent Prism)!");
    console.log("================ REVIEW OUTPUT ================");
    console.log(response.content[0].text);
    console.log("===============================================\n");

    console.log("👉 Check your Agent Prism dashboard! The cost and audit log were recorded automatically.");

  } catch (err) {
    console.error("❌ Error running agent:", err);
    console.error("\nTip: if Anthropic returns a provider-side 500, try a different Claude model:");
    console.error("ANTHROPIC_MODEL=claude-sonnet-4-20250514 node real_demo_agent.js");
  }
}

main();
