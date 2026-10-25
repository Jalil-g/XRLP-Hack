// The verifier's demo evidence for Maple St, per milestone (served by app/fixture-files). File names only; the
// checks decide what they mean. IMG_5121.jpg in framing is the photo reused from Oak Ave.
import type { EvidenceKind } from "./contract";

export type FixtureFile = { path: string; kind: EvidenceKind };

export const fixtureUrl = (p: string) => `/fixture-files/${p}`;

const f = (p: string): FixtureFile => ({
  path: p,
  kind: /\.(jpe?g|png)$/i.test(p) ? "photo" : /invoice/i.test(p) ? "invoice" : "document",
});

/** Index = milestone index on the Maple St project. */
export const MAPLE_FIXTURE_SETS: FixtureFile[][] = [
  [
    f("maple-st/foundation/foundation-01-wide.jpg"),
    f("maple-st/foundation/foundation-02-bolts.jpg"),
    f("maple-st/foundation/foundation-03-walls.jpg"),
    f("maple-st/foundation/invoice_GRM-24117.txt"),
    f("maple-st/foundation/footing_inspection.txt"),
  ],
  [
    f("maple-st/framing/framing-01-wide.jpg"),
    f("maple-st/framing/framing-02-corner.jpg"),
    f("maple-st/framing/framing-03-wall.jpg"),
    f("maple-st/framing/IMG_5121.jpg"),
    f("maple-st/framing/invoice_BLS-88310.txt"),
  ],
];

export const AUDIT_PHOTOS = {
  foundation: ["maple-st/audits/photos/audit-foundation-01-rebar.jpg", "maple-st/audits/photos/audit-foundation-02-site.jpg"],
  framing: ["maple-st/audits/photos/audit-framing-01-frame.jpg"],
};

export const OAK_AVE_ORIGINAL = "oak-ave/framing/oak-ave-framing.jpg";
