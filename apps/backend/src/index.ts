import http from "node:http";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import routes from "./connect.js"; // ESM wants explicit .js with NodeNext

const PORT = Number(process.env.PORT ?? 8080);

// Plain REST /health from Phase 1 (keep it for sanity)
const rest = (req: http.IncomingMessage, res: http.ServerResponse) => {
  if (req.method === "GET" && req.url === "/health") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ status: "ok", service: "backend" }));
    return true;
  }
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.statusCode = 204;
    res.end();
    return true;
  }
  return false;
};

const server = http.createServer((req, res) => {
  // allow CORS for dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");

  if (rest(req, res)) return;

  // All other paths go to Connect
  return connectNodeAdapter({ routes })(req, res);
});

server.listen(PORT, () => {
  console.log(`[backend] listening on http://localhost:${PORT}`);
  console.log(`[backend] ConnectRPC mounted`);
});
