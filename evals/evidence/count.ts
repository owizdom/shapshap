// Recounts field note 2's table: later replies (turn 2 onward) in which the agent apologises for, or corrects, its own figures.
// Live runs only. Run from the repo root: node evals/evidence/count.ts
import { readFileSync, readdirSync } from "node:fs";

const groups: Record<string, string[]> = {
  "21 Oct, first runs": ["2026-10-21T17-35-32Z", "2026-10-21T17-40-53Z"],
  "21 Oct, after a no-apology rule": ["2026-10-21T17-44-11Z"],
  "22 Oct, after the skill cut": ["2026-10-22T18-12-35Z", "2026-10-22T18-17-17Z"],
  "24 Oct morning": ["2026-10-24T05-23-59Z", "2026-10-24T05-26-38Z", "2026-10-24T05-28-30Z", "2026-10-24T05-37-47Z", "2026-10-24T05-40-30Z"],
  "24 Oct afternoon": ["2026-10-24T15-37-57Z", "2026-10-24T15-40-02Z", "2026-10-24T15-41-49Z", "2026-10-24T15-44-12Z", "2026-10-24T15-48-53Z", "2026-10-24T15-53-09Z"],
  "24 Oct probe: customer asks for a detail only the tool result had": ["probe-2026-10-24T16-15-55Z"],
};
// Apologies for or corrections of the agent's own figures, not sympathy ("sorry to hear your mother is in hospital").
const apology = /sorry (for|about) (the|any)? ?(confusion|mix-up)|correct my last message|correction:|please ignore|nothing wrong with them|checked properly this time/i;

for (const [name, runs] of Object.entries(groups)) {
  let later = 0;
  const hits: string[] = [];
  for (const run of runs) {
    const dir = `evals/evidence/${run}`;
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const turns = JSON.parse(readFileSync(`${dir}/${f}`, "utf8")).turns as { reply: string }[];
      turns.slice(1).forEach((t) => {
        later++;
        const m = t.reply.match(apology);
        if (m) hits.push(`${run}/${f}: "${m[0]}"`);
      });
    }
  }
  console.log(`${name}: ${hits.length} of ${later} later replies`);
  for (const h of hits) console.log("  " + h);
}
