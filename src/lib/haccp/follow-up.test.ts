import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLabel, overdueFollowUp } from "./follow-up";
import type { HaccpOverdueRow } from "@/lib/types/database";

const base: HaccpOverdueRow = {
  occurrence_id: "o", task_id: "t", title: "Afzuigkap", area_id: "a", area_name: "Warme keuken",
  area_sort: 0, department_id: null, department_name: null, due_date: "2026-11-20", slot: 1,
  slots_total: 1, status: "open", completed_at: null, completed_by: null, requires_check: false,
  check_status: null, checked_by: null, not_done_reason: null, not_done_by: null, not_done_at: null,
  deviation_count: 0, open_deviation_count: 0, last_deviation_status: null, last_corrective_action: null,
};

test("open achterstallige taak", () => {
  const f = overdueFollowUp(base);
  assert.equal(f.open, true);
  assert.equal(f.tone, "danger");
  assert.deepEqual(f.lines, ["Nog niet gedaan"]);
});

test("niet gedaan met reden en leidinggevende", () => {
  const f = overdueFollowUp({ ...base, status: "niet_uitgevoerd", not_done_reason: "frituur defect", not_done_by: "Henny" });
  assert.equal(f.open, false);
  assert.equal(f.lines[0], "Afgesloten als niet gedaan door Henny: frituur defect");
});

test("alsnog gedaan, controle apart", () => {
  const f = overdueFollowUp({
    ...base, status: "uitgevoerd", completed_at: "2026-11-21T08:15:00Z", completed_by: "Robin", requires_check: true,
  });
  assert.match(f.lines[0], /^Alsnog gedaan door Robin op .* 09:15$/);
  assert.equal(f.lines[1], "Wacht op controle leidinggevende");
});

test("probleem met maatregel", () => {
  const f = overdueFollowUp({
    ...base, deviation_count: 1, open_deviation_count: 1, last_deviation_status: "maatregel",
    last_corrective_action: "monteur gebeld",
  });
  assert.equal(f.lines[1], "1 probleem · maatregel genomen — maatregel: monteur gebeld");
});

test("controlelabels", () => {
  assert.equal(checkLabel("akkoord", "Jelle"), "Gecontroleerd door Jelle ✓");
  assert.equal(checkLabel(null, null), "Wacht op controle leidinggevende");
});
