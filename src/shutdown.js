const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || "10000", 10);

/**
 * Register SIGTERM and SIGINT handlers for graceful shutdown.
 * Stops accepting new connections, drains in-flight requests, then exits.
 *
 * @param {import("node:http").Server} server
 * @param {{ getInflight: () => number }} tracker - tracks in-flight request count
 */
export function setupGracefulShutdown(server, tracker) {
  function shutdown(signal) {
    process.stderr.write(`[agent-prism] ${signal} received — starting graceful shutdown\n`);

    // Stop accepting new connections immediately
    server.close(() => {
      process.stderr.write("[agent-prism] Server closed. Exiting cleanly.\n");
      process.exit(0);
    });

    // Force-exit if draining takes too long
    const forceExit = setTimeout(() => {
      const remaining = tracker.getInflight();
      process.stderr.write(
        `[agent-prism] Shutdown timeout (${SHUTDOWN_TIMEOUT_MS}ms) exceeded with ${remaining} in-flight requests. Forcing exit.\n`
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    // Don't keep the event loop alive just for the timer
    if (forceExit.unref) forceExit.unref();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT",  () => shutdown("SIGINT"));
}
