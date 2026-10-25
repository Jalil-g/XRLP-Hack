// INS-02 queue logic over the demo fixtures: grouping by `needs`, ordering, evidence status, arrivals.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { api } from "../lib/api.ts";
import { ADDR } from "../lib/mock/fixtures.ts";
import { mockControl } from "../lib/mock/backend.ts";
import { arrivedKeys, auditHref, evidenceStatus, groupTasks, sovTotal, taskAmount, taskKey } from "../lib/queue.ts";
import type { Evidence, InspectorTask, SovLine } from "../lib/types.ts";

beforeEach(() => {
  mockControl.reset();
  mockControl.setLatency(0);
});

const line = (code: string, amount: string, evidence: SovLine["evidence"] = []): SovLine => ({
  code,
  title: code,
  amount,
  trade: "general",
  evidence,
  visualCriteria: [],
});
const file = (id: string, kind: Evidence["kind"]): Evidence => ({
  id,
  kind,
  filename: `${id}.jpg`,
  mimeType: "image/jpeg",
  uri: "",
  sha256: "00",
  meta: {},
  uploadedAt: "2026-10-25T10:00:00Z",
});

describe("groupTasks", () => {
  it("Dana: two audits due + one pre-visit; Maple M3 (escrowed) is assigned but not due", async () => {
    const g = groupTasks(await api.getQueue(ADDR.dana));
    assert.deepEqual(
      g.audit.map((t) => t.milestone?.id),
      ["maple-st-duplex:m1", "maple-st-duplex:m2"],
    );
    assert.equal(g.pre_visit.length, 1);
    assert.equal(g.pre_visit[0]?.milestone, undefined);
    assert.equal(g.re_audit.length, 0);
    assert.ok(g.none.some((t) => t.milestone?.id === "maple-st-duplex:m3"));
  });

  it("Marcus: the failed Rhinebeck milestone is a re-audit with his prior audit attached", async () => {
    const g = groupTasks(await api.getQueue(ADDR.marcus));
    assert.equal(g.re_audit.length, 1);
    assert.equal(g.re_audit[0]?.milestone?.id, "rhinebeck-farmhouse:m1");
    assert.ok(g.re_audit[0]!.priorAudits.some((a) => a.inspector === ADDR.marcus));
  });

  it("orders by soonest escrow expiry, then project", async () => {
    const tasks = await api.getQueue(ADDR.dana);
    const shuffled = [...tasks].reverse();
    assert.deepEqual(groupTasks(shuffled).audit.map(taskKey), groupTasks(tasks).audit.map(taskKey));
    const [first, second] = groupTasks(tasks).audit;
    assert.ok(Date.parse(first!.milestone!.cancelAfter!) < Date.parse(second!.milestone!.cancelAfter!));
  });
});

describe("evidenceStatus", () => {
  it("bar per kind is the largest minCount across SoV lines (verifier's required_evidence_present rule)", () => {
    const sov = [
      line("a", "1.00", [{ kind: "photo", description: "", minCount: 2 }]),
      line("b", "1.00", [
        { kind: "photo", description: "", minCount: 1 },
        { kind: "invoice", description: "", minCount: 1 },
      ]),
    ];
    assert.deepEqual(evidenceStatus({ sov, evidence: [] }), {
      kinds: [
        { kind: "photo", need: 2, have: 0 },
        { kind: "invoice", need: 1, have: 0 },
      ],
      uploaded: 0,
      state: "none",
    });
    const some = evidenceStatus({ sov, evidence: [file("p1", "photo"), file("i1", "invoice")] });
    assert.equal(some.state, "partial");
    const all = evidenceStatus({ sov, evidence: [file("p1", "photo"), file("p2", "photo"), file("i1", "invoice")] });
    assert.equal(all.state, "complete");
  });

  it("the demo's audit-due milestones have complete builder evidence", async () => {
    for (const t of groupTasks(await api.getQueue(ADDR.dana)).audit) assert.equal(evidenceStatus(t).state, "complete", taskKey(t));
  });
});

describe("amounts", () => {
  it("sovTotal adds decimal strings exactly", () => {
    assert.equal(sovTotal({ sov: [line("a", "0.10"), line("b", "0.20"), line("c", "120000")] }), "120000.30");
  });

  it("a milestone task shows the milestone amount, a pre-visit the SoV total", async () => {
    const g = groupTasks(await api.getQueue(ADDR.dana));
    assert.equal(taskAmount(g.audit[0]!), g.audit[0]!.milestone!.amount);
    assert.equal(taskAmount(g.pre_visit[0]!), sovTotal(g.pre_visit[0]!));
  });
});

describe("arrivedKeys", () => {
  it("nothing is new on the first load; actionable tasks absent last poll are", async () => {
    const tasks = await api.getQueue(ADDR.dana);
    assert.equal(arrivedKeys(null, tasks).size, 0);
    const [dropped, ...rest] = groupTasks(tasks).audit;
    const before: InspectorTask[] = tasks.filter((t) => taskKey(t) !== taskKey(dropped!));
    assert.deepEqual([...arrivedKeys(before, tasks)], [taskKey(dropped!)]);
    assert.ok(rest.every((t) => !arrivedKeys(before, tasks).has(taskKey(t))));
  });

  it("a task flipping from none → audit counts as arrived", async () => {
    const tasks = await api.getQueue(ADDR.dana);
    const target = groupTasks(tasks).audit[0]!;
    const before = tasks.map((t) => (taskKey(t) === taskKey(target) ? { ...t, needs: "none" as const } : t));
    assert.deepEqual([...arrivedKeys(before, tasks)], [taskKey(target)]);
  });
});

describe("auditHref", () => {
  it("links audit + re-audit tasks to the form (ids URL-encoded); pre-visits and nothing-due tasks have no form", async () => {
    const g = groupTasks(await api.getQueue(ADDR.dana));
    assert.equal(auditHref(g.audit[0]!), "/audit/maple-st-duplex/maple-st-duplex%3Am1");
    assert.equal(auditHref(g.pre_visit[0]!), null);
    assert.equal(auditHref(g.none[0]!), null);
    assert.ok(auditHref(groupTasks(await api.getQueue(ADDR.marcus)).re_audit[0]!));
  });
});
