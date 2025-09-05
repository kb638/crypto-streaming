"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { PriceService } from "@pluto/api/gen/market/v1/price_pb"; // via transpilePackages

const TICKERS = ["BTCUSD", "ETHUSD", "SOLUSD"].sort(); // UI must be alphabetically sorted

export default function Page() {
  const [ticker, setTicker] = useState(TICKERS[0]);
  const [price, setPrice]   = useState<number | null>(null);
  const [log, setLog]       = useState<string[]>([]);

  const client = useMemo(() => {
    const transport = createConnectTransport({ baseUrl: "http://localhost:8080" });
    return createClient(PriceService, transport);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setPrice(null);
    setLog((old) => [`[ui] subscribe ${ticker}`, ...old].slice(0, 50));

    (async () => {
      try {
        const stream = client.streamPrices({ ticker });
        for await (const msg of stream) {
          if (cancelled) break;
          setPrice(msg.price);
        }
      } catch (e: any) {
        console.error(e);
        setLog((old) => [`[error] ${String(e)}`, ...old].slice(0, 50));
      }
    })();

    return () => { cancelled = true; };
  }, [ticker, client]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", lineHeight: 1.4 }}>
      <h1>Project Pluto — Live Prices</h1>

      <label>
        Ticker:&nbsp;
        <select value={ticker} onChange={(e) => setTicker(e.target.value)}>
          {TICKERS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>

      <div style={{ marginTop: 16, fontSize: 24 }}>
        {price == null ? "Connecting…" : `${ticker}: ${price}`}
      </div>

      <details style={{ marginTop: 24 }}>
        <summary>Logs</summary>
        <pre>{log.join("\n")}</pre>
      </details>
    </main>
  );
}
