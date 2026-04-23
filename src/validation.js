/**
 * Minimal schema validator. No external dependencies.
 *
 * Schema shape:
 * {
 *   fieldName: {
 *     required?: boolean,
 *     type?: "string" | "number" | "boolean" | "object",
 *     maxLength?: number,   // strings only
 *     minLength?: number,   // strings only
 *     min?: number,         // numbers only
 *     max?: number,         // numbers only
 *     enum?: any[],         // allowed values
 *   }
 * }
 *
 * @param {Record<string, object>} schema
 * @param {object} data
 * @returns {Array<{field: string, message: string}> | null} null = valid
 */
export function validate(schema, data) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];
    const missing = value === undefined || value === null || value === "";

    if (rules.required && missing) {
      errors.push({ field, message: "required" });
      continue;
    }

    if (missing) continue; // optional field not present — skip further checks

    if (rules.type && typeof value !== rules.type) {
      errors.push({ field, message: `must be a ${rules.type}` });
      continue;
    }

    if (rules.type === "string" || typeof value === "string") {
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        errors.push({ field, message: `must be at most ${rules.maxLength} characters` });
      }
      if (rules.minLength !== undefined && value.length < rules.minLength) {
        errors.push({ field, message: `must be at least ${rules.minLength} characters` });
      }
    }

    if (rules.type === "number" || typeof value === "number") {
      if (rules.min !== undefined && value < rules.min) {
        errors.push({ field, message: `must be at least ${rules.min}` });
      }
      if (rules.max !== undefined && value > rules.max) {
        errors.push({ field, message: `must be at most ${rules.max}` });
      }
    }

    if (rules.enum !== undefined && !rules.enum.includes(value)) {
      errors.push({ field, message: `must be one of: ${rules.enum.join(", ")}` });
    }
  }

  return errors.length > 0 ? errors : null;
}

// ── Request schemas ──────────────────────────────────────────────────────────

export const SCHEMAS = {
  createSession: {
    platform: {
      required: true,
      type: "string",
      enum: ["claude", "copilot", "generic"],
    },
    session_id: { type: "string", maxLength: 128 },
    start_time: { type: "string", maxLength: 64 },
  },

  updateSession: {
    status: {
      required: true,
      type: "string",
      enum: ["running", "idle", "completed", "error"],
    },
  },

  ingestUsage: {
    session_id: { required: true, type: "string", maxLength: 128 },
    platform: { type: "string", enum: ["claude", "copilot", "generic"] },
    input_tokens: { type: "number", min: 0 },
    output_tokens: { type: "number", min: 0 },
    seat_hours: { type: "number", min: 0 },
    cost_usd: { type: "number", min: 0 },
  },

  bootstrap: {
    companyName: { required: true, type: "string", minLength: 1, maxLength: 128 },
    adminEmail: { required: true, type: "string", minLength: 3, maxLength: 256 },
    adminName: { type: "string", maxLength: 128 },
  },

  createConnector: {
    provider: { required: true, type: "string", maxLength: 64 },
    name: { required: true, type: "string", maxLength: 128 },
    mode: { required: true, type: "string", enum: ["webhook", "pull"] },
  },

  ingest: {
    source: { type: "string", enum: ["claude", "copilot", "generic"] },
  },
};
