import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify a webhook HMAC-SHA256 signature.
 *
 * @param {object} params
 * @param {string} params.secret      - Shared secret from env
 * @param {string} params.rawBody     - Raw request body string
 * @param {string} params.signature   - Signature header value (hex or "sha256=<hex>")
 * @returns {boolean}
 */
export function verifyHmacSignature({ secret, rawBody, signature }) {
  if (!secret || !signature) return false;
  const sig = signature.replace(/^sha256=/, "");
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
