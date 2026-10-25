"use client";

import { WorkspaceError } from "@/components/builder/workspace-state";

export default function ErrorPage({ retry }: { retry: () => void }) {
  return <WorkspaceError title="Verification report unavailable" retry={retry} />;
}
