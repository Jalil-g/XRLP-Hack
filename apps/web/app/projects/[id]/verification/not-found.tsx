import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <section className="max-w-[640px] space-y-5 py-6">
      <h1 className="text-heading">Project not found</h1>
      <p className="text-body text-ink-2">It may have been removed by a demo reset.</p>
      <Link href="/builder" className={buttonClass("secondary", "lg")}>
        Builder workspace
      </Link>
    </section>
  );
}
