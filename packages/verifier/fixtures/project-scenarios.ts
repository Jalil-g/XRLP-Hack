import type { BuilderDocument } from "@xrlp/shared";
import type { VerifyProjectInput } from "../src/verifyProject.ts";
import { builder, FIX, project } from "./scenarios.ts";

const documents: BuilderDocument[] = [
  { kind: "license", filename: "license.txt", fields: { licenseNumber: builder.licenseNumber, holder: builder.name, expires: "2027-06-30" } },
  { kind: "insurance", filename: "insurance.txt", fields: { policyNumber: builder.insurancePolicy, insured: builder.name, generalLiability: "2000000", expires: "2027-03-31" } },
  { kind: "entity", filename: "entity-MOCK.json", fields: { legalName: builder.name } },
  { kind: "permit", filename: "permit-MOCK.json", fields: { status: "approved", permitId: "MOCK-B-0099341" } },
  { kind: "plans", filename: "plans-MOCK.json", fields: { status: "complete", revision: "MOCK-1" } },
];

export function projectInput(key = "project-pass"): VerifyProjectInput {
  const input: VerifyProjectInput = { project: structuredClone(project), builder: structuredClone(builder), sov: structuredClone(project.sov!), documents: structuredClone(documents), history: { openProjects: 1, priorMilestones: 18, passedMilestones: 17 }, now: FIX.times.now, mode: "mock" };
  if (key === "project-expired-insurance") input.documents[1]!.fields!.expires = "2025-01-01";
  else if (key === "project-over-market") {
    input.sov.find((line) => line.code === "F-01")!.amount = "20000.00";
    input.sov.find((line) => line.code === "FN-01")!.amount = "15000.00";
    input.project.sov = structuredClone(input.sov);
  } else if (key !== "project-pass") throw new Error(`Unknown project fixture ${key}`);
  return input;
}
