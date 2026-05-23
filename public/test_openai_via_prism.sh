#!/usr/bin/env bash
# Routes OpenAI calls THROUGH Agent Prism so both providers appear in the dashboard.
#
# Usage:
#   export PRISM_KEY="acp_your_key_here"
#   bash test_openai_via_prism.sh

set -euo pipefail

PRISM_URL="${PRISM_URL:-https://agent-prism.onrender.com}"
OPENAI_MODEL="${OPENAI_MODEL:-gpt-4.1-mini}"
PRISM_KEY="${PRISM_KEY:-}"

if [[ -z "${PRISM_KEY}" ]]; then
  echo "PRISM_KEY is not set. Export your Agent Prism API key before running." >&2
  exit 1
fi

run_request() {
  local index="$1"
  local label="$2"
  local max_tokens="$3"
  local prompt="$4"
  local payload response response_body http_status

  echo "[${index}/4] ${label}..."

  payload="$(python3 - "${OPENAI_MODEL}" "${max_tokens}" "${prompt}" <<'PY'
import json, sys
model, max_tokens, prompt = sys.argv[1], int(sys.argv[2]), sys.argv[3]
print(json.dumps({"model": model, "max_tokens": max_tokens,
                  "messages": [{"role": "user", "content": prompt}]}))
PY
)"

  # Key difference: URL = Agent Prism, Auth = PRISM_KEY (not OpenAI key directly)
  response="$(curl -sS -w $'\n%{http_code}' -X POST "${PRISM_URL}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${PRISM_KEY}" \
    --data "${payload}")"
  response_body="${response%$'\n'*}"
  http_status="${response##*$'\n'}"

  if [[ ! "${http_status}" =~ ^2 ]]; then
    echo "  HTTP ${http_status}" >&2
    printf '  %s\n' "${response_body}" >&2
    return 1
  fi

  python3 - "${response_body}" <<'PY'
import json, sys
data = json.loads(sys.argv[1])
if "error" in data:
    print(f"  error: {data['error']}", file=sys.stderr); sys.exit(1)
usage = data.get("usage", {})
text = ""
choices = data.get("choices") or []
if choices:
    text = (choices[0].get("message") or {}).get("content", "")
print(f"  tokens in={usage.get('prompt_tokens',0)} out={usage.get('completion_tokens',0)}")
print(f"  response: {text.replace(chr(10),' ')[:80]}")
PY
  echo
}

echo "Sending 4 OpenAI runs through Agent Prism → /v1/chat/completions proxy..."
echo

run_request 1 "Quick task"        100  "Say hello in exactly one sentence."
run_request 2 "Heavy context run" 500  "You are a senior Python engineer doing a full code review. Here is the full repository context, all configuration files, all test files, all documentation, and all related PRs from the past 6 months. The repository has 47 microservices, each with their own database schemas. The main service handles authentication, payment processing, user management, notification delivery, analytics, reporting, audit logging, and compliance checks. Please review this 3-line helper function that formats a date string: def fmt(d): return d.strftime(\"%Y-%m-%d\"). Is this function correct?"
run_request 3 "Code review task"  400  "Review this Python function for bugs and edge cases:\n\ndef divide_list(items, chunk_size):\n    return [items[i:i+chunk_size] for i in range(0, len(items), chunk_size)]\n\nBe specific. List findings by severity."
run_request 4 "Verbose output run" 800 "Explain in exhaustive detail, with examples, edge cases, historical context, and best practices, what a Python list is."

echo "Done. Open Agent Prism → Governance tab for head-to-head comparison."
echo "${PRISM_URL}"
