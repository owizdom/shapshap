// Compares every token the model passed to a tool with the tokens tools returned earlier in the same
// turn, across the unredacted runs in evals/results. A copy that matches none of them was retyped wrong.
// usage: node evals/probes/token-copies.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "results");
const TOKEN = /"(quote_token|offer_token)"\s*:\s*"([^"]+)"/g;
const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));
let copies = 0, bad = 0, runs = 0;
for (const run of readdirSync(dir).sort()) {
  if (!statSync(join(dir, run)).isDirectory()) continue;
  let used = false;
  for (const f of readdirSync(join(dir, run)).filter((x) => x.endsWith(".json"))) {
    const t = JSON.parse(readFileSync(join(dir, run, f), "utf8"));
    for (const [i, turn] of (t.turns ?? []).entries()) {
      const issued: string[] = [];
      for (const s of turn.steps ?? []) {
        for (const [, kind, tok] of text(s.instruction).matchAll(TOKEN)) {
          if (tok.startsWith("fakeq")) continue; // dry runs against the fake Chord
          used = true; copies++;
          if (!issued.includes(tok)) {
            bad++;
            const near = issued.find((x) => Math.abs(x.length - tok.length) <= 2) ?? "";
            console.log(`${run}/${f} turn ${i}: ${kind} passed to ${String(s.tool_name).split("__").pop()} is ${tok.length} chars, issued ${near.length}; result ${text(s.result).slice(0, 40)}`);
          }
        }
        for (const [, , tok] of text(s.result).matchAll(TOKEN)) issued.push(tok);
      }
    }
  }
  if (used) runs++;
}
console.log(`${copies} token copies in ${runs} live runs, ${bad} did not match a token issued earlier in the turn`);
