import type { ConnectRouter } from "@connectrpc/connect";
import { HealthService } from "../../../packages/api/gen/health/v1/health_pb.js";
import { PriceService } from "../../../packages/api/gen/market/v1/price_pb.js";
import { acquireTicker, releaseTicker } from "./play.js";

export default function routes(router: ConnectRouter) {
  // keep health
  router.service(HealthService, {
    async check() {
      return { status: "ok(connect)" };
    },
  });

  // streaming prices (server-streaming)
  router.service(PriceService, {
    async *streamPrices(req) {
      const ticker = (req.ticker ?? "").toUpperCase();
      if (!ticker) throw new Error("ticker is required, e.g. BTCUSD");

      console.log("[stream] start", ticker);
      const s = await acquireTicker(ticker);

      const MIN_GAP_MS = 200;
      let lastSent = 0;
      const queue: number[] = [];

      const onUpdate = (p: number) => queue.push(p);
      const onError = (e: string) => console.error(`[stream][${ticker}]`, e);

      s.emitter.on("update", onUpdate);
      s.emitter.on("error", onError);

      try {
        while (true) {
          while (queue.length) {
            const price = queue.pop()!;
            const now = Date.now();
            if (now - lastSent < MIN_GAP_MS) break;
            lastSent = now;
            yield { ticker, price, ts_ms: now };
          }
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        s.emitter.off("update", onUpdate);
        s.emitter.off("error", onError);
        await releaseTicker(ticker);
        console.log("[stream] end", ticker);
      }
    },
  });
}
