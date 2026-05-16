import { AgentPrism } from "./src/sdk/index.js";
import readline from "node:readline";

async function setup() {
  console.log("Agent Prism: OpenAI Gateway Setup");
  console.log("This will save your OpenAI API key as a tenant connector.\n");

  const prism = new AgentPrism();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question("Paste your OpenAI API key (sk-...): ", async (apiKey) => {
    if (!apiKey.startsWith("sk-")) {
      console.error("Invalid OpenAI key format.");
      process.exit(1);
    }

    try {
      const res = await fetch(`${prism.endpoint}/api/connectors`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": prism.clientSecret
        },
        body: JSON.stringify({
          provider: "openai",
          name: "Production OpenAI Account",
          apiKey
        })
      });

      if (res.ok) {
        console.log("\nSuccess. Your OpenAI key is stored in the Agent Prism connector vault.");
        console.log("You can now run `node real_demo_openai_agent.js`.");
      } else {
        console.error("\nFailed to save connector:", await res.text());
      }
    } catch (err) {
      console.error("\nNetwork error:", err.message);
    }

    rl.close();
  });
}

setup();
