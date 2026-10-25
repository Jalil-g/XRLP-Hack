import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[640px] py-24 text-center">
      <h1 className="text-title">Not found</h1>
      <Link href="/" className={buttonClass("primary", "md", "mt-8")}>
        Browse projects
      </Link>
    </div>
  );
}
