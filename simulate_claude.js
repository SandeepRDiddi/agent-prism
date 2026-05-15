// simulate_claude.js
import http from 'http';

// HOW TO USE:
// Run this script in your terminal: node simulate_claude.js <YOUR_API_KEY>
// Replace <YOUR_API_KEY> with the Tenant API Key you got after setup.

const apiKey = process.argv[2];

if (!apiKey) {
  console.error("❌ Error: Please provide your Tenant API Key.");
  console.log("Usage: node simulate_claude.js YOUR_TENANT_API_KEY");
  process.exit(1);
}

const payload = JSON.stringify({
  source: "claude",
  payload: {
    runId: `claude_${Date.now()}`,
    agent: "Claude Support Agent",
    model: "claude-3.5-sonnet",
    jobType: "customer-support",
    status: "success",
    startedAt: new Date(Date.now() - 60000).toISOString(),
    finishedAt: new Date().toISOString(),
    elapsedMs: 60000,
    inputTokens: 1200,
    outputTokens: 800,
    costUsd: 0.05,
    budgetUsd: 0.1,
    autonomyLevel: 4,
    retries: 0,
    toolCalls: 3,
    guardrailHits: 0,
    feedbackScore: 5,
    environment: "production",
    flow: "ticket-resolution",
    team: "support",
    tags: ["support", "billing"],
    breadcrumbs: ["read ticket", "searched knowledge base", "drafted reply", "sent reply"],
    notes: "Successfully resolved a billing inquiry."
  }
});

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/ingest',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'Content-Length': payload.length
  }
};

console.log("🚀 Sending a simulated Claude agent run to Agent Prism...");

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log("✅ Success! Run ingested.");
      console.log("Check your dashboard at http://127.0.0.1:3000/ to see the new data.");
    } else {
      console.error(`❌ Failed with status ${res.statusCode}:`, data);
    }
  });
});

req.on('error', (error) => {
  console.error("❌ Network Error:", error.message);
});

req.write(payload);
req.end();
