/**
 * Agent Prism Node.js SDK
 * Securely authenticate and send telemetry to your Agent Prism control plane.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export class AgentPrism {
  /**
   * Initialize the Agent Prism SDK.
   * Automatically reads from `~/.agent-prism/credentials.json` if you logged in via CLI.
   */
  constructor(options = {}) {
    let { clientId, clientSecret, endpoint } = options;

    clientId = clientId || process.env.AGENT_PRISM_CLIENT_ID;
    clientSecret = clientSecret || process.env.AGENT_PRISM_API_KEY;
    endpoint = endpoint || process.env.AGENT_PRISM_ENDPOINT;

    // Fallback to CLI Credentials if no explicit options provided
    if (!clientSecret) {
      try {
        const credFile = path.join(os.homedir(), '.agent-prism', 'credentials.json');
        if (fs.existsSync(credFile)) {
          const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
          clientSecret = creds.apiKey;
          endpoint = endpoint || creds.endpoint;
        }
      } catch (e) {
        // Ignore read errors
      }
    }

    if (!clientSecret) {
      throw new Error("Agent Prism SDK: Not authenticated. Run `npx agent-prism login` or provide clientSecret.");
    }

    this.clientId = clientId || "cli_user"; 
    this.clientSecret = clientSecret;
    this.endpoint = (endpoint || 'http://127.0.0.1:3000').replace(/\/$/, "");
    
    this.accessToken = null;
    this.tokenExpiration = null;
  }

  /**
   * Internal method to acquire or refresh the OAuth 2.0 JWT.
   */
  async _authenticate() {
    // If we have a valid token that expires in more than 5 minutes, reuse it.
    if (this.accessToken && this.tokenExpiration && Date.now() < this.tokenExpiration - 300000) {
      return this.accessToken;
    }

    const res = await fetch(`${this.endpoint}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials'
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Agent Prism Authentication Failed: ${errText}`);
    }

    const data = await res.json();
    this.accessToken = data.access_token;
    // Set expiration based on expires_in (seconds)
    this.tokenExpiration = Date.now() + (data.expires_in * 1000);
    
    return this.accessToken;
  }

  /**
   * Pushes an agent run telemetry payload to the control plane.
   * @param {Object} payload 
   * @returns {Promise<Object>} The server response
   */
  async logRun(payload) {
    const token = await this._authenticate();

    const res = await fetch(`${this.endpoint}/api/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Agent Prism Telemetry Push Failed (${res.status}): ${errText}`);
    }

    return await res.json();
  }
}
