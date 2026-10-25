import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { seed } from "../../lib/mock/fixtures";
import { EvidenceReceipt } from "./evidence-receipt";

test("saved evidence receipt survives fresh renders and milestone status changes", () => {
  const { db } = seed();
  const project = db.projects.find((entry) => entry.id === "maple-st")!;
  const builder = db.builders.find((entry) => entry.id === project.builderId)!;
  const detail = { project, builder, evidence: db.evidence };
  const files = project.milestones.flatMap((m) => db.evidence[m.id] ?? []);
  const before = renderToStaticMarkup(<EvidenceReceipt detail={detail} />);
  assert.match(before, /aria-label="Evidence receipt"/);
  assert.match(before, new RegExp(`${files.length} files`));
  for (const file of files) assert.ok(before.includes(file.filename), `receipt lists ${file.filename}`);
  project.milestones[0]!.status = "released";
  const after = renderToStaticMarkup(<EvidenceReceipt detail={detail} />);
  assert.equal(after, before);
});

test("missing evidence is not presented as a successful submission", () => {
  const { db } = seed();
  const project = db.projects[0]!;
  const builder = db.builders.find((entry) => entry.id === project.builderId)!;
  assert.equal(renderToStaticMarkup(<EvidenceReceipt detail={{ project, builder }} />), "");
});
