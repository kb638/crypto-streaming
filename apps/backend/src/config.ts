import "dotenv/config";

function bool(v: string | undefined, def = false) {
  return v === undefined ? def : /^(1|true|yes)$/i.test(v);
}
function int(v: string | undefined, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const cfg = {
  port: int(process.env.PORT, 8080),
  origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  headless: process.env.HEADLESS === "true" ? true : false, // default false (headed)
  maxSessions: Number(process.env.MAX_SESSIONS ?? 6),
  navTimeoutMs: Number(process.env.NAV_TIMEOUT_MS ?? 15000),
};
