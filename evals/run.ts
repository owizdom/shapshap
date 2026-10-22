// CLI: node evals/run.ts --runs N [--only id,...] [--budget-credits X] [--dry]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { HttpChordClient, configFromEnv, loadEnvFile } from "./chord.ts";
import { FakeChord } from "./fake.ts";
import { checksFor, gradeTranscript } from "./graders.ts";
import { SCENARIOS } from "./scenarios.ts";
import type { ChordClient, GradeResult, Scenario, Transcript } from "./types.ts";

export const TURN_DELAY_MS = 2000;
export const RUN_DELAY_MS = 5000;
export const DEFAULT_BUDGET = 6;

export interface RunRecord { scenario: string; run: number; grades: Record<string, GradeResult>; error?: string }

export interface HarnessOptions {
  scenarios: Scenario[];
  runs: number;
  budget: number;
  client: ChordClient;
  sleep: (ms: number) => Promise<void>;
  outDir: string;
  log?: (line: string) => void;
}

export interface HarnessResult {
  records: RunRecord[];
  spent: number;
  budget: number;
  stoppedForBudget: boolean;
  summaryPath: string;
  outDir: string;
}

export function renderSummary(r: Omit<HarnessResult, "summaryPath" | "outDir"> & { scenarios: Scenario[]; runsRequested: number }): string {
  const lines: string[] = [];
  lines.push("# ShapShap eval summary", "");
  lines.push(`Runs requested per scenario: ${r.runsRequested}`);
  lines.push(`Credits spent: ${r.spent.toFixed(3)} of budget ${r.budget}`);
  if (r.stoppedForBudget) lines.push("", "STOPPED: credit budget exceeded, remaining runs were not executed.");
  lines.push("");
  let allPass = true;
  for (const sc of r.scenarios) {
    const recs = r.records.filter((x) => x.scenario === sc.id);
    if (recs.length === 0) continue;
    lines.push(`## ${sc.id}`, "", sc.description, "", `| grader | passed | pass^k |`, `|---|---|---|`);
    for (const { key } of checksFor(sc)) {
      const passed = recs.filter((x) => x.grades[key]?.pass).length;
      const all = passed === recs.length;
      if (!all) allPass = false;
      lines.push(`| ${key} | ${passed}/${recs.length} | ${all ? "yes" : "NO"} |`);
    }
    const fails = recs.flatMap((x) => Object.entries(x.grades).filter(([, g]) => !g.pass).map(([k, g]) => `- run ${x.run} ${k}: ${g.detail}`));
    if (fails.length) lines.push("", "Failures:", ...fails);
    lines.push("");
  }
  lines.push(allPass && !r.stoppedForBudget ? "Overall: every grader passed on every run." : "Overall: at least one grader failed or the run was cut short.", "");
  return lines.join("\n");
}

export async function runHarness(o: HarnessOptions): Promise<HarnessResult> {
  const log = o.log ?? (() => {});
  mkdirSync(o.outDir, { recursive: true });
  const start = await o.client.usage();
  const records: RunRecord[] = [];
  let spent = 0;
  let stopped = false;

  outer: for (const sc of o.scenarios) {
    for (let run = 1; run <= o.runs; run++) {
      const t: Transcript = {
        scenario: sc.id, run, session_id: crypto.randomUUID(), sender_id: `eval-${crypto.randomUUID().slice(0, 8)}`, turns: [],
      };
      try {
        for (let i = 0; i < sc.turns.length; i++) {
          if (i > 0) await o.sleep(TURN_DELAY_MS);
          const res = await o.client.send({ session_id: t.session_id, sender_id: t.sender_id, text: sc.turns[i] });
          t.turns.push({ customer: sc.turns[i], reply: res.reply, agent_invoked: res.agent_invoked, reason: res.reason, steps: res.steps ?? [] });
        }
      } catch (e) {
        t.error = (e as Error).message;
      }
      const grades = gradeTranscript(sc, t);
      if (t.error) for (const k of Object.keys(grades)) grades[k] = { pass: false, detail: `run error: ${t.error}` };
      writeFileSync(join(o.outDir, `${sc.id}-${run}.json`), JSON.stringify({ ...t, grades }, null, 2));
      records.push({ scenario: sc.id, run, grades, error: t.error });
      const failed = Object.values(grades).filter((g) => !g.pass).length;
      log(`${sc.id} run ${run}: ${failed === 0 ? "pass" : `${failed} grader(s) failed`}${t.error ? ` (error: ${t.error})` : ""}`);

      spent = (await o.client.usage()) - start;
      if (spent > o.budget) {
        stopped = true;
        log(`budget exceeded: spent ${spent.toFixed(3)} > ${o.budget}, stopping`);
        break outer;
      }
      const last = sc === o.scenarios[o.scenarios.length - 1] && run === o.runs;
      if (!last) await o.sleep(RUN_DELAY_MS);
    }
  }

  const summary = renderSummary({ records, spent, budget: o.budget, stoppedForBudget: stopped, scenarios: o.scenarios, runsRequested: o.runs });
  const summaryPath = join(o.outDir, "summary.md");
  writeFileSync(summaryPath, summary);
  return { records, spent, budget: o.budget, stoppedForBudget: stopped, summaryPath, outDir: o.outDir };
}

export interface CliArgs { runs: number; only: string[] | null; budget: number; dry: boolean }

export function parseCli(argv: string[]): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: { runs: { type: "string" }, only: { type: "string" }, "budget-credits": { type: "string" }, dry: { type: "boolean" } },
    strict: true,
  });
  const runs = values.runs === undefined ? 1 : Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer");
  const budget = values["budget-credits"] === undefined ? DEFAULT_BUDGET : Number(values["budget-credits"]);
  if (!Number.isFinite(budget) || budget < 0) throw new Error("--budget-credits must be a non-negative number");
  const only = values.only ? values.only.split(",").map((s) => s.trim()).filter(Boolean) : null;
  if (only) {
    const unknown = only.filter((id) => !SCENARIOS.some((s) => s.id === id));
    if (unknown.length) throw new Error(`unknown scenario id(s): ${unknown.join(", ")}`);
  }
  return { runs, only, budget, dry: Boolean(values.dry) };
}

export function timestamp(d = new Date()): string {
  return d.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
}

export async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try { args = parseCli(argv); } catch (e) { console.error((e as Error).message); return 2; }
  const root = join(import.meta.dirname, "..");
  loadEnvFile(join(root, ".env"));

  let client: ChordClient;
  let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  if (args.dry) {
    client = new FakeChord({ creditsPerTurn: 0.02 });
    sleep = async () => {};
  } else {
    const { config, missing } = configFromEnv(process.env);
    if (!config) { console.error(`missing environment variable(s): ${missing.join(", ")}`); return 2; }
    client = new HttpChordClient(config);
  }

  const scenarios = args.only ? SCENARIOS.filter((s) => args.only!.includes(s.id)) : SCENARIOS;
  const outDir = join(import.meta.dirname, "results", timestamp());
  let res: HarnessResult;
  try {
    res = await runHarness({ scenarios, runs: args.runs, budget: args.budget, client, sleep, outDir, log: (l) => console.log(l) });
  } catch (e) {
    console.error(`harness failed: ${(e as Error).message}`);
    return 2;
  }
  console.log(`\nSummary: ${res.summaryPath}\nCredits spent: ${res.spent.toFixed(3)} (budget ${res.budget})`);
  if (res.stoppedForBudget) return 3;
  const failed = res.records.some((r) => Object.values(r.grades).some((g) => !g.pass));
  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2));
}
