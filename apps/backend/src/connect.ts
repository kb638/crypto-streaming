// apps/backend/src/connect.ts
import type { ConnectRouter } from "@connectrpc/connect";
import { PriceService } from "../../../packages/api/gen/market/v1/price_pb.js";
import { createPriceEmitter, openTickerAndWatch } from "./play.js";

export default function routes(router: ConnectRouter) {
  router.service(PriceService, {
    // server-streaming implementation — method name is lowerCamel from your proto
    async *streamPrices(req) {
      const ticker = (req.ticker ?? "").toUpperCase();
      if (!ticker) throw new Error("ticker is required, e.g. BTCUSD");

      console.log("[stream] start", ticker);

      const emitter = createPriceEmitter();
      await openTickerAndWatch(ticker, emitter);

      const MIN_GAP_MS = 200;
      let lastSent = 0;

      const queue: number[] = [];
      const onUpdate = (p: number) => queue.push(p);
      const onError = (e: string) => console.error("[stream][page error]", e);

      emitter.on("update", onUpdate);
      emitter.on("error", onError);

      try {
        while (true) {
          while (queue.length) {
            const price = queue.pop()!; // latest
            const now = Date.now();
            if (now - lastSent < MIN_GAP_MS) {
              break; // throttle a bit — wait for next loop tick
            }
            lastSent = now;
            yield { ticker, price, ts_ms: now }; // conforms to PriceUpdate
          }
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        emitter.off("update", onUpdate);
        emitter.off("error", onError);
        console.log("[stream] end", ticker);
      }
    },
  });
}
