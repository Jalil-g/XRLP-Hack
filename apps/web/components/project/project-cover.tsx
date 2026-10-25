import { Building2 } from "lucide-react";

export function ProjectCover({ name, address }: { name: string; address: string }) {
  return <div className="relative flex min-h-48 flex-col justify-end overflow-hidden rounded-md bg-[#ded5c5] p-5 text-[#163c35]"><Building2 aria-hidden className="absolute right-4 top-4 size-24 opacity-20" strokeWidth={1} /><span className="relative text-[20px] leading-7 font-medium">{name}</span><span className="relative mt-1 text-small">{address}</span></div>;
}
