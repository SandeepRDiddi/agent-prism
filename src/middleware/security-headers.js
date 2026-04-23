const isProduction = process.env.NODE_ENV === "production";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'"
  ].join("; ")
};

// Only sent in production — prevents breaking local HTTP dev
const HSTS_HEADER = "max-age=63072000; includeSubDomains";

/**
 * Set HTTP security headers on a response object.
 * Must be called before res.writeHead() or res.setHeader().
 * @param {import("node:http").ServerResponse} res
 */
export function setSecurityHeaders(res) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    res.setHeader(key, value);
  }
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", HSTS_HEADER);
  }
}
