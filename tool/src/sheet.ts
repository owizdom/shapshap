import { loadCatalog, parseCatalog } from "./catalog.ts";
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

  return async () => {
    if (good && now() - good.at < cacheMs) return { catalog: good.catalog, source: "sheet", problems: good.problems };
    try {
      const [prices, faults, stock] = await Promise.all([tab(urls.prices), tab(urls.faults), tab(urls.stock)]);
      const { catalog, problems } = parseCatalog({ prices, faults, stock });
      for (const [name, rows] of [["prices", catalog.prices], ["faults", catalog.faults], ["stock", catalog.stock]] as const) {
        if (rows.length === 0) return fallback(`sheet tab ${name} has no valid rows${problems.length ? `: ${problems.join("; ")}` : ""}`);
      }
      good = { at: now(), catalog, problems };
      return { catalog, source: "sheet", problems };
    } catch (e) {
      return fallback(`sheet could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}
