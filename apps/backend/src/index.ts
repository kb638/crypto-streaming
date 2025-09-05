// apps/backend/src/index.ts
import http from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import routes from "./connect.js";
import { cfg } from "./config.js";
import { shutdownBrowser, getMetrics } from "./play.js";

// Build the Connect handler once
const handler = connectNodeAdapter({ routes });

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", cfg.origin);
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Connect-Protocol-Version, Connect-Timeout-Ms, Connect-Content-Encoding, Connect-Accept-Encoding"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Connect-Content-Encoding, Connect-Accept-Encoding"
  );

  // Preflight
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Health (two paths, both ok)
  if (req.method === "GET" && (req.url === "/healthz" || req.url === "/health")) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: true, status: "ok", service: "backend" }));
    return;
  }

  // Metrics
  if (req.method === "GET" && req.url === "/metrics") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(getMetrics(), null, 2));
    return;
  }

  // ConnectRPC
  try {
    await handler(req, res);
  } catch (e) {
    console.error("[backend] request error", e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    res.end("internal error");
  }
});

server.listen(cfg.port, () => {
  console.log(`[backend] listening on http://localhost:${cfg.port}`);
  console.log(`[backend] ConnectRPC mounted`);
});

// Graceful shutdown
function attachShutdown() {
  const tidy = async (signal: string) => {
    try {
      console.log(`[backend] received ${signal}, shutting down…`);
      await shutdownBrowser();
      process.exit(0);
    } catch (e) {
      console.error("[backend] shutdown error", e);
      process.exit(1);
    }
  };
  process.on("SIGINT", () => tidy("SIGINT"));
  process.on("SIGTERM", () => tidy("SIGTERM"));
}
attachShutdown();
