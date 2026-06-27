/**
 * Tool danger classification.
 *
 * Each rule is matched against the tool name (case-insensitive).
 * Rules are ordered highest→lowest danger; first match wins.
 * Unknown tools fall through to 'unclassified' at level 2.
 */

const RULES = [
  // ── Tier 4 — Critical ─────────────────────────────────────────────────────
  {
    patterns: [/privilege.?esc/i, /assume.?role/i, /\bescalat/i, /\bsudo\b/i, /\bsu\b(?!bscri)/i],
    category: "privilege-esc", level: 4, requiresHitl: true
  },
  {
    patterns: [/terraform.*(destroy|apply)/i, /infra.*destroy/i, /destroy.*resource/i,
               /scale.?down.*infra/i, /provision.*cloud/i, /delete.*cluster/i],
    category: "infra-mutate", level: 4, requiresHitl: true
  },

  // ── Tier 3 — High ─────────────────────────────────────────────────────────
  {
    patterns: [/\bdrop\b/i, /\btruncate\b/i, /\brm\b.{0,5}\brf\b/i,
               /\bwipe\b/i, /\bpurge\b/i, /bulk.?delete/i,
               /delete.?all\b/i, /delete.?where\b/i],
    category: "destructive", level: 3, requiresHitl: true
  },
  {
    patterns: [/\bexec\b/i, /\bspawn\b/i, /run.?command/i, /shell.?exec/i,
               /subprocess/i, /system.?call/i, /execute.?script/i,
               /\beval\b/i, /os.?execute/i],
    category: "process-exec", level: 3, requiresHitl: true
  },
  {
    patterns: [/get.?secret/i, /read.?credential/i, /vault.?get/i,
               /fetch.?secret/i, /read.?token/i, /get.?api.?key/i,
               /kms.?decrypt/i, /secrets.?manager/i],
    category: "secret-access", level: 3, requiresHitl: true
  },
  {
    patterns: [/update.?all\b/i, /batch.?delete/i, /bulk.?update/i,
               /mass.?update/i, /multi.?delete/i],
    category: "bulk-mutation", level: 3, requiresHitl: true
  },

  // ── Tier 2 — Medium ───────────────────────────────────────────────────────
  {
    patterns: [/\bdelete\b/i, /\bremove\b/i, /\bdestroy\b/i, /\bkill\b/i],
    category: "destructive", level: 2, requiresHitl: true
  },
  {
    patterns: [/send.?email/i, /send.?message/i, /post.?slack/i,
               /send.?webhook/i, /http.?post\b/i, /call.?external/i,
               /push.?notification/i, /send.?sms/i, /post.?to.?api/i],
    category: "external-call", level: 2, requiresHitl: false
  },

  // ── Tier 1 — Low ──────────────────────────────────────────────────────────
  {
    patterns: [/\binsert\b/i, /\bupdate\b/i, /\bput\b/i, /\bpatch\b/i,
               /write.?file/i, /create.?record/i, /save.?to/i,
               /db.?insert/i, /upsert/i, /\bcreate\b/i, /\badd\b/i],
    category: "internal-write", level: 1, requiresHitl: false
  },

  // ── Tier 0 — Read only ────────────────────────────────────────────────────
  {
    patterns: [/\bselect\b/i, /\bget\b/i, /\blist\b/i, /\bfetch\b/i,
               /\bdescribe\b/i, /read.?file/i, /\bsearch\b/i,
               /\bquery\b/i, /\bfind\b/i, /\blookup\b/i,
               /\bwatch\b/i, /\bmonitor\b/i, /\bcheck\b/i],
    category: "read", level: 0, requiresHitl: false
  }
];

const LEVEL_WEIGHTS = [0, 5, 15, 35, 75];

/**
 * Classify a single tool by name.
 * If the caller already provided dangerCategory + dangerLevel, those are trusted.
 */
export function classifyTool(tool) {
  const name = typeof tool === "string" ? tool : (tool.name || "");

  // Caller-supplied classification — trust it but still compute requiresHitl
  if (tool && typeof tool === "object" && tool.dangerCategory && tool.dangerLevel !== undefined) {
    return {
      name,
      type: tool.type || "function",
      dangerCategory: tool.dangerCategory,
      dangerLevel: tool.dangerLevel,
      requiresHitl: tool.requiresHitl ?? tool.dangerLevel >= 2
    };
  }

  // Normalize underscore/hyphen-delimited names so \b word boundaries work correctly
  // e.g. "exec_shell" → "exec shell", "delete-records" → "delete records"
  const normalized = name.replace(/[_-]/g, " ");

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) {
        return {
          name,
          type: (tool && tool.type) || "function",
          dangerCategory: rule.category,
          dangerLevel: rule.level,
          requiresHitl: rule.requiresHitl
        };
      }
    }
  }

  // Unknown — treat as unclassified medium risk until admin reviews
  return {
    name,
    type: (tool && tool.type) || "function",
    dangerCategory: "unclassified",
    dangerLevel: 2,
    requiresHitl: false
  };
}

/**
 * Classify a full tool manifest and produce aggregate metrics.
 *
 * @param {Array<string|{name,type?,dangerCategory?,dangerLevel?,requiresHitl?}>} manifest
 * @returns {{
 *   classifiedTools: Array,
 *   dangerScore: number,     // 0–100
 *   agentTier: number,       // 0–4
 *   maxDangerLevel: number,
 *   requiresHitl: boolean,
 *   dangerFlags: Array       // tools with level >= 2
 * }}
 */
export function classifyManifest(manifest = []) {
  if (!Array.isArray(manifest) || manifest.length === 0) {
    return { classifiedTools: [], dangerScore: 0, agentTier: 0, maxDangerLevel: 0, requiresHitl: false, dangerFlags: [] };
  }

  const classifiedTools = manifest.map(classifyTool);

  const maxDangerLevel = Math.max(0, ...classifiedTools.map((t) => t.dangerLevel));
  const rawScore = classifiedTools.reduce((sum, t) => sum + (LEVEL_WEIGHTS[t.dangerLevel] ?? 0), 0);
  const dangerScore = Math.min(100, rawScore);
  const agentTier = maxDangerLevel; // tier == max danger level (0-4)
  const requiresHitl = classifiedTools.some((t) => t.requiresHitl);
  const dangerFlags = classifiedTools.filter((t) => t.dangerLevel >= 2);

  return { classifiedTools, dangerScore, agentTier, maxDangerLevel, requiresHitl, dangerFlags };
}

/**
 * Map tool type string to a canonical agent type.
 * Inferred from the dominant tool category in the manifest.
 */
export function inferAgentType(classifiedTools = []) {
  const counts = {};
  for (const t of classifiedTools) {
    const cat = t.dangerCategory;
    counts[cat] = (counts[cat] || 0) + 1;
  }

  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];

  const TYPE_MAP = {
    "read":           "observer",
    "internal-write": "data-processor",
    "external-call":  "comms-agent",
    "destructive":    "ops-agent",
    "process-exec":   "ops-agent",
    "secret-access":  "ops-agent",
    "bulk-mutation":  "data-processor",
    "infra-mutate":   "infra-agent",
    "privilege-esc":  "infra-agent",
    "unclassified":   "custom"
  };

  return TYPE_MAP[dominant] || "custom";
}
