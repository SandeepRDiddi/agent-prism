/**
 * LLM-based task classification — async drop-in over the regex classifier.
 *
 * Uses claude-haiku-4-5-20251001 (~$0.0001/call). Falls back to regex on
 * timeout, error, or when no LLM caller is registered.
 *
 * Integration:
 *   import { setLlmCaller, classifyTaskWithLLM } from "./llm-classifier.js";
 *   setLlmCaller(anthropicClient);
 *   const taskType = await classifyTaskWithLLM(messages, { toolCount });
 */

import { classifyTask as regexClassify } from "../model-classifier.js";

const TASK_TYPES = new Set([
  "code", "reasoning", "summarization", "creative",
  "data", "multi_tool", "simple_qa", "general"
]);

const MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 4000;
const CACHE_MAX = 2000;

const SYSTEM_PROMPT = `You are a task classifier for AI agent runs.
Classify the prompt into exactly one category:
code | reasoning | summarization | creative | data | multi_tool | simple_qa | general

Definitions:
- code: debugging, implementing, refactoring, tests, code review
- reasoning: analysis, evaluation, multi-step logic, trade-offs, root-cause
- summarization: condensing documents, key-point extraction, briefing
- creative: storytelling, essay, tone rewriting, fiction
- data: SQL, transformations, aggregations, parsing structured data
- multi_tool: workflows requiring ≥2 distinct tool calls, orchestration
- simple_qa: short factual question, definition, lookup, translation
- general: none of the above

Respond with ONLY the category name. No punctuation, no explanation.`.trim();

// djb2-style hash for cache keying (no crypto needed)
function hashText(text) {
  let h = 5381;
  const end = Math.min(text.length, 600);
  for (let i = 0; i < end; i++) h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function extractText(messages) {
  if (!Array.isArray(messages)) return String(messages || "").slice(0, 1000);
  return messages
    .slice(0, 4)
    .flatMap(m => {
      if (typeof m.content === "string") return [m.content];
      if (Array.isArray(m.content)) return m.content.map(c => c.text || "");
      return [];
    })
    .join("\n")
    .slice(0, 800);
}

// In-memory LRU-ish cache (insertion-order eviction via Map)
const _cache = new Map();

function cacheGet(key) { return _cache.get(key); }
function cacheSet(key, val) {
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, val);
}

// Registered Anthropic-compatible client function (set by server.js at startup)
let _callAnthropicFn = null;

export function setLlmCaller(fn) {
  _callAnthropicFn = fn;
}

export function getLlmClassifierStatus() {
  return {
    enabled: _callAnthropicFn !== null,
    model: MODEL,
    cacheSize: _cache.size,
    cacheMax: CACHE_MAX
  };
}

/**
 * Classify task type using LLM, with regex fallback.
 * Always resolves — never rejects.
 */
export async function classifyTaskWithLLM(messages, { toolCount = 0 } = {}) {
  // Shortcut: ≥2 tools always means multi_tool (no LLM needed)
  if (toolCount >= 2) return "multi_tool";

  const text = extractText(messages);
  if (!text.trim()) return "general";

  // Check cache first
  const cacheKey = hashText(text);
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // No caller registered — regex fallback
  if (!_callAnthropicFn) return regexClassify(messages, { toolCount });

  try {
    const raw = await Promise.race([
      _callAnthropicFn({
        model: MODEL,
        max_tokens: 12,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }]
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("llm_classify_timeout")), TIMEOUT_MS)
      )
    ]);

    const label = String(raw || "").trim().toLowerCase().replace(/[^a-z_]/g, "");
    const result = TASK_TYPES.has(label) ? label : regexClassify(messages, { toolCount });
    cacheSet(cacheKey, result);
    return result;
  } catch {
    // Timeout or API error — fall back silently
    return regexClassify(messages, { toolCount });
  }
}
