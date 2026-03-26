import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

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

export function createId(prefix) {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}
