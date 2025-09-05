// apps/backend/src/connect.ts
import type { ConnectRouter } from "@connectrpc/connect";

// Services come from *_pb.ts (protoc-gen-es v2)
import { HealthService } from "../../../packages/api/gen/health/v1/health_pb.js";
import { PriceService } from "../../../packages/api/gen/market/v1/price_pb.js";

import { acquireTicker, releaseTicker } from "./play.js";

/**
 * Basic ticker validation:
 * - Uppercase letters/numbers only
 * - Length 3..15 
 */
function validateTicker(raw: string | undefined): string {
  const t = (raw ?? "").toUpperCase().trim();
  if (!/^[A-Z0-9]{3,15}$/.test(t)) {
    throw new Error("invalid ticker format");
  }
  return t;
}

export default function routes(router: ConnectRouter) {
  // Unary health check
  router.service(HealthService, {
    async check() {
      return { status: "ok(connect)" };
    },
  });

  // Server-streaming prices
  router.service(PriceService, {
    // Note: include ctx so we can react to client aborts
    async *streamPrices(req, ctx) {
      const ticker = validateTicker(req.ticker);
      console.log("[stream] start", ticker);

      const session = await acquireTicker(ticker);

      // event queue & listeners
      const queue: number[] = [];
      const onUpdate = (p: number) => queue.push(p);
      const onPageErr = (e: string) =>
        console.error(`[stream][${ticker}] pageerror:`, e);

      session.emitter.on("update", onUpdate);
      session.emitter.on("pageerror", onPageErr);

      // Throttle
      const MIN_GAP_MS = 200;
      let lastSent = 0;

      try {
        while (!ctx.signal.aborted) {
          // flush queue (send newest values, at most every MIN_GAP_MS)
          while (queue.length) {
            const price = queue.pop()!; // take the latest
            const now = Date.now();
            if (now - lastSent < MIN_GAP_MS) break;
            lastSent = now;

            // PriceUpdate { ticker, price, ts_ms }
            const msg = { ticker, price, ts_ms: now };
            // console.log("[rpc] yield", msg);
            yield msg;
          }

          // small idle wait
          await new Promise((r) => setTimeout(r, 80));
        }
      } finally {
        session.emitter.off("update", onUpdate);
        session.emitter.off("pageerror", onPageErr);
        await releaseTicker(ticker);
        console.log("[stream] end", ticker);
      }
    },
  });
}
