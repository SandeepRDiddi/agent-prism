import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createApiKey() {
  const secret = randomBytes(24).toString("hex");
  const key = `acp_${secret}`;
  return {
    plainText: key,
    prefix: key.slice(0, 12),
    hash: sha256(key)
  };
}

export function verifyApiKey(plainText, hash) {
  const candidate = Buffer.from(sha256(plainText), "hex");
  const target = Buffer.from(hash, "hex");

  if (candidate.length !== target.length) {
    return false;
  }

  return timingSafeEqual(candidate, target);
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const digest = pbkdf2Sync(String(password), salt, 210000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$210000$${salt}$${digest}`;
}

export function verifyPassword(password, storedHash) {
  if (!password || !storedHash) return false;
  const [scheme, iterationsRaw, salt, expected] = String(storedHash).split("$");
  if (scheme !== "pbkdf2_sha256" || !iterationsRaw || !salt || !expected) return false;
  const iterations = Number(iterationsRaw);
  const candidate = pbkdf2Sync(String(password), salt, iterations, 32, "sha256");
  const target = Buffer.from(expected, "hex");
  return candidate.length === target.length && timingSafeEqual(candidate, target);
}

export function createSessionToken() {
  const secret = randomBytes(32).toString("hex");
  return {
    plainText: `aps_${secret}`,
    hash: sha256(`aps_${secret}`)
  };
}

export function createId(prefix) {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}
