import Link from "next/link";
import { NewProjectForm } from "@/components/builder/new-project-form";
import { Empty, PageHeader } from "@/components/ui/layout";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  const session = await getSession();
  const builder = session.builder;
  if (session.directoryUnavailable) throw new Error("Builder accounts are temporarily unavailable. Try loading the project form again.");
  if (!builder) return <Empty title="No builder accounts" />;
  return (
    <div className="space-y-10">
      <div>
        <Link href="/builder" className="text-small font-medium text-ink-3 hover:text-ink">
          {builder.name}
        </Link>
        <PageHeader className="mt-1" title="New project" />
      </div>
      <NewProjectForm builderId={builder.id} builderName={builder.name} />
    </div>
  );
}
