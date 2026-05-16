import { AgentPrism } from "./src/sdk/index.js";

const prism = new AgentPrism();

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

function extractOutputText(response) {
  if (response.output_text) return response.output_text;
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .map((content) => content.text || "")
    .filter(Boolean)
    .join("\n");
}

async function main() {
  console.log("Starting keyless OpenAI PR Review Agent...");
  console.log("Sending PR diff through the Agent Prism OpenAI gateway...");

  try {
    const res = await fetch(`${prism.endpoint}/v1/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${prism.clientSecret}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions:
          "You are an expert security engineer reviewing a pull request. Identify vulnerabilities and provide a concise fix plan.",
        input: `Review this PR diff for security issues:\n\n${PR_DIFF}`,
        max_output_tokens: 700
      })
    });

    const response = await res.json();

    if (!res.ok) {
      throw new Error(JSON.stringify(response, null, 2));
    }

    console.log("\nOpenAI returned the review through Agent Prism.");
    console.log("================ REVIEW OUTPUT ================");
    console.log(extractOutputText(response) || "(No text output returned.)");
    console.log("===============================================\n");
    console.log("Check the Agent Prism dashboard. The OpenAI run was recorded next to the Claude run.");
  } catch (err) {
    console.error("Error running OpenAI agent:", err.message);
  }
}

main();
