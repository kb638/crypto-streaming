import { chromium, Browser, Page } from "playwright";
import { EventEmitter } from "node:events";

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({ headless: false }); // headed mode per spec
    console.log("[playwright] launched chromium (headed)");
  }
  return browser;
}

export type PriceEvents = {
  update: (price: number) => void;
  error: (err: string) => void;
};

export function createPriceEmitter(): EventEmitter {
  // we’ll emit("update", price:number) and emit("error", message:string)
  return new EventEmitter();
}

/**
 * Open a TradingView symbol page for BINANCE and start pushing price changes
 * to the provided emitter. Callers can listen for "update" events.
 */
export async function openTickerAndWatch(ticker: string, emitter: EventEmitter): Promise<Page> {
  const url = `https://www.tradingview.com/symbols/${ticker}/?exchange=BINANCE`;
  const br = await getBrowser();
  const page = await br.newPage();

  page.on("console", (msg) => console.log("[page]", msg.type(), msg.text()));
  page.on("pageerror", (e) => emitter.emit("error", String(e)));

  console.log("[playwright] navigating:", url);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  console.log("[playwright] title:", await page.title());

  // Bridge page->node via exposed function
  await page.exposeFunction("__pushPriceToNode", (raw: any) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    emitter.emit("update", n);
  });

  // In the page context, try multiple selectors and also a MutationObserver
  await page.evaluate(() => {
    // @ts-ignore
    const push = (window as any).__pushPriceToNode as (v: number) => void;

    const trySelectors = (): HTMLElement | null => {
      // We try a few plausible selectors TradingView tends to use.
      // These can change, so we probe in order:
      const candidates = [
        // classic price element
        '.tv-symbol-price-quote__value',
        // newer widget price value
        '[data-name="price"]',
        // fallback: any element with data-last-price or similar
        '[data-last-price]',
        // generic: the first element with big numeric content near price
        'div[class*="price"], span[class*="price"]',
      ];
      for (const sel of candidates) {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (el && /\d/.test(el.textContent ?? "")) return el;
      }
      return null;
    };

    const parsePrice = (txt: string | null | undefined): number | null => {
      if (!txt) return null;
      // remove commas and non-numeric (keep dot)
      const cleaned = txt.replace(/[,\s]/g, "");
      const m = cleaned.match(/[-+]?\d+(\.\d+)?/);
      if (!m) return null;
      const n = Number(m[0]);
      return Number.isFinite(n) ? n : null;
    };

    const el = trySelectors();
    if (el) {
      const v = parsePrice(el.textContent);
      if (v != null) push(v);
      // observe changes
      const mo = new MutationObserver(() => {
        const nv = parsePrice(el.textContent);
        if (nv != null) push(nv);
      });
      mo.observe(el, { childList: true, subtree: true, characterData: true });
    } else {
      // As a last resort, poll body text (ugly but robust)
      const poll = () => {
        const v = parsePrice(document.body?.innerText ?? "");
        if (v != null) push(v);
      };
      poll();
      setInterval(poll, 1000);
    }
  });

  return page;
}
