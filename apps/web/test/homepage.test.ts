// Run from apps/web: node --import ../../packages/xrpl/node_modules/tsx/dist/loader.mjs --test test/homepage.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidElement, type ReactNode } from "react";
import ProjectsPage from "../app/page.tsx";
import { api } from "../lib/api.ts";
import type { ProjectSummary } from "../lib/contract.ts";

function projectLinks(node: ReactNode): string[] {
  if (Array.isArray(node)) return node.flatMap(projectLinks);
  if (!isValidElement<{ href?: string; children?: ReactNode }>(node)) return [];
  return [
    ...(node.props.href?.startsWith("/projects/") ? [node.props.href] : []),
    ...projectLinks(node.props.children),
  ];
}

const summary = (id: string, status: ProjectSummary["status"], verified: boolean): ProjectSummary => ({
  id, name: id, status, verified,
  type: "residential_new", siteAddress: "12 Maple St, Beacon, NY",
  builderName: "Demo Builder", investorCount: 1, principal: "120000", raised: "120000",
  fundingDeadline: "2026-10-25T12:00:00Z",
});

test("homepage lists verified escrowed projects, excludes drafts, and sends no exact status filter", async (t) => {
  const projects = [summary("maple-st-duplex", "escrowed", true), summary("ready", "verified", true), summary("draft", "draft", false)];
  const list = t.mock.method(api, "listProjects", async (q?: { status?: ProjectSummary["status"] }) =>
    projects.filter((p) => !q?.status || p.status === q.status));
  const page = await ProjectsPage();
  assert.deepEqual(list.mock.calls[0]!.arguments, []);
  assert.deepEqual(projectLinks(page), ["/projects/maple-st-duplex", "/projects/ready"]);
});

test("homepage shows no project links when every summary is unverified", async (t) => {
  t.mock.method(api, "listProjects", async () => [summary("draft", "draft", false)]);
  assert.deepEqual(projectLinks(await ProjectsPage()), []);
});
