import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PREFIX = "enc:v1:";

/**
 * Derive a 32-byte key from the ENCRYPTION_KEY env var.
 * Accepts a 64-char hex string (preferred) or any string (SHA-256 hashed).
 * Returns null if the env var is not set — callers must handle this.
 */
function getKey() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  // Non-hex: hash it to get a stable 32-byte key
  return createHash("sha256").update(raw).digest();
}

/**
 * Encrypt a plaintext string.
 * Returns "enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>" or the original
 * string if ENCRYPTION_KEY is not configured.
 */
export function encrypt(plaintext) {
  if (typeof plaintext !== "string" || plaintext === "") return plaintext;
  if (plaintext.startsWith(PREFIX)) return plaintext; // already encrypted

  const key = getKey();
  if (!key) return plaintext; // no key configured — pass through (dev only)

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a value previously encrypted with encrypt().
 * Passes through plaintext values (backward compatibility with un-migrated rows).
 * Throws if the ciphertext is tampered (GCM auth tag mismatch).
 */
export function decrypt(value) {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return value; // plaintext or null

  const key = getKey();
  if (!key) {
    throw new Error("ENCRYPTION_KEY is required to decrypt connector credentials. Set it in your environment.");
  }

  const rest = value.slice(PREFIX.length);
  const parts = rest.split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted value");

  const iv = Buffer.from(parts[0], "hex");
  const tag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");

  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Encrypt all sensitive fields in a connector config object.
 * Returns a new config object — does not mutate the input.
 */
export function encryptConnectorConfig(config) {
  if (!config || typeof config !== "object") return config;
  const out = { ...config };
  if (out.apiKey) out.apiKey = encrypt(out.apiKey);
  return out;
}

/**
 * Decrypt all sensitive fields in a connector config object.
 * Returns a new config object — does not mutate the input.
 */
export function decryptConnectorConfig(config) {
  if (!config || typeof config !== "object") return config;
  const out = { ...config };
  if (out.apiKey) out.apiKey = decrypt(out.apiKey);
  return out;
}

/**
 * Returns true if ENCRYPTION_KEY is set and valid.
 */
export function isEncryptionConfigured() {
  return getKey() !== null;
}
