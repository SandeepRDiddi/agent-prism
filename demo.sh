#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Agent Prism — Demo Script
# Starts the server, bootstraps a tenant, simulates multi-platform agent
# activity, and prints the ROI metrics summary.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
PORT="${PORT:-3000}"
HOST="http://127.0.0.1:$PORT"
ADMIN_SECRET="${ACP_ADMIN_SECRET:-change-me-before-production}"
SERVER_PID=""
DEMO_STATE_BACKUP=""

# ── Colors ────────────────────────────────────────────────────────────────────
BOLD=$'\033[1m'
GREEN=$'\033[0;32m'
CYAN=$'\033[0;36m'
YELLOW=$'\033[0;33m'
RED=$'\033[0;31m'
RESET=$'\033[0m'

log()     { echo "${CYAN}▶ $*${RESET}"; }
ok()      { echo "${GREEN}✔ $*${RESET}"; }
warn()    { echo "${YELLOW}⚠ $*${RESET}"; }
fail()    { echo "${RED}✖ $*${RESET}"; exit 1; }
header()  { echo; echo "${BOLD}── $* ──${RESET}"; }

# ── Cleanup ───────────────────────────────────────────────────────────────────
cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    log "Stopping demo server (PID $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  # Restore original state if we backed it up
  if [[ -n "$DEMO_STATE_BACKUP" && -f "$DEMO_STATE_BACKUP" ]]; then
    mv "$DEMO_STATE_BACKUP" data/app-state.json
    ok "Restored original app state"
  fi
}
trap cleanup EXIT INT TERM

# ── Helpers ───────────────────────────────────────────────────────────────────
wait_for_server() {
  local retries=20
  while ! curl -sf "$HOST/api/health" > /dev/null 2>&1; do
    retries=$((retries - 1))
    [[ $retries -le 0 ]] && fail "Server did not start within 10s"
    sleep 0.5
  done
}

post() {
  local path="$1"; shift
  curl -sf -X POST "$HOST$path" \
    -H "Content-Type: application/json" \
    "$@"
}

patch_req() {
  local path="$1"; shift
  curl -sf -X PATCH "$HOST$path" \
    -H "Content-Type: application/json" \
    "$@"
}

get_req() {
  local path="$1"; shift
  curl -sf "$HOST$path" "$@"
}

json_field() {
  # Extract a field from JSON using python (available on macOS/Linux by default)
  python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"
}

fmt_json() {
  python3 -m json.tool
}

# ── Pre-flight checks ─────────────────────────────────────────────────────────
header "Pre-flight checks"

command -v node   > /dev/null || fail "node not found — install Node.js 18+"
command -v curl   > /dev/null || fail "curl not found"
command -v python3 > /dev/null || fail "python3 not found"

[[ -f "server.js" ]] || fail "Run this script from the agent-prism project root"

if ! [[ -f ".env" ]]; then
  warn ".env not found — copying from .env.example"
  cp .env.example .env
fi

if ! [[ -d "data" ]]; then
  mkdir -p data
fi

# Back up existing state so demo doesn't corrupt it
if [[ -f "data/app-state.json" ]]; then
  DEMO_STATE_BACKUP="data/app-state.json.demo-backup"
  cp data/app-state.json "$DEMO_STATE_BACKUP"
  log "Existing state backed up → $DEMO_STATE_BACKUP"
fi

# Reset to empty state for a clean demo
python3 -c "
import json
empty = {'tenants':[],'users':[],'apiKeys':[],'connectors':[],'sessions':[],'events':[],'webhooks':[]}
with open('data/app-state.json','w') as f:
    json.dump(empty, f)
"
ok "App state reset for demo"

# ── Start server ──────────────────────────────────────────────────────────────
header "Starting Agent Prism server"

CORS_ALLOWED_ORIGINS="http://127.0.0.1:$PORT" \
ACP_ADMIN_SECRET="$ADMIN_SECRET" \
  node server.js > /tmp/agent-prism-demo.log 2>&1 &
SERVER_PID=$!

log "Waiting for server on port $PORT..."
wait_for_server
ok "Server is up  →  $HOST  (PID $SERVER_PID)"
ok "Dashboard     →  $HOST/dashboard"

# ── Bootstrap ─────────────────────────────────────────────────────────────────
header "Bootstrapping demo tenant"

BOOTSTRAP_RESP=$(post /api/bootstrap \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{"companyName":"Acme AI Labs","adminEmail":"demo@acme.example","adminName":"Demo User"}')

API_KEY=$(echo "$BOOTSTRAP_RESP" | json_field "d['apiKey']")
TENANT_ID=$(echo "$BOOTSTRAP_RESP" | json_field "d['tenant']['id']")

ok "Tenant created : $(echo "$BOOTSTRAP_RESP" | json_field "d['tenant']['name']")"
ok "Tenant ID      : $TENANT_ID"
ok "API key        : ${API_KEY:0:20}..."

# ── Simulate Claude agent activity ────────────────────────────────────────────
header "Simulating Claude agent sessions"

# Session 1 — code review (completed)
log "Session 1: Claude code review..."
SESS1=$(post /api/sessions -H "x-api-key: $API_KEY" \
  -d '{"platform":"claude","session_id":"demo-claude-1"}' \
  | json_field "d.get('session',d)['id']")
post /api/usage -H "x-api-key: $API_KEY" \
  -d "{\"session_id\":\"$SESS1\",\"platform\":\"claude\",\"input_tokens\":8000,\"output_tokens\":2000}" > /dev/null
patch_req /api/sessions/$SESS1 -H "x-api-key: $API_KEY" \
  -d '{"status":"completed"}' > /dev/null
ok "  Code review session → completed  (8k in / 2k out)"

# Session 2 — test writing (completed)
log "Session 2: Claude test generation..."
SESS2=$(post /api/sessions -H "x-api-key: $API_KEY" \
  -d '{"platform":"claude"}' \
  | json_field "d.get('session',d)['id']")
post /api/usage -H "x-api-key: $API_KEY" \
  -d "{\"session_id\":\"$SESS2\",\"platform\":\"claude\",\"input_tokens\":5000,\"output_tokens\":4000}" > /dev/null
patch_req /api/sessions/$SESS2 -H "x-api-key: $API_KEY" \
  -d '{"status":"completed"}' > /dev/null
ok "  Test generation session → completed  (5k in / 4k out)"

# Session 3 — still running
log "Session 3: Claude refactor (in progress)..."
SESS3=$(post /api/sessions -H "x-api-key: $API_KEY" \
  -d '{"platform":"claude"}' \
  | json_field "d.get('session',d)['id']")
post /api/usage -H "x-api-key: $API_KEY" \
  -d "{\"session_id\":\"$SESS3\",\"platform\":\"claude\",\"input_tokens\":3000,\"output_tokens\":1000}" > /dev/null
ok "  Refactor session → running  (3k in / 1k out so far)"

# ── Simulate Copilot agent activity ──────────────────────────────────────────
header "Simulating GitHub Copilot sessions"

log "Session 4: Copilot pair programming (4 hours)..."
SESS4=$(post /api/sessions -H "x-api-key: $API_KEY" \
  -d '{"platform":"copilot"}' \
  | json_field "d.get('session',d)['id']")
post /api/usage -H "x-api-key: $API_KEY" \
  -d "{\"session_id\":\"$SESS4\",\"platform\":\"copilot\",\"seat_hours\":4}" > /dev/null
patch_req /api/sessions/$SESS4 -H "x-api-key: $API_KEY" \
  -d '{"status":"completed"}' > /dev/null
ok "  Copilot session → completed  (4 seat-hours)"

log "Session 5: Copilot docs (2 hours)..."
SESS5=$(post /api/sessions -H "x-api-key: $API_KEY" \
  -d '{"platform":"copilot"}' \
  | json_field "d.get('session',d)['id']")
post /api/usage -H "x-api-key: $API_KEY" \
  -d "{\"session_id\":\"$SESS5\",\"platform\":\"copilot\",\"seat_hours\":2}" > /dev/null
patch_req /api/sessions/$SESS5 -H "x-api-key: $API_KEY" \
  -d '{"status":"completed"}' > /dev/null
ok "  Copilot session → completed  (2 seat-hours)"

# ── Simulate generic agent activity ──────────────────────────────────────────
header "Simulating generic agent sessions"

log "Session 6: Custom agent (direct cost)..."
SESS6=$(post /api/sessions -H "x-api-key: $API_KEY" \
  -d '{"platform":"generic"}' \
  | json_field "d.get('session',d)['id']")
post /api/usage -H "x-api-key: $API_KEY" \
  -d "{\"session_id\":\"$SESS6\",\"platform\":\"generic\",\"cost_usd\":0.45}" > /dev/null
patch_req /api/sessions/$SESS6 -H "x-api-key: $API_KEY" \
  -d '{"status":"completed"}' > /dev/null
ok "  Generic agent session → completed  (\$0.45 direct cost)"

# ── Metrics summary ───────────────────────────────────────────────────────────
header "ROI Metrics Summary"

METRICS=$(get_req /api/metrics/summary -H "x-api-key: $API_KEY")

python3 - <<EOF
import json

m = json.loads('''$METRICS''')

cost_day    = m['cost']['day']['totalUsd']
by_platform = m['cost']['day']['byPlatform']
roi         = m['roi']['day']
active      = m['activeAgents']['total']
stale       = m['meta']['pricingStale']

print()
print("  Active agents right now : {}".format(active))
print()
print("  ── Cost (today) ─────────────────────────")
for platform, usd in by_platform.items():
    print("    {:10s}  \${:.4f}".format(platform, usd))
print("    {:10s}  \${:.4f}".format("TOTAL", cost_day))
print()
print("  ── ROI (today) ──────────────────────────")
print("    Completed sessions     : {}".format(roi['completedSessions']))
print("    FTE hours saved        : {:.1f} hrs".format(roi['fteHoursSaved']))
print("    FTE cost equivalent    : \${:,.2f}".format(roi['fteCostEquivalentUsd']))
print("    Agent cost             : \${:.4f}".format(roi['agentCostUsd']))
print("    Net savings            : \${:,.2f}".format(roi['netSavingsUsd']))
if roi['roiMultiplier']:
    print("    ROI multiplier         : {:.0f}x".format(roi['roiMultiplier']))
print()
print("  Assumptions: {avg_human_hours_per_task}h per task, \${loaded_hourly_rate_usd}/hr FTE".format(**roi['assumptions']))
if stale:
    print()
    print("  ⚠  Pricing data may be stale — check config/pricing.json")
EOF

# ── Open dashboard ────────────────────────────────────────────────────────────
header "Dashboard"
echo
echo "  ${BOLD}Open in your browser:${RESET}  $HOST/dashboard"
echo
echo "  When prompted for an API key, paste:"
echo "  ${CYAN}$API_KEY${RESET}"
echo

if command -v open > /dev/null 2>&1; then
  read -rp "  Open dashboard now? [Y/n] " OPEN_BROWSER
  if [[ "${OPEN_BROWSER:-Y}" =~ ^[Yy]$ ]]; then
    open "$HOST/dashboard"
  fi
fi

# ── Keep server alive until user quits ────────────────────────────────────────
echo
echo "${BOLD}Server is running. Press Ctrl+C to stop.${RESET}"
echo "  Logs → /tmp/agent-prism-demo.log"
echo
wait "$SERVER_PID" 2>/dev/null || true
