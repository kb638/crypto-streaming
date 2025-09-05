// apps/backend/src/play.ts
import { chromium, Browser, Page } from "playwright";
import { EventEmitter } from "node:events";

type Session = {
  page: Page;
  emitter: EventEmitter;  // emits "update" (number) and "error" (string)
  refCount: number;       // how many active RPC streams use this session
  lastPrice?: number;
};

let browser: Browser | null = null;
const sessions = new Map<string, Session>(); // key = TICKER (upper)

// Simple LRU-ish control
const MAX_SESSIONS = 6;
const openOrder: string[] = []; // oldest at index 0

function touch(key: string) {
  const i = openOrder.indexOf(key);
  if (i >= 0) openOrder.splice(i, 1);
  openOrder.push(key);
}

async function evictIfNeeded() {
  while (openOrder.length > MAX_SESSIONS) {
    const victim = openOrder.shift()!;
    const s = sessions.get(victim);
    if (s && s.refCount === 0) {
      console.log(`[session] evicting ${victim}`);
      try { await s.page.close(); } catch {}
      sessions.delete(victim);
    }
  }
}

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: false }); // headed per requirements
    console.log("[playwright] launched chromium (headed)");
  }
  return browser;
}

async function startWatching(ticker: string): Promise<Session> {
  const url = `https://www.tradingview.com/symbols/${ticker}/?exchange=BINANCE`;
  const br = await getBrowser();
  const page = await br.newPage();

  const emitter = new EventEmitter();
  page.on("console", (msg) => console.log(`[page ${ticker}]`, msg.type(), msg.text()));
  page.on("pageerror", (e) => emitter.emit("error", String(e)));

  console.log("[playwright] navigating:", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  console.log("[playwright] title:", await page.title());

  // Bridge page->node
  await page.exposeFunction("__pushPriceToNode", (raw: any) => {
    const n = Number(raw);
    if (Number.isFinite(n)) emitter.emit("update", n);
  });

  // In-page observer
  await page.evaluate(() => {
    // @ts-ignore
    const push = (window as any).__pushPriceToNode as (v: number) => void;

    const trySelectors = (): HTMLElement | null => {
      const candidates = [
        '.tv-symbol-price-quote__value',
        '[data-name="price"]',
        '[data-last-price]',
        'div[class*="price"], span[class*="price"]',
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el && /\d/.test(el.textContent ?? "")) return el;
      }
      return null;
    };

    const parseNum = (txt: string | null | undefined): number | null => {
      if (!txt) return null;
      const cleaned = txt.replace(/[,\s]/g, "");
      const m = cleaned.match(/[-+]?\d+(\.\d+)?/);
      if (!m) return null;
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    };

    const el = trySelectors();
    if (el) {
      const first = parseNum(el.textContent);
      if (first != null) push(first);
      const mo = new MutationObserver(() => {
        const v = parseNum(el.textContent);
        if (v != null) push(v);
      });
      mo.observe(el, { childList: true, subtree: true, characterData: true });
    } else {
      // fallback polling
      const poll = () => {
        const v = parseNum(document.body?.innerText ?? "");
        if (v != null) push(v);
      };
      poll();
      setInterval(poll, 1000);
    }
  });

  const session: Session = { page, emitter, refCount: 0 };
  sessions.set(ticker, session);
  touch(ticker);
  await evictIfNeeded();
  return session;
}

export async function acquireTicker(raw: string): Promise<Session> {
  const key = raw.toUpperCase();
  let s = sessions.get(key);
  if (!s) s = await startWatching(key);
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
    // Grace period to avoid churn if user re-subscribes quickly
    setTimeout(async () => {
      const cur = sessions.get(key);
      if (cur && cur.refCount === 0) {
        console.log(`[session] closing page for ${key}`);
        try { await cur.page.close(); } catch {}
        sessions.delete(key);
        const i = openOrder.indexOf(key);
        if (i >= 0) openOrder.splice(i, 1);
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
  } catch (e) {
    console.error("[playwright] shutdown error", e);
  }
}
