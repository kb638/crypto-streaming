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

type Metrics = {
  sessionsOpen: number;
  sessionsTotalCreated: number;
  lastError?: string;
  headless?: boolean; // optional; you can remove if you don't want to show headed/headless
};

export default function Page() {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<Record<string, Row>>({});
  const backoffs = useRef<Record<string, number>>({});
  const controllers = useRef<Record<string, AbortController>>({});
  const started = useRef<Record<string, boolean>>({});

  // backend metrics
  const [metrics, setMetrics] = useState<Metrics | null>(null);

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
    // Abort this ticker's stream immediately
    controllers.current[t]?.abort();
    delete controllers.current[t];
    delete started.current[t];

    // Remove from UI
    setRows((prev) => {
      const { [t]: _omit, ...rest } = prev;
      return rest;
    });
  };

  // Subscribe with reconnect, per-ticker
  useEffect(() => {
    const keys = Object.keys(rows);

    const run = async (t: string) => {
      // Guard for Strict Mode double-invoke in dev
      if (started.current[t]) return;
      started.current[t] = true;

      if (controllers.current[t]) return;

      const ac = new AbortController();
      controllers.current[t] = ac;

      let attempt = 0;
      let firstImmediateTried = false;
      const nextDelay = () => {
        if (!firstImmediateTried) { firstImmediateTried = true; return 0; } // immediate retry once
        const base = backoffs.current[t] ?? 500;  // start 500ms
        const next = Math.min(base * 2, 8000);    // cap 8s
        backoffs.current[t] = next;
        return base;
      };
      backoffs.current[t] ||= 500;

      while (!ac.signal.aborted && rows[t]) {
        try {
          setRows((prev) => ({
            ...prev,
            [t]: { ...(prev[t] ?? { ticker: t }), status: attempt ? "reconnecting" : "connecting" },
          }));

          // Start server stream
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
          if (ac.signal.aborted) break; // user removed ticker -> stop
          console.error(`[ui] ${t} stream error`, e);
          setRows((prev) => ({ ...prev, [t]: { ...(prev[t] ?? { ticker: t }), status: "error" } }));
          const wait = nextDelay();
          await new Promise((r) => setTimeout(r, wait));
        }
      }

      // Cleanup for this ticker’s controller
      if (controllers.current[t] === ac) {
        delete controllers.current[t];
      }
    };

    keys.forEach(run);

    // Global cleanup (component unmount): abort all
    return () => {
      Object.values(controllers.current).forEach((ac) => ac.abort());
      controllers.current = {};
      started.current = {};
    };
  }, [client, Object.keys(rows).join(",")]);

  // poll backend /metrics every 5s
  useEffect(() => {
    let timer: any;
    const tick = async () => {
      try {
        const r = await fetch("http://localhost:8080/metrics");
        if (r.ok) {
          const j = (await r.json()) as Metrics;
          setMetrics(j);
        }
      } catch {
        // ignore transient errors
      } finally {
        timer = setTimeout(tick, 5000);
      }
    };
    tick();
    return () => clearTimeout(timer);
  }, []);

  const sorted = Object.values(rows).sort((a, b) => a.ticker.localeCompare(b.ticker));

  return (
    <main style={{ padding: 24, maxWidth: 680, margin: "0 auto", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 36, fontWeight: 800, marginBottom: 16 }}>CoinStream- Live Cryptocurrency Prices</h1>

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
              <button
                onClick={() => removeTicker(r.ticker)}
                style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer" }}
                aria-label={`Remove ${r.ticker}`}
                title={`Remove ${r.ticker}`}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* backend metrics footer (no "max sessions" text) */}
      <div
        style={{
          marginTop: 28,
          padding: "8px 12px",
          borderRadius: 8,
          border: "1px dashed #ddd",
          background: "#fafafa",
          color: "#333",
          fontSize: 13,
          display: "flex",
          gap: 12,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ opacity: 0.8 }}>
          <strong>Backend</strong>{" "}
          <span style={{ opacity: 0.8 }}>
            {metrics?.headless ? "(headless)" : "(headed)"}
          </span>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <span>Sessions open: <strong>{metrics?.sessionsOpen ?? "–"}</strong></span>
          <span>Total pages: <strong>{metrics?.sessionsTotalCreated ?? "–"}</strong></span>
          {metrics?.lastError ? (
            <span title={metrics.lastError} style={{ color: "#b00" }}>
              last error: {(metrics.lastError || "").slice(0, 40)}{(metrics.lastError || "").length > 40 ? "…" : ""}
            </span>
          ) : null}
        </div>
      </div>
    </main>
  );
}
