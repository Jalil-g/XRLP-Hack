import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[560px] py-20 text-center">
      <h1 className="text-title">Not found</h1>
      <p className="mt-3 text-body text-ink-2">That project or page does not exist.</p>
      <Link href="/" className="mt-8 inline-block text-body text-link hover:underline">
        Back to projects
      </Link>
    </div>
  );
}
