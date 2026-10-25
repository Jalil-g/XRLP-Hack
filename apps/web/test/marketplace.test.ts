import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProjectSummary, ProjectStatus, ProjectType } from "../lib/contract.ts";
import { fundingCountdown, marketplaceProjects, parseProjectType } from "../lib/marketplace.ts";

function project(id: string, status: ProjectStatus, type: ProjectType, verified = true): ProjectSummary {
  return {
    id,
    name: id,
    type,
    status,
    siteAddress: "Brooklyn, NY",
    principal: "100000.00",
    raised: "50000.00",
    investorCount: 2,
    builderName: "Builder",
    fundingDeadline: "2026-10-30T12:00:00.000Z",
    verified,
  };
}

test("marketplace retains verified projects through every post-verification lifecycle state", () => {
  const listed = marketplaceProjects([
    project("verified", "verified", "residential_new"),
    project("funding", "funding", "residential_renovation"),
    project("escrowed", "escrowed", "commercial_small"),
    project("completed", "completed", "residential_new"),
    project("rejected", "rejected", "residential_new", false),
    project("draft", "draft", "residential_new", false),
  ]);
  assert.deepEqual(listed.map(({ id }) => id), ["verified", "funding", "escrowed", "completed"]);
});

test("project-type parsing and filtering accept only known single values", () => {
  assert.equal(parseProjectType("residential_new"), "residential_new");
  assert.equal(parseProjectType(["commercial_small", "residential_new"]), "commercial_small");
  assert.equal(parseProjectType("unknown"), undefined);
  const projects = [project("a", "funding", "residential_new"), project("b", "funding", "commercial_small")];
  assert.deepEqual(marketplaceProjects(projects, "commercial_small").map(({ id }) => id), ["b"]);
});

test("funding countdown is deterministic at minute, hour, day, closed, and invalid boundaries", () => {
  const now = Date.parse("2026-10-25T12:00:00.000Z");
  assert.equal(fundingCountdown("2026-10-25T12:00:01.000Z", now), "Closes in 1m");
  assert.equal(fundingCountdown("2026-10-25T14:15:00.000Z", now), "Closes in 2h 15m");
  assert.equal(fundingCountdown("2026-10-27T15:00:00.000Z", now), "Closes in 2d 3h");
  assert.equal(fundingCountdown("2026-10-25T12:00:00.000Z", now), "Funding closed");
  assert.equal(fundingCountdown("not-a-date", now), "Funding deadline unavailable");
});
