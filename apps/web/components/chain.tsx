// On-chain display atoms. In mock mode hashes are fake: shown, never linked.
import { ArrowUpRight } from "lucide-react";
import { explorerTxUrl } from "@xrlp/shared";
import { API_MODE } from "@/lib/api";
import { cn, explorerAccountUrl, shortAddress, shortHash } from "@/lib/utils";

export function TxLink({ hash, label, className }: { hash: string; label?: string; className?: string }) {
  const text = label ?? shortHash(hash);
  if (API_MODE === "mock") {
    return (
      <span title={`Mock transaction ${hash}: not on the ledger`} className={cn("font-mono text-[12px] text-ink-2", className)}>
        {text}
      </span>
    );
  }
  return (
    <a
      href={explorerTxUrl(hash)}
      target="_blank"
      rel="noreferrer"
      title={`Open ${hash} on the XRPL devnet explorer`}
      className={cn("inline-flex items-center gap-0.5 font-mono text-[12px] text-link hover:underline", className)}
    >
      {text}
      <ArrowUpRight className="size-3" aria-hidden />
    </a>
  );
}

export function Address({ address, className }: { address: string; className?: string }) {
  if (API_MODE === "mock") {
    return (
      <span title={`${address} (mock account)`} className={cn("font-mono text-[12px] text-ink-2", className)}>
        {shortAddress(address)}
      </span>
    );
  }
  return (
    <a href={explorerAccountUrl(address)} target="_blank" rel="noreferrer" title={address} className={cn("font-mono text-[12px] text-link hover:underline", className)}>
      {shortAddress(address)}
    </a>
  );
}
