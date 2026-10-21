import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog, FaultRow, PriceRow, StockUnit } from "./types.ts";

function rows(path: string): Record<string, string>[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const out: Record<string, string> = {};
    head.forEach((h, i) => { out[h] = cells[i] ?? ""; });
    return out;
  });
}

export function loadCatalog(dir: string = join(import.meta.dirname, "..", "data")): Catalog {
  const prices: PriceRow[] = rows(join(dir, "trade-in-prices.csv")).map((r) => ({
    model: r.model, capacity_gb: Number(r.capacity_gb), base_ngn: Number(r.base_ngn), floor_ngn: Number(r.floor_ngn),
  }));
  const faults: FaultRow[] = rows(join(dir, "faults.csv")).map((r) => ({
    fault: r.fault, label: r.label, deduct_pct: Number(r.deduct_pct),
  }));
  const stock: StockUnit[] = rows(join(dir, "stock.csv")).map((r) => ({
    unit_id: r.unit_id, model: r.model, capacity_gb: Number(r.capacity_gb), grade: r.grade,
    battery_pct: Number(r.battery_pct), warranty_months: Number(r.warranty_months), price_ngn: Number(r.price_ngn),
  }));
  return { prices, faults, stock };
}
