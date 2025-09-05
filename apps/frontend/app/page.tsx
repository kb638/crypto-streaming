"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { PriceService } from "@pluto/api/gen/market/v1/price_pb";

type Row = {
  ticker: string;
  price?: number;
  status: "connecting" | "ok" | "error" | "reconnecting";
  flash?: "up" | "down";
};

export default function Page() {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<Record<string, Row>>({});
  const backoffs = useRef<Record<string, number>>({}); // per-ticker backoff (ms)

  const client = useMemo(() => {
    const transport = createConnectTransport({ baseUrl: "http://localhost:8080" });
    return createClient(PriceService, transport);
  }, []);

  const addTicker = (raw: string) => {
    const t = raw.trim().toUpperCase();
    if (!t) return;
    setRows((prev) => (prev[t] ? prev : { ...prev, [t]: { ticker: t, status: "connecting" } }));
    setInput("");
  };

  const removeTicker = (t: string) => {
    setRows((prev) => {
      const { [t]: _, ...rest } = prev;
      return rest;
    });
  };

  // subscribe with reconnect
  useEffect(() => {
    const aborts: AbortController[] = [];
    const keys = Object.keys(rows);

    const run = async (t: string) => {
      const ac = new AbortController();
      aborts.push(ac);

      let attempt = 0;
      const nextDelay = () => {
        const base = backoffs.current[t] ?? 500; // start 500ms
        const next = Math.min(base * 2, 8000);   // cap 8s
        backoffs.current[t] = next;
        return base;
      };
      backoffs.current[t] ||= 500;

      while (!ac.signal.aborted && rows[t]) {
        try {
          setRows((prev) => ({ ...prev, [t]: { ...(prev[t] ?? { ticker: t }), status: attempt ? "reconnecting" : "connecting" } }));
          const stream = client.streamPrices({ ticker: t }, { signal: ac.signal });
          // reset backoff on successful connect
          backoffs.current[t] = 500;
          attempt++;

          for await (const msg of stream) {
            setRows((prev) => {
              const old = prev[t];
              if (!old) return prev;
              const flash: Row["flash"] =
                old.price == null ? undefined
                : msg.price > old.price ? "up"
                : msg.price < old.price ? "down"
                : undefined;

              return { ...prev, [t]: { ticker: t, price: msg.price, status: "ok", flash } };
            });

            // clear flash after 300ms
            setTimeout(() => {
              setRows((prev) => {
                const r = prev[t];
                if (!r || !r.flash) return prev;
                return { ...prev, [t]: { ...r, flash: undefined } };
              });
            }, 300);
          }
        } catch (e) {
          console.error(`[ui] ${t} stream error`, e);
          setRows((prev) => ({ ...prev, [t]: { ...(prev[t] ?? { ticker: t }), status: "error" } }));
          if (ac.signal.aborted) break;
          const wait = nextDelay();
          await new Promise((r) => setTimeout(r, wait));
        }
      }
    };

    keys.forEach(run);
    return () => aborts.forEach((a) => a.abort());
  }, [client, Object.keys(rows).join(",")]);

  const sorted = Object.values(rows).sort((a, b) => a.ticker.localeCompare(b.ticker));

  return (
    <main style={{ padding: 24, maxWidth: 680, margin: "0 auto", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 36, fontWeight: 800, marginBottom: 16 }}>Project Pluto — Live Prices</h1>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ticker (e.g. BTCUSD)"
          onKeyDown={(e) => e.key === "Enter" && addTicker(input)}
          style={{ flex: 1, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}
        />
        <button
          onClick={() => addTicker(input)}
          style={{ padding: "12px 18px", borderRadius: 8, border: "1px solid #000", background: "#000", color: "#fff" }}
        >
          Add
        </button>
      </div>

      <div style={{ marginTop: 20, display: "grid", gap: 12 }}>
        {sorted.map((r) => (
          <div
            key={r.ticker}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: 16,
              boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
              borderRadius: 12,
              border: r.status === "error" ? "1px solid #e33" : "1px solid transparent",
              background:
                r.flash === "up" ? "rgba(0,200,0,0.08)" :
                r.flash === "down" ? "rgba(200,0,0,0.08)" :
                "#fff",
              transition: "background 150ms ease",
            }}
          >
            <strong>{r.ticker}</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span>
                {r.status === "connecting" || r.status === "reconnecting" ? "…" :
                 r.status === "error" ? "error" :
                 r.price?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? "—"}
              </span>
              <button onClick={() => removeTicker(r.ticker)} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer" }}>
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
