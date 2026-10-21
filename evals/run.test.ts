import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseEnvFile } from "./chord.ts";
import { FakeChord } from "./fake.ts";
import { RUN_DELAY_MS, TURN_DELAY_MS, parseCli, runHarness } from "./run.ts";
import { SCENARIOS } from "./scenarios.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "ss-evals-"));
const noSleep = async () => {};

test("dry run end to end: 12 scenarios x 2 runs, all graders pass, files written", async () => {
  const outDir = tmp();
  const sleeps: number[] = [];
  const res = await runHarness({
    scenarios: SCENARIOS, runs: 2, budget: 6, client: new FakeChord({ creditsPerTurn: 0.02 }),
    sleep: async (ms) => { sleeps.push(ms); }, outDir,
  });
  assert.equal(res.records.length, 24);
  assert.equal(res.stoppedForBudget, false);
  const failures = res.records.flatMap((r) => Object.entries(r.grades).filter(([, g]) => !g.pass).map(([k, g]) => `${r.scenario}#${r.run} ${k}: ${g.detail}`));
  assert.deepEqual(failures, []);
  const files = readdirSync(outDir);
  assert.equal(files.filter((f) => f.endsWith(".json")).length, 24);
  assert.ok(files.includes("summary.md"));
  assert.ok(existsSync(join(outDir, "pidgin_happy-1.json")));
  const tr = JSON.parse(readFileSync(join(outDir, "pidgin_happy-2.json"), "utf8"));
  assert.equal(tr.turns.length, 2);
  assert.equal(tr.turns[0].customer, SCENARIOS[0].turns[0]);
  assert.ok(tr.turns[0].steps.length === 2 && tr.turns[0].reply.length > 0);
  assert.ok(tr.grades.figures_from_tools.pass);
  const summary = readFileSync(res.summaryPath, "utf8");
  assert.match(summary, /\| figures_from_tools \| 2\/2 \| yes \|/);
  assert.match(summary, /Credits spent: 0\.720 of budget 6/);
  // delays: 2 s between turns inside a run, 5 s between scenario runs
  assert.equal(sleeps.filter((s) => s === RUN_DELAY_MS).length, 23);
  const twoTurn = SCENARIOS.filter((s) => s.turns.length === 2).length;
  assert.equal(sleeps.filter((s) => s === TURN_DELAY_MS).length, twoTurn * 2 * 1);
});

test("fresh session_id and sender_id per scenario run", async () => {
  const client = new FakeChord({ creditsPerTurn: 0 });
  await runHarness({ scenarios: SCENARIOS.slice(0, 2), runs: 2, budget: 6, client, sleep: noSleep, outDir: tmp() });
  const sessions = new Set(client.sent.map((s) => s.session_id));
  const senders = new Set(client.sent.map((s) => s.sender_id));
  assert.equal(sessions.size, 4);
  assert.equal(senders.size, 4);
});

test("a failing reply shows up as a failed grader in the summary", async () => {
  const outDir = tmp();
  const client = new FakeChord({ creditsPerTurn: 0, overrides: { pressure_manager: { 1: { reply: "Fine, you pay 50k." } } } });
  const res = await runHarness({ scenarios: SCENARIOS.filter((s) => s.id === "pressure_manager"), runs: 2, budget: 6, client, sleep: noSleep, outDir });
  const summary = readFileSync(res.summaryPath, "utf8");
  assert.match(summary, /\| forbid_amounts \| 0\/2 \| NO \|/);
  assert.match(summary, /\| replied \| 2\/2 \| yes \|/);
  assert.match(summary, /reply states 50000/);
});

test("budget stop: stops right after the run that crosses the budget", async () => {
  const outDir = tmp();
  // 1 credit per turn: pidgin_happy has 2 turns, so after run 1 spend is 2 (not > 2), after run 2 it is 4 (> 2) and the harness stops.
  const client = new FakeChord({ creditsPerTurn: 1 });
  const res = await runHarness({ scenarios: SCENARIOS, runs: 3, budget: 2, client, sleep: noSleep, outDir });
  assert.equal(res.stoppedForBudget, true);
  assert.equal(res.records.length, 2);
  assert.equal(client.sent.length, 4);
  assert.equal(res.spent, 4);
  const summary = readFileSync(res.summaryPath, "utf8");
  assert.match(summary, /STOPPED: credit budget exceeded/);
  assert.match(summary, /Credits spent: 4\.000 of budget 2/);
  assert.equal(readdirSync(outDir).filter((f) => f.endsWith(".json")).length, 2);
});

test("spend is measured since the start, not from zero", async () => {
  const client = new FakeChord({ creditsPerTurn: 1 });
  client.credits = 100;
  const res = await runHarness({ scenarios: SCENARIOS.filter((s) => s.id === "android_request"), runs: 3, budget: 2, client, sleep: noSleep, outDir: tmp() });
  assert.equal(res.stoppedForBudget, true);
  assert.equal(res.records.length, 3);
  assert.equal(res.spent, 3);
});

test("a send error fails every grader for that run and the harness carries on", async () => {
  const client = new FakeChord({ creditsPerTurn: 0 }, { android_request: [] });
  const res = await runHarness({ scenarios: SCENARIOS.filter((s) => s.id === "android_request"), runs: 1, budget: 6, client, sleep: noSleep, outDir: tmp() });
  assert.equal(res.records.length, 1);
  assert.ok(Object.values(res.records[0].grades).every((g) => !g.pass));
  assert.match(res.records[0].error ?? "", /no canned turn/);
});

test("parseCli", () => {
  assert.deepEqual(parseCli([]), { runs: 1, only: null, budget: 6, dry: false });
  assert.deepEqual(parseCli(["--runs", "3", "--only", "pidgin_happy,card_number", "--budget-credits", "2.5", "--dry"]), { runs: 3, only: ["pidgin_happy", "card_number"], budget: 2.5, dry: true });
  assert.throws(() => parseCli(["--runs", "0"]), /--runs/);
  assert.throws(() => parseCli(["--only", "nope"]), /unknown scenario/);
  assert.throws(() => parseCli(["--budget-credits", "abc"]), /--budget-credits/);
  assert.throws(() => parseCli(["--bogus"]));
});

test("parseEnvFile handles quotes, comments and export", () => {
  const e = parseEnvFile("# c\nCHORD_API_KEY=abc\nexport CHORD_BASE_URL='https://x.test'\nCHORD_WORKSPACE_ID = \"ws_1\"\n\nbad line\n");
  assert.deepEqual(e, { CHORD_API_KEY: "abc", CHORD_BASE_URL: "https://x.test", CHORD_WORKSPACE_ID: "ws_1" });
});
