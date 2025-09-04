"use client";

import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { HealthService } from "../../../packages/api/gen/health/v1/health_pb";

const transport = createConnectTransport({ baseUrl: "http://localhost:8080" });
const client = createClient(HealthService, transport);

export default async function Page() {
  const res = await client.check({}); // typed request/response
  return <pre>Backend (ConnectRPC) health: {res.status}</pre>;
}
