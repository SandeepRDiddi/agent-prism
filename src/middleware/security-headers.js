import { randomBytes } from "node:crypto";

const isProduction = process.env.NODE_ENV === "production";

// Only sent in production — prevents breaking local HTTP dev
const HSTS_HEADER = "max-age=63072000; includeSubDomains";

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

export function generateCspNonce() {
  return randomBytes(16).toString("base64");
}

/**
 * Build Content-Security-Policy header value.
 * When nonce is supplied (for HTML responses with inline scripts), removes
 * 'unsafe-inline' from script-src and uses the nonce instead.
 * @param {string} [nonce]
 */
function buildCsp(nonce) {
  const scriptSrc = nonce
    ? `'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`
    : `'self' 'unsafe-inline' https://cdn.jsdelivr.net`;

  return [
    "default-src 'self'",
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com",
    `script-src ${scriptSrc}`,
    "img-src 'self' data:",
    "connect-src 'self'"
  ].join("; ");
}

/**
 * Set HTTP security headers on a response object.
 * Pass nonce for HTML responses that contain inline <script> tags.
 * @param {import("node:http").ServerResponse} res
 * @param {string} [nonce]
 */
export function setSecurityHeaders(res, nonce) {
  for (const [key, value] of Object.entries(BASE_HEADERS)) {
    res.setHeader(key, value);
  }
  res.setHeader("Content-Security-Policy", buildCsp(nonce));
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", HSTS_HEADER);
  }
}
