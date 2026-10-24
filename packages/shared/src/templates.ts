// Standard milestone templates. Builders pick a template; they cannot define "done" themselves.
import type { ProjectType } from "./domain.ts";

export interface MilestoneTemplate {
  key: string;
  title: string;
  /** Share of principal, 0..1. Template shares sum to 1. */
  defaultShare: number;
  requiredEvidence: { kind: "photo" | "invoice" | "document"; description: string; minCount: number }[];
  /** What the AI should look for in photos (fed to the verifier prompt). */
  visualCriteria: string[];
}

export const MILESTONE_TEMPLATES: Record<ProjectType, MilestoneTemplate[]> = {
  residential_new: [
    {
      key: "foundation",
      title: "Foundation",
      defaultShare: 0.25,
      requiredEvidence: [
        { kind: "photo", description: "Poured foundation / slab, wide shot + close-up", minCount: 3 },
        { kind: "invoice", description: "Concrete + rebar invoices", minCount: 1 },
        { kind: "document", description: "Footing inspection sign-off", minCount: 1 },
      ],
      visualCriteria: ["cured concrete slab or foundation walls", "anchor bolts visible", "no framing yet"],
    },
    {
      key: "framing",
      title: "Framing",
      defaultShare: 0.3,
      requiredEvidence: [
        { kind: "photo", description: "All exterior walls framed, roof trusses set", minCount: 4 },
        { kind: "invoice", description: "Lumber package invoice", minCount: 1 },
      ],
      visualCriteria: ["wall framing on all sides", "roof trusses or rafters installed", "sheathing started"],
    },
    {
      key: "dry_in",
      title: "Roof & Dry-in",
      defaultShare: 0.2,
      requiredEvidence: [
        { kind: "photo", description: "Roofing complete, windows/doors installed", minCount: 4 },
        { kind: "invoice", description: "Roofing + windows invoices", minCount: 1 },
      ],
      visualCriteria: ["roof covering installed", "windows and exterior doors installed", "house wrap"],
    },
    {
      key: "finish",
      title: "Finishes & Certificate of Occupancy",
      defaultShare: 0.25,
      requiredEvidence: [
        { kind: "photo", description: "Interior finished rooms", minCount: 5 },
        { kind: "document", description: "Certificate of occupancy", minCount: 1 },
      ],
      visualCriteria: ["drywall painted", "fixtures installed", "flooring complete"],
    },
  ],
  residential_renovation: [
    {
      key: "demo_rough",
      title: "Demolition & Rough-in",
      defaultShare: 0.4,
      requiredEvidence: [
        { kind: "photo", description: "Stripped interior, new rough plumbing/electrical", minCount: 4 },
        { kind: "invoice", description: "Trade invoices", minCount: 1 },
      ],
      visualCriteria: ["exposed studs", "new wiring or piping visible"],
    },
    {
      key: "finish",
      title: "Finishes",
      defaultShare: 0.6,
      requiredEvidence: [
        { kind: "photo", description: "Finished rooms", minCount: 5 },
        { kind: "document", description: "Final permit sign-off", minCount: 1 },
      ],
      visualCriteria: ["finished walls", "fixtures installed"],
    },
  ],
  commercial_small: [
    {
      key: "site_foundation",
      title: "Site work & Foundation",
      defaultShare: 0.3,
      requiredEvidence: [
        { kind: "photo", description: "Site graded, foundation poured", minCount: 4 },
        { kind: "document", description: "Geotech / foundation inspection", minCount: 1 },
      ],
      visualCriteria: ["graded site", "foundation"],
    },
    {
      key: "structure",
      title: "Structure & Envelope",
      defaultShare: 0.4,
      requiredEvidence: [
        { kind: "photo", description: "Structural frame + envelope", minCount: 5 },
        { kind: "invoice", description: "Steel / framing invoices", minCount: 1 },
      ],
      visualCriteria: ["structural frame complete", "envelope enclosed"],
    },
    {
      key: "fitout",
      title: "Fit-out & CO",
      defaultShare: 0.3,
      requiredEvidence: [
        { kind: "photo", description: "Interior fit-out", minCount: 5 },
        { kind: "document", description: "Certificate of occupancy", minCount: 1 },
      ],
      visualCriteria: ["interior finished"],
    },
  ],
};

/** Milestones at or above this amount (RLUSD) require two inspectors. */
export const TWO_INSPECTOR_THRESHOLD = 50_000;
