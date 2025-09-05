import http from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import routes from "./connect.js";

const PORT = Number(process.env.PORT ?? 8080);

const server = http.createServer((req, res) => {
  // --- CORS for Connect-Web ---
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000"); // or "*"
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "Connect-Protocol-Version",
      "Connect-Timeout-Ms",
      "Connect-Content-Encoding",
      "Connect-Accept-Encoding",
    ].join(", ")
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Connect-Content-Encoding, Connect-Accept-Encoding"
  );

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // simple rest health (optional)
  if (req.method === "GET" && req.url === "/health") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ status: "ok", service: "backend" }));
    return;
  }

  // Connect routes
  return connectNodeAdapter({ routes })(req, res);
});

server.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
  console.log(`[backend] ConnectRPC mounted`);
});

// Graceful shutdown
const stop = async (signal: string) => {
  console.log(`[backend] ${signal} received, shutting down…`);
  try {
    server.close(() => console.log("[backend] HTTP server closed"));
  } catch {}
  try {
    const { shutdownBrowser } = await import("./play.js");
    await shutdownBrowser();
  } catch {}
  process.exit(0);
};

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
