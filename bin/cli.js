#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const configDir = path.join(os.homedir(), '.agent-prism');
const credentialsFile = path.join(configDir, 'credentials.json');

const args = process.argv.slice(2);
const command = args[0];

function ensureConfigDir() {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

if (command === 'login') {
  console.log('🚀 Welcome to the Agent Prism CLI\n');
  console.log('To login, please open your Agent Prism Dashboard (https://agent-prism.onrender.com)');
  console.log('and copy your API Key (Client Secret).\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Paste your Agent Prism API Key: ', (apiKey) => {
    if (!apiKey) {
      console.error('❌ Error: API Key cannot be empty.');
      rl.close();
      process.exit(1);
    }

    ensureConfigDir();
    const config = {
      apiKey: apiKey.trim(),
      endpoint: process.env.AGENT_PRISM_URL || 'https://agent-prism.onrender.com'
    };

    fs.writeFileSync(credentialsFile, JSON.stringify(config, null, 2), { mode: 0o600 });
    console.log(`\n✅ Login successful!`);
    console.log(`🔐 Credentials saved securely to ${credentialsFile}`);
    console.log(`\nYou can now delete your local .env files! The SDK will automatically use this login.`);
    rl.close();
  });
} else if (command === 'logout') {
  if (fs.existsSync(credentialsFile)) {
    fs.unlinkSync(credentialsFile);
    console.log('👋 Logged out successfully. Credentials removed.');
  } else {
    console.log('You are not currently logged in.');
  }
} else {
  console.log('Usage: agent-prism <command>');
  console.log('\nCommands:');
  console.log('  login     Authenticate your computer with Agent Prism');
  console.log('  logout    Remove your saved credentials');
}
