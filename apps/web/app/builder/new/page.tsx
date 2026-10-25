import Link from "next/link";
import { NewProjectForm } from "@/components/builder/new-project-form";
import { Empty, PageHeader } from "@/components/ui/layout";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "New project" };

export default async function NewProjectPage() {
  const session = await getSession();
  const builder = session.builder;
  if (!builder) return <Empty title="No builder accounts">Core did not return any builders.</Empty>;
  return (
    <div className="space-y-10">
      <div>
        <Link href="/builder" className="text-caption text-ink-2 hover:text-ink">
          {builder.name}
        </Link>
        <PageHeader
          className="mt-2"
          title="New project"
          description="Start from a template Schedule of Values (AIA G703). Each milestone's money is released only when that milestone passes its checks."
        />
      </div>
      <NewProjectForm builderId={builder.id} builderName={builder.name} />
    </div>
  );
}
