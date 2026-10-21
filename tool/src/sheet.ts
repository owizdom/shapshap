import { dataRowCount, loadCatalog, missingHeaders, parseCatalog } from "./catalog.ts";
import type { Catalog, LoadedCatalog, SheetUrls } from "./types.ts";

export function sheetCatalogLoader(
  urls: SheetUrls,
  opts: { fetch?: typeof fetch; timeoutMs?: number; cacheMs?: number; now?: () => number; bundled?: () => Catalog } = {},
): () => Promise<LoadedCatalog> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const cacheMs = opts.cacheMs ?? 60000;
  const now = opts.now ?? Date.now;
  const bundled = opts.bundled ?? (() => loadCatalog());
  let good: { at: number; catalog: Catalog; problems: string[] } | undefined;
  const currentGood = () => good; // read through a function: TypeScript cannot see refresh() reassign good
  let failure: { at: number; why: string } | undefined;
  let inflight: Promise<void> | undefined;

  async function tab(url: string): Promise<string> {
    const f = opts.fetch ?? globalThis.fetch;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => { ac.abort(); rej(new Error(`timed out after ${timeoutMs} ms`)); }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const res = await f(url, { signal: ac.signal });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.text();
        })(),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function fallback(why: string): LoadedCatalog {
    if (good) return { catalog: good.catalog, source: "cached_sheet", problems: [why, ...good.problems] };
    return { catalog: bundled(), source: "bundled", problems: [why] };
  }

  // One sheet read. Resolves to a catalog, or to a failure reason; never rejects.
  async function read(): Promise<{ ok: true } | { ok: false; why: string }> {
    try {
      const [prices, faults, stock] = await Promise.all([tab(urls.prices), tab(urls.faults), tab(urls.stock)]);
      const bad = missingHeaders({ prices, faults, stock });
      if (bad.length > 0) return { ok: false, why: `sheet tab key headers missing: ${bad.join("; ")}` };
      const { catalog, problems } = parseCatalog({ prices, faults, stock });
      const empty: string[] = [];
      if (catalog.prices.length === 0) empty.push("prices");
      if (catalog.faults.length === 0) empty.push("faults");
      if (catalog.stock.length === 0 && dataRowCount(stock) > 0) empty.push("stock");
      if (empty.length > 0) {
        return { ok: false, why: `sheet tab ${empty.join(", ")} has no valid rows${problems.length ? `: ${problems.join("; ")}` : ""}` };
      }
      good = { at: now(), catalog, problems };
      failure = undefined;
      return { ok: true };
    } catch (e) {
      return { ok: false, why: `sheet could not be read: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // Every tab fetch aborts at timeoutMs, so a refresh cannot legitimately run longer; one older than timeoutMs plus a
  // margin is presumed stuck and replaced. Callers wait at most STALE_GRACE_MS for a refresh before serving stale.
  const REFRESH_PATIENCE_MS = timeoutMs + 1000;
  const STALE_GRACE_MS = 5;
  let inflightSince = 0;

  function refresh(): Promise<void> {
    if (!inflight || Date.now() - inflightSince > REFRESH_PATIENCE_MS) {
      const mine: Promise<void> = read().then((r) => {
        if (!r.ok) failure = { at: now(), why: r.why };
      }).finally(() => { if (inflight === mine) inflight = undefined; });
      inflight = mine;
      inflightSince = Date.now();
    }
    return inflight;
  }

  async function grace(p: Promise<void>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([p, new Promise<void>((r) => { timer = setTimeout(r, STALE_GRACE_MS); })]);
    clearTimeout(timer);
  }

  return async () => {
    if (good && now() - good.at < cacheMs) return { catalog: good.catalog, source: "sheet", problems: good.problems };
    if (good) {
      // stale-while-revalidate: serve the last good read without waiting on the sheet, refresh in the background
      const before = good;
      if (!(failure && now() - failure.at < cacheMs)) await grace(refresh());
      if (good !== before) return { catalog: good.catalog, source: "sheet", problems: good.problems };
      return { catalog: good.catalog, source: "cached_sheet", problems: failure ? [failure.why, ...good.problems] : good.problems };
    }
    if (failure && now() - failure.at < cacheMs) return fallback(failure.why);
    await refresh();
    const fresh = currentGood();
    if (fresh) return { catalog: fresh.catalog, source: "sheet", problems: fresh.problems };
    return fallback(failure?.why ?? "sheet could not be read");
  };
}
