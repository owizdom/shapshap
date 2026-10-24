// Does a later turn see an earlier turn's tool results? Turn 1 gets a valuation; its valid_until
// appears only in the tool result, never in the reply. Turn 2 asks for that exact time without a new
// tool call. A reply quoting turn 1's valid_until with no new tool call means the result was in context.
// usage: node evals/probes/memory-probe.ts <runs>   (live, about 0.4 credits a run)
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HttpChordClient, configFromEnv, loadEnvFile } from "../chord.ts";

const root = join(import.meta.dirname, "..", "..");
loadEnvFile(join(root, ".env"));
const { config, missing } = configFromEnv(process.env);
if (!config) throw new Error(`missing ${missing.join(", ")}`);
const client = new HttpChordClient(config);
const TURNS = [
  "Hello, my iPhone 13 Pro 128GB back camera is blurry. I can add 250k.",
  "Before I choose: what exact date and time does this valuation expire? Don't run anything again, just tell me the exact expiry time your system gave you.",
];
const out = join(root, "evals", "results", `probe-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}Z`);
mkdirSync(out, { recursive: true });
const runs = Number(process.argv[2] ?? 1);
const before = await client.usage();
for (let r = 1; r <= runs; r++) {
  const session_id = randomUUID(), sender_id = `probe-${randomUUID()}`;
  const turns = [];
  for (const text of TURNS) {
    const res = await client.send({ session_id, sender_id, text });
    turns.push({ customer: text, reply: res.reply, steps: res.steps ?? [] });
    await new Promise((s) => setTimeout(s, 2000));
  }
  const issued = turns[0].steps.map((s: any) => String(s.result ?? "").match(/"valid_until":"([^"]+)"/)?.[1]).filter(Boolean);
  const recalled = turns[1].steps.map((s: any) => (s.tool_name ?? "").split("__").pop());
  console.log(`run ${r}: turn-1 valid_until ${issued.join(",")} | turn-2 tool calls [${recalled.join(",")}] | reply: ${String(turns[1].reply).slice(0, 220).replace(/\n/g, " ")}`);
  writeFileSync(join(out, `memory-probe-${r}.json`), JSON.stringify({ probe: "memory", run: r, session_id, sender_id, turns }, null, 1));
}
console.log(`credits: ${((await client.usage()) - before).toFixed(3)}; saved ${out}`);
