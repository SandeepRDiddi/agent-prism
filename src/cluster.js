import cluster from "node:cluster";
import os from "node:os";

const WORKERS = Number(process.env.CLUSTER_WORKERS || os.cpus().length);

if (cluster.isPrimary) {
  process.stderr.write(`[cluster] Primary ${process.pid} — forking ${WORKERS} workers\n`);

  for (let i = 0; i < WORKERS; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    process.stderr.write(
      `[cluster] Worker ${worker.process.pid} exited (${signal || code}) — restarting\n`
    );
    cluster.fork();
  });

  cluster.on("online", (worker) => {
    process.stderr.write(`[cluster] Worker ${worker.process.pid} online\n`);
  });
} else {
  await import("../server.js");
}
