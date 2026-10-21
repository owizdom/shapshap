import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog, CatalogTexts, FaultAction, FaultRow, PriceRow, StockUnit } from "./types.ts";

// RFC 4180 style reader: quoted fields, "" escapes, commas and newlines inside quotes, CRLF.
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      out.push(row); row = [];
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim().length > 0));
}

function records(text: string): Record<string, string>[] {
  const table = parseCsv(text);
  if (table.length === 0) return [];
  const head = table[0].map((h) => h.trim().toLowerCase());
  return table.slice(1).map((cells) => {
    const o: Record<string, string> = {};
    head.forEach((h, i) => { if (h && !(h in o)) o[h] = (cells[i] ?? "").trim(); });
    return o;
  });
}

// "₦850,000", "850,000", " 850000 " -> 850000; anything else -> NaN
function num(s: string | undefined): number {
  const t = (s ?? "").replace(/[₦,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Number(t);
}

export function parseCatalog(texts: CatalogTexts): { catalog: Catalog; problems: string[] } {
  const problems: string[] = [];
  const prices: PriceRow[] = [];
  const seenPrice = new Set<string>();
  records(texts.prices).forEach((r, i) => {
    const model = r.model ?? "";
    const where = `prices row ${i + 2}${model ? ` (${model} ${r.capacity_gb ?? ""} GB)` : ""}`;
    const capacity_gb = num(r.capacity_gb), base_ngn = num(r.base_ngn), floor_ngn = num(r.floor_ngn);
    if (!model) return void problems.push(`${where}: missing model, row skipped`);
    if (!(capacity_gb > 0)) return void problems.push(`${where}: capacity_gb must be above 0, row skipped`);
    if (!(base_ngn > 0)) return void problems.push(`${where}: base_ngn must be above 0, row skipped`);
    if (!(floor_ngn >= 0 && floor_ngn <= base_ngn)) return void problems.push(`${where}: floor_ngn must be between 0 and base_ngn, row skipped`);
    const key = `${model.toLowerCase()}|${capacity_gb}`;
    if (seenPrice.has(key)) return void problems.push(`${where}: duplicate of an earlier row, row skipped`);
    seenPrice.add(key);
    prices.push({ model, capacity_gb, base_ngn, floor_ngn });
  });

  const faults: FaultRow[] = [];
  const seenFault = new Set<string>();
  records(texts.faults).forEach((r, i) => {
    const fault = r.fault ?? "";
    const where = `faults row ${i + 2} (${fault || "no key"})`;
    const deduct_pct = num(r.deduct_pct);
    if (!/^[a-z][a-z0-9_]*$/.test(fault)) return void problems.push(`${where}: fault key must be lowercase letters, digits and underscores, starting with a letter, row skipped`);
    if (!(deduct_pct >= 0 && deduct_pct <= 100)) return void problems.push(`${where}: deduct_pct must be between 0 and 100, row skipped`);
    if (seenFault.has(fault)) return void problems.push(`${where}: duplicate of an earlier row, row skipped`);
    seenFault.add(fault);
    const a = (r.action ?? "").toLowerCase();
    const action: FaultAction = a === "refuse" || a === "inspect" ? a : "deduct";
    faults.push({
      fault, label: r.label ?? "", category: r.category ?? "", action, deduct_pct,
      check_hint: r.check_hint ?? "", basis: (r.basis ?? "").toLowerCase() === "sourced" ? "sourced" : "policy",
    });
  });

  const stock: StockUnit[] = [];
  const seenUnit = new Set<string>();
  records(texts.stock).forEach((r, i) => {
    const unit_id = r.unit_id ?? "";
    const where = `stock row ${i + 2} (${unit_id || "no unit_id"})`;
    const price_ngn = num(r.price_ngn), battery_pct = num(r.battery_pct);
    if (!unit_id) return void problems.push(`${where}: missing unit_id, row skipped`);
    if (seenUnit.has(unit_id)) return void problems.push(`${where}: duplicate unit_id, row skipped`);
    if (!(price_ngn > 0)) return void problems.push(`${where}: price_ngn must be above 0, row skipped`);
    if (!(battery_pct >= 0 && battery_pct <= 100)) return void problems.push(`${where}: battery_pct must be between 0 and 100, row skipped`);
    seenUnit.add(unit_id);
    const warranty = num(r.warranty_months);
    stock.push({
      unit_id, model: r.model ?? "", capacity_gb: num(r.capacity_gb), grade: r.grade ?? "",
      battery_pct, warranty_months: Number.isNaN(warranty) ? 0 : warranty, price_ngn,
    });
  });
  return { catalog: { prices, faults, stock }, problems };
}

export function loadCatalog(dir: string = join(import.meta.dirname, "..", "data")): Catalog {
  const read = (f: string) => readFileSync(join(dir, f), "utf8");
  return parseCatalog({ prices: read("trade-in-prices.csv"), faults: read("faults.csv"), stock: read("stock.csv") }).catalog;
}
