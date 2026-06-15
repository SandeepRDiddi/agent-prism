const DEFAULT_TIMEOUT = process.env.NODE_ENV === "production" ? "30000" : "10000";
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || DEFAULT_TIMEOUT, 10);

/**
 * Register SIGTERM and SIGINT handlers for graceful shutdown.
 * Stops accepting new connections, drains in-flight requests, then exits.
 * Default timeout: 30s in production (allows slow DB queries to finish), 10s in dev.
 */
export function setupGracefulShutdown(server, tracker) {
  function shutdown(signal) {
    process.stderr.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "info",
        message: `${signal} received — graceful shutdown started`,
        timeoutMs: SHUTDOWN_TIMEOUT_MS
      }) + "\n"
    );

    server.close(() => {
      process.stderr.write(
        JSON.stringify({ ts: new Date().toISOString(), level: "info", message: "Server closed cleanly" }) + "\n"
      );
      process.exit(0);
    });

    const forceExit = setTimeout(() => {
      const remaining = tracker.getInflight();
      process.stderr.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          message: `Shutdown timeout exceeded with ${remaining} in-flight requests — forcing exit`,
          timeoutMs: SHUTDOWN_TIMEOUT_MS,
          inflightRequests: remaining
        }) + "\n"
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    if (forceExit.unref) forceExit.unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}
