import { AgentPrism } from "./src/sdk/index.js";
import readline from "node:readline";

async function setup() {
  console.log("🚀 Agent Prism: Gateway Proxy Setup");
  console.log("We will securely save your Anthropic API Key to the Agent Prism Vault.\n");

  const prism = new AgentPrism();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Paste your Anthropic API Key (sk-ant-...): ', async (apiKey) => {
    if (!apiKey.startsWith("sk-ant")) {
      console.error("❌ Invalid Anthropic Key.");
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
          provider: "anthropic",
          name: "Production Claude Account",
          apiKey: apiKey
        })
      });

      if (res.ok) {
        console.log("\n✅ Success! Your Anthropic key is securely stored in the Agent Prism Vault.");
        console.log("You can now run `node real_demo_agent.js` and it will run 100% keyless!");
      } else {
        console.error("\n❌ Failed to save connector:", await res.text());
      }
    } catch (err) {
      console.error("\n❌ Network error:", err.message);
    }

    rl.close();
  });
}

setup();
