// apps/backend/src/play.ts
import { chromium, Browser, Page } from "playwright";
import { EventEmitter } from "node:events";
import { cfg } from "./config.js";

type Session = {
  page: Page;
  emitter: EventEmitter;    // emits "update" (number) and "pageerror" (string)
  refCount: number;
  lastPrice?: number;
};

// --- browser lifecycle (race-proof) ---
let browser: Browser | null = null;
let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser) return browser;
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: cfg.headless }).then((b) => {
      browser = b;
      console.log(`[playwright] launched chromium (headless=${cfg.headless})`);
      return b;
    });
  }
  return browserPromise;
}

// --- session + LRU management ---
const sessions = new Map<string, Session>();           // active sessions by TICKER (UPPER)
const pendingSession = new Map<string, Promise<Session>>(); // coalesce concurrent creates
const openOrder: string[] = [];                         // LRU-ish order for eviction

const metrics = {
  sessionsOpen: 0,
  sessionsTotalCreated: 0,
  lastError: "" as string | undefined,
};

function touch(key: string) {
  const i = openOrder.indexOf(key);
  if (i >= 0) openOrder.splice(i, 1);
  openOrder.push(key);
}

async function evictIfNeeded() {
  while (openOrder.length > cfg.maxSessions) {
    const victim = openOrder.shift()!;
    const s = sessions.get(victim);
    if (s && s.refCount === 0) {
      console.log(`[session] evicting ${victim}`);
      try { await s.page.close(); } catch {}
      sessions.delete(victim);
    }
  }
  metrics.sessionsOpen = sessions.size;
}

// --- navigation helper with retry ---
async function navigateWithRetries(page: Page, url: string) {
  const attempts = [cfg.navTimeoutMs, cfg.navTimeoutMs]; // two tries
  for (let i = 0; i < attempts.length; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: attempts[i] });
      return;
    } catch (e) {
      console.warn(`[playwright] nav attempt ${i + 1} failed:`, e);
      metrics.lastError = String(e);
      if (i === attempts.length - 1) throw e;
    }
  }
}

// --- core: start a new Playwright page and wire scraper ---
async function startWatching(ticker: string): Promise<Session> {
  const url = `https://www.tradingview.com/symbols/${ticker}/?exchange=BINANCE`;
  const br = await getBrowser();
  const page = await br.newPage({
    userAgent: "Mozilla/5.0 (compatible; PlutoScraper/1.0; +https://localhost)",
    viewport: { width: 1280, height: 900 },
  });

  const emitter = new EventEmitter();

  // Avoid Node crash on 'error' without listener
  emitter.on("error", (err) => {
    console.error(`[emitter ${ticker}] unhandled error:`, err);
  });

  page.on("console", (msg) =>
    console.log(`[page ${ticker}]`, msg.type(), msg.text())
  );
  page.on("pageerror", (e) => {
    console.error(`[page ${ticker}] pageerror:`, (e as any)?.message || e);
    emitter.emit("pageerror", String((e as any)?.message || e));
  });

  console.log("[playwright] navigating:", url);
  await navigateWithRetries(page, url);
  console.log("[playwright] title:", await page.title());

  // Try to dismiss consent quickly (best-effort)
  const consentSelectors = [
    'button:has-text("Accept All")',
    'button:has-text("Accept all")',
    'button:has-text("I Accept")',
    'button:has-text("OK")',
  ];
  for (const sel of consentSelectors) {
    try {
      const btn = await page.locator(sel).first();
      if (await btn.isVisible({ timeout: 800 })) {
        console.log(`[playwright] clicking consent button: ${sel}`);
        await btn.click({ timeout: 1500 });
        break;
      }
    } catch { /* ignore */ }
  }

  // Bridge: page -> node
  await page.exposeFunction("__pushPriceToNode", (raw: any) => {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      console.log(`[scrape] pushed ${ticker}:`, n);
      emitter.emit("update", n);
    }
  });

  // Inject scraper – fully isolated in a fresh Function scope to avoid TradingView "__name" collisions
  await page.evaluate(() => {
    console.log("[scrape] injected scraper running");

    try {
      const code = `
        (function runScraper(){
          const log = (...a) => console.log("[scrape]", ...a);

          const parseNum = (txt) => {
            if (!txt) return null;
            const cleaned = txt.replace(/[\\,\\s]/g, "");
            const m = cleaned.match(/[-+]?\\d+(\\.\\d+)?/);
            if (!m) return null;
            const n = Number(m[0]);
            return Number.isFinite(n) ? n : null;
          };

          // Prefer known selectors, but fall back to best visible numeric candidate
          const preferred = [
            ".tv-symbol-price-quote__value",
            "[data-name='price']",
            "[data-last-price]",
            "span[data-symbol-price]"
          ];

          // 1) Try preferred selectors
          for (const sel of preferred) {
            const el = document.querySelector(sel);
            log("check preferred", sel, el?.textContent);
            if (el && /\\d/.test(el.textContent ?? "")) {
              const v0 = parseNum(el.textContent);
              if (v0 != null) {
                log("initial push", v0);
                window.__pushPriceToNode(v0);
              }
              const mo = new MutationObserver(() => {
                const v = parseNum(el.textContent);
                if (v != null) {
                  log("mutation push", v);
                  window.__pushPriceToNode(v);
                }
              });
              mo.observe(el, { childList: true, subtree: true, characterData: true });
              log("observer attached");
              return;
            }
          }

          // 2) Heuristic: pick a visible element with lots of digits
          const all = Array.from(document.querySelectorAll("body *"))
            .filter(n => n instanceof HTMLElement) ;

          let best = null;
          for (const el of all) {
            const style = window.getComputedStyle(el);
            if (style.visibility === "hidden" || style.display === "none") continue;
            const text = el.textContent?.trim() ?? "";
            if (!/\\d/.test(text)) continue;

            // score: count of digits; prefer larger fonts
            const digits = (text.match(/\\d/g) || []).length;
            const size = parseFloat(style.fontSize || "0");
            const score = digits + (size / 10);

            if (!best || score > best.score) {
              best = { score, el, text };
            }
          }

          if (best && best.el) {
            const path = [];
            let cur = best.el;
            while (cur && path.length < 4) { // small path for logging
              const id = cur.id ? \`#\${cur.id}\` : "";
              const cls = cur.className && typeof cur.className === "string"
                ? "." + cur.className.split(/\\s+/).slice(0,2).join(".")
                : "";
              path.unshift(\`\${cur.tagName.toLowerCase()}\${id}\${cls}\`);
              cur = cur.parentElement;
            }
            log("picked candidate", { score: best.score, path: path.join(" > "), text: best.text?.slice(0,40) });

            const v0 = parseNum(best.el.textContent);
            if (v0 != null) {
              log("initial push", v0);
              window.__pushPriceToNode(v0);
            }
            const mo = new MutationObserver(() => {
              const v = parseNum(best.el.textContent);
              if (v != null) {
                log("mutation push", v);
                window.__pushPriceToNode(v);
              }
            });
            mo.observe(best.el, { childList: true, subtree: true, characterData: true });
            log("observer attached");
            return;
          }

          // 3) Last resort: poll body text
          log("no element found — fallback polling");
          setInterval(() => {
            try {
              const text = document.body?.innerText ?? "";
              const v = parseNum(text);
              if (v != null) {
                log("polling push", v);
                window.__pushPriceToNode(v);
              }
            } catch (err) {
              log("polling error", err);
            }
          }, 1000);
        })();
      `;

      // Run the scraper in a fresh scope (avoids TradingView’s injected globals like __name)
      new Function(code)();
    } catch (err) {
      console.error("[scrape] fatal outer error", err);
    }
  });

  const session: Session = { page, emitter, refCount: 0 };
  sessions.set(ticker, session);
  touch(ticker);
  await evictIfNeeded();
  metrics.sessionsOpen = sessions.size;
  metrics.sessionsTotalCreated++;
  return session;
}

// --- public API used by connect.ts ---
export async function acquireTicker(raw: string): Promise<Session> {
  const key = raw.toUpperCase();

  // existing?
  const existing = sessions.get(key);
  if (existing) {
    existing.refCount++;
    touch(key);
    console.log(`[session] ${key} ref++ -> ${existing.refCount}`);
    return existing;
  }

  // coalesce concurrent creates for the same key
  let pending = pendingSession.get(key);
  if (!pending) {
    pending = startWatching(key).finally(() => pendingSession.delete(key));
    pendingSession.set(key, pending);
  }
  const s = await pending;
  s.refCount++;
  touch(key);
  console.log(`[session] ${key} ref++ -> ${s.refCount}`);
  return s;
}

export async function releaseTicker(raw: string): Promise<void> {
  const key = raw.toUpperCase();
  const s = sessions.get(key);
  if (!s) return;
  s.refCount = Math.max(0, s.refCount - 1);
  console.log(`[session] ${key} ref-- -> ${s.refCount}`);
  if (s.refCount === 0) {
    setTimeout(async () => {
      const cur = sessions.get(key);
      if (cur && cur.refCount === 0) {
        console.log(`[session] closing page for ${key}`);
        try { await cur.page.close(); } catch {}
        sessions.delete(key);
        const i = openOrder.indexOf(key);
        if (i >= 0) openOrder.splice(i, 1);
        metrics.sessionsOpen = sessions.size;
      }
    }, 10_000);
  }
}

export async function shutdownBrowser() {
  try {
    for (const [k, s] of sessions) {
      try { await s.page.close(); } catch {}
      sessions.delete(k);
    }
    openOrder.splice(0);
    if (browser) {
      await browser.close();
      browser = null;
      console.log("[playwright] browser closed");
    }
    metrics.sessionsOpen = 0;
  } catch (e) {
    console.error("[playwright] shutdown error", e);
    metrics.lastError = String(e);
  }
}

export function getMetrics() {
  return {
    sessionsOpen: metrics.sessionsOpen,
    sessionsTotalCreated: metrics.sessionsTotalCreated,
    lastError: metrics.lastError,
    maxSessions: cfg.maxSessions,
    headless: cfg.headless,
  };
}
