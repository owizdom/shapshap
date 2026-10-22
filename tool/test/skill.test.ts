// Skill coverage: the agent's instructions must name every fault key in the data and handle FAULT_NOT_BOUGHT.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const skill = readFileSync(fileURLToPath(new URL("../../skills/sharpsharp/SKILL.md", import.meta.url)), "utf8");
// Read faults.csv directly so these tests depend on the data and the skill only, not on the parser.
const rows = readFileSync(fileURLToPath(new URL("../data/faults.csv", import.meta.url)), "utf8").trim().split(/\r?\n/).slice(1);
const catalog = { faults: rows.map((l) => ({ fault: l.split(",")[0], action: /,(deduct|inspect|refuse),\d+,/.exec(l)![1] })) };
const mentions = (text: string, key: string) => new RegExp(`(^|[^a-z0-9_])${key}($|[^a-z0-9_])`).test(text);

// Refuse handling = table rows marked refuse, the FAULT_NOT_BOUGHT bullet in the error section, or any section whose heading is about refusing.
function refuseHandling(): string {
  const parts: string[] = [];
  const lines = skill.split("\n");
  for (const l of lines) if (/\|\s*refuse\s*\|/i.test(l)) parts.push(l);
  lines.forEach((l, i) => {
    if (/^\s*[-*]\s*FAULT_NOT_BOUGHT\b/.test(l)) {
      let j = i + 1;
      while (j < lines.length && !/^\s*[-*]\s/.test(lines[j]) && !/^#/.test(lines[j]) && lines[j].trim() !== "") j++;
      parts.push(lines.slice(i, j).join("\n"));
    }
  });
  const sections = skill.split(/^(?=#{2,3} )/m);
  for (const s of sections) if (/^#{2,3} .*(refus|cannot buy|do not buy|not bought)/i.test(s)) parts.push(s);
  return parts.join("\n");
}

describe("SKILL.md covers the data", () => {
  test("every fault key in faults.csv appears literally in SKILL.md", () => {
    assert.equal(catalog.faults.length, 34);
    const missing = catalog.faults.filter((f) => !mentions(skill, f.fault)).map((f) => f.fault);
    assert.deepEqual(missing, []);
  });

  test("the seven condition rows left the fault list (spec 0002): none is a fault table row any more", () => {
    for (const k of ["screen_cracked", "back_glass", "frame_dents", "battery_service", "battery_not_genuine", "aftermarket_screen", "parts_unknown_other"]) {
      assert.ok(!catalog.faults.some((f) => f.fault === k), `${k} still in faults.csv`);
      assert.ok(!new RegExp(`^\\s*\\|\\s*${k}\\s*\\|`, "m").test(skill), `${k} still a row in the SKILL.md fault table`);
    }
  });

  test("the retired no_charge key is gone from SKILL.md", () => {
    assert.ok(!mentions(skill, "no_charge"));
  });

  test("FAULT_NOT_BOUGHT is handled as a bullet in the error section", () => {
    const section = skill.split(/^## /m).find((s) => s.startsWith("When a tool returns an error"));
    assert.ok(section, "error section missing");
    assert.match(section, /^\s*[-*]\s*FAULT_NOT_BOUGHT\b/m);
  });

  test("every refuse fault is named in the refuse handling", () => {
    const refuse = catalog.faults.filter((f) => f.action === "refuse").map((f) => f.fault);
    assert.equal(refuse.length, 6);
    const text = refuseHandling();
    assert.ok(text.length > 0, "no refuse handling found (FAULT_NOT_BOUGHT bullet or a refusing section)");
    const missing = refuse.filter((k) => !mentions(text, k));
    assert.deepEqual(missing, []);
  });
});
