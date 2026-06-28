# Real Agent Demo — PR Review

Two real agents. One gets certified and goes live on GitHub. One gets blocked.

## What these agents do

### PRReviewAgent (safe — Tier 2)
- Reads open pull requests from your GitHub repo
- Analyses: file count, sensitive files, missing tests, risky extensions
- Posts a real review comment on each PR via GitHub API
- **Waits in terminal until you certify it in Agent Prism dashboard**
- Once certified → reviews PRs automatically

### PRReviewAgentPlus (risky — Tier 3/4)
- Same purpose — BUT declares `exec_shell`, `force_merge_pr`, `delete_branch`
- These tools are flagged as Dangerous / High Risk by Agent Prism
- **Cannot be certified for production — blocked by policy**
- Stays in waiting state forever

---

## Setup

### 1. GitHub token

Go to https://github.com/settings/tokens → Generate new token (classic)

Scopes needed:
- `repo` (to read PRs and post reviews)

```bash
export GITHUB_TOKEN=ghp_...
export GITHUB_REPO=SandeepRDiddi/agent-prism   # or any repo with open PRs
```

### 2. Agent Prism key

```bash
export PRISM_KEY=acp_...
export PRISM_URL=https://agent-prism.onrender.com   # or http://localhost:3000
```

---

## Run the demo

Open **two terminals** side by side with the **Agent Prism dashboard** open on Governance tab.

**Terminal 1 — Safe agent (will go live):**
```bash
node agents/pr_review_safe/agent.js
```

**Terminal 2 — Risky agent (will be blocked):**
```bash
node agents/pr_review_risky/agent.js
```

Both agents appear in the Governance tab immediately.

---

## What to do in the dashboard

### Certify the safe agent

1. Governance tab → find **PRReviewAgent**
2. Card shows: T2, tools: `fetch_pr_metadata`, `read_pr_files`, `post_review_comment`
3. Click **Review & Certify** → read the tool breakdown → confirm
4. Click **Promote to Production**
5. **Watch Terminal 1** — agent detects the cert and prints "CERTIFIED — Agent is now live!"
6. Agent immediately scans your repo for open PRs and posts review comments

### Try to certify the risky agent

1. Find **PRReviewAgentPlus** in the Governance tab
2. Card shows: Tier 3/4, red tool pills for `exec_shell`, `force_merge_pr`, `delete_branch`
3. Click **Review & Certify** → review screen shows red risk pills
4. Even if you certify staging — click **Promote to Production** → **BLOCKED**
5. **Terminal 2** keeps printing "Not certified" forever

---

## What you'll see on GitHub

After certifying PRReviewAgent, open any PR in your repo. You'll see a comment like:

```
## ✅ PR Review — Agent Prism

**Agent:** PRReviewAgent v1.0.0 · Certified for production via Agent Prism

**Files:** 3 changed (+45/-12 lines) — 2×.js, 1×.md
**Branch:** `feat/new-feature` → `main`

### Assessment
No risk flags. PR looks clean. Human review recommended before merge.

---
*Automated review by PRReviewAgent · Certified via Agent Prism · Sat, 28 Jun 2026*
```

---

## The point of this demo

The **certification is the gate**. The agent itself checks its cert status from
Agent Prism before doing anything on GitHub. You hold the switch in the dashboard.

- Uncertified → agent waits, GitHub is untouched
- Certified → agent goes live, posts reviews
- Revoke in dashboard → next poll cycle, agent checks cert → blocked → stops

The risky agent can never reach GitHub because its tool manifest contains tools
that Agent Prism's policy blocks from production. The developer wrote the agent,
declared what it does, and the platform enforces the decision.
