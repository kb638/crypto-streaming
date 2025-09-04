"use client";

import { useEffect, useState } from "react";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { HealthService } from "../../../packages/api/gen/health/v1/health_connect.js";

export default function Home() {
  const [status, setStatus] = useState("checking…");

  useEffect(() => {
    const transport = createConnectTransport({ baseUrl: "http://localhost:8080" });
    const client = createClient(HealthService, transport);
    client.check({})
      .then((res) => setStatus(res.status ?? "unknown"))
      .catch((e) => { console.error(e); setStatus("error"); });
  }, []);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Project Pluto — Crypto Stream</h1>
      <p>Backend (ConnectRPC) health: <b>{status}</b></p>
    </main>
  );
}
