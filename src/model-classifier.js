// Task type detection and model fitness scoring for prompt advisory

const TASK_PATTERNS = {
  code: [
    /```[\w]*\n[\s\S]+?```/,
    /\b(function|class|def|import|const|let|var|public|private|async|await|return)\b/,
    /\b(debug|fix|implement|refactor|write a function|unit test|code review|pull request|diff|error|exception|stack trace)\b/i,
    /\.(js|ts|py|go|rs|java|cpp|cs|rb|php)\b/
  ],
  reasoning: [
    /\b(analyze|analyse|compare|evaluate|assess|critique|reason|explain why|how does|what are the implications|trade.?off|pros and cons|should I|recommend)\b/i,
    /\b(multi.?step|chain of thought|step by step|think through|walk me through)\b/i
  ],
  summarization: [
    /\b(summarize|summarise|tldr|tl;dr|key points|brief|overview|condense|extract the main|what does this say)\b/i,
    /\b(meeting notes|transcript|article|document|report|paper)\b.*\b(summary|summarize|key|points)\b/i
  ],
  creative: [
    /\b(write a story|poem|essay|blog post|creative|fiction|narrative|character|plot|dialogue|screenplay)\b/i,
    /\b(make it funny|make it professional|rewrite|rephrase|tone)\b/i
  ],
  data: [
    /\b(sql|query|database|csv|json|parse|transform|aggregate|pivot|dataframe|pandas|numpy|chart|graph|plot|visualization)\b/i,
    /\b(count|sum|average|group by|filter|join|merge|sort|rank)\b/i
  ],
  multi_tool: [
    /\b(search|browse|fetch|call|execute|run|tool|function call|agent|workflow|pipeline|orchestrate)\b/i
  ],
  simple_qa: [
    /^\s*(what is|who is|when|where|define|what does|how do I spell|translate|convert)\b/i,
    /\?$/
  ]
};

// Model name normalization to tier
function modelTier(model = "") {
  const m = model.toLowerCase();
  if (/haiku|gpt-4o-mini|gpt-4\.1-mini|gpt-3\.5|gemini-flash|mistral-7b/.test(m)) return "fast";
  if (/sonnet|gpt-4o(?!-mini)|gpt-4\.1(?!-mini)|gpt-4-turbo|gemini-pro/.test(m)) return "balanced";
  if (/opus|gpt-4(?!o|\.1|-turbo)|o1|o3|claude-3-opus/.test(m)) return "powerful";
  return "unknown";
}

// Fitness matrix: task → ideal tier
const TASK_IDEAL_TIER = {
  simple_qa:     "fast",
  summarization: "fast",
  creative:      "balanced",
  code:          "balanced",
  data:          "balanced",
  multi_tool:    "balanced",
  reasoning:     "powerful",
  general:       "balanced"
};

// Provider-specific recommended models per tier
const RECOMMENDED_MODELS = {
  anthropic: {
    fast:     "claude-haiku-3-5",
    balanced: "claude-sonnet-3-7",
    powerful: "claude-opus-4"
  },
  openai: {
    fast:     "gpt-4o-mini",
    balanced: "gpt-4o",
    powerful: "o3"
  },
  generic: {
    fast:     "claude-haiku-3-5",
    balanced: "claude-sonnet-3-7",
    powerful: "claude-opus-4"
  }
};

function extractText(messages = []) {
  if (!Array.isArray(messages)) return String(messages || "");
  return messages
    .flatMap(m => {
      if (typeof m.content === "string") return [m.content];
      if (Array.isArray(m.content)) return m.content.map(c => (typeof c === "string" ? c : c.text || ""));
      return [];
    })
    .join(" ");
}

export function classifyTask(messages = [], { toolCount = 0 } = {}) {
  const text = extractText(messages);

  if (toolCount >= 2) return "multi_tool";

  for (const [taskType, patterns] of Object.entries(TASK_PATTERNS)) {
    if (patterns.some(p => p.test(text))) return taskType;
  }
  return "general";
}

export function scoreFitness(model, taskType) {
  const tier = modelTier(model);
  const idealTier = TASK_IDEAL_TIER[taskType] || "balanced";

  const tierOrder = ["fast", "balanced", "powerful", "unknown"];
  const tierIdx = tierOrder.indexOf(tier);
  const idealIdx = tierOrder.indexOf(idealTier);
  const gap = Math.abs(tierIdx - idealIdx);

  if (tier === "unknown") return { fitness: "unknown", penalty: 0 };
  if (gap === 0) return { fitness: "optimal", penalty: 0 };
  if (gap === 1) {
    // Powerful model on a balanced task wastes budget — flag it
    if (tier === "powerful" && idealTier !== "powerful") return { fitness: "suboptimal", penalty: 8 };
    return { fitness: "good", penalty: 5 };
  }

  // gap >= 2: mismatch
  // fast model on complex task = quality risk; powerful model on simple = cost waste
  if (tier === "fast" && idealTier === "powerful") return { fitness: "mismatch", penalty: 20 };
  if (tier === "powerful" && idealTier === "fast") return { fitness: "suboptimal", penalty: 10 };
  return { fitness: "suboptimal", penalty: 10 };
}

export function getModelRecommendation(model, taskType, provider = "anthropic") {
  const { fitness, penalty } = scoreFitness(model, taskType);
  const idealTier = TASK_IDEAL_TIER[taskType] || "balanced";
  const providerKey = RECOMMENDED_MODELS[provider] ? provider : "generic";
  const recommended = RECOMMENDED_MODELS[providerKey][idealTier];

  return { fitness, penalty, recommendedModel: recommended, idealTier };
}

// PII scrub — global patterns covering major markets
const PII_RULES = [
  // Universal
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]"],
  [/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, "[CARD]"],
  [/\bsk-[A-Za-z0-9]{20,}\b/g, "[API_KEY]"],
  [/\bBearer [A-Za-z0-9._-]{10,}\b/g, "Bearer [TOKEN]"],
  // Payments / banking
  [/\b[a-zA-Z0-9._-]{2,}@[a-zA-Z]{2,}\b/g, "[PAYMENT_ID]"],  // UPI, PIX-style, Venmo handles
  [/\b[A-Z]{2}\d{2}[A-Z0-9]{1,30}\b/g, "[IBAN]"],
  // US
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN]"],
  [/\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g, "[PHONE]"],
  // UK
  [/\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g, "[NIN]"],          // National Insurance Number
  [/\b(?:\+44|0)[\s-]?(?:\d[\s-]?){9,10}\b/g, "[PHONE]"],
  // Canada
  [/\b\d{3}[-\s]\d{3}[-\s]\d{3}\b/g, "[SIN]"],               // Social Insurance Number
  // Australia
  [/\b\d{3}[\s-]\d{3}[\s-]\d{3}\b/g, "[TFN]"],               // Tax File Number
  // Singapore
  [/\b[STFG]\d{7}[A-Z]\b/g, "[NRIC]"],
  // India
  [/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[AADHAAR]"],
  [/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, "[PAN]"],
  [/(?:\+91|0)[-\s]?[6-9]\d{9}\b/g, "[PHONE]"],
  [/\b[6-9]\d{9}\b/g, "[PHONE]"],
  // Generic international mobile: +CC followed by 7-12 digits
  [/\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,5}[-.\s]?\d{4,9}\b/g, "[PHONE]"]
];

export function scrubPii(messages = []) {
  if (!Array.isArray(messages)) return messages;
  return messages.map(msg => {
    let content = msg.content;
    if (typeof content === "string") {
      for (const [pattern, replacement] of PII_RULES) {
        content = content.replace(pattern, replacement);
      }
      return { ...msg, content };
    }
    if (Array.isArray(content)) {
      content = content.map(block => {
        if (block.type === "text" && typeof block.text === "string") {
          let text = block.text;
          for (const [pattern, replacement] of PII_RULES) {
            text = text.replace(pattern, replacement);
          }
          return { ...block, text };
        }
        return block;
      });
      return { ...msg, content };
    }
    return msg;
  });
}
