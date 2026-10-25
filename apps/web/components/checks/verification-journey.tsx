import { Check, FileCheck2, Fingerprint, LockKeyhole, ScanLine, ShieldCheck } from "lucide-react";

export function VerificationJourney({ state, title, detail }: { state: "pending" | "pass" | "held"; title: string; detail: string }) {
  return <div className="verification-journey" data-state={state}>
    <div className="verification-stage" aria-hidden="true">
      <div className="verification-input"><FileCheck2 /><span>Evidence</span></div>
      <div className="verification-wire"><i /><i /><i /></div>
      <div className="verification-core"><span className="verification-ring" /><span className="verification-ring secondary" />{state === "pending" ? <Fingerprint /> : state === "pass" ? <ShieldCheck /> : <LockKeyhole />}</div>
      <div className="verification-wire reverse"><i /><i /><i /></div>
      <div className="verification-input"><FileCheck2 /><span>Signed audit</span></div>
    </div>
    <div className="verification-result" role="status"><span>{state === "pending" ? <ScanLine /> : state === "pass" ? <Check /> : <LockKeyhole />}</span><p>{title}</p></div>
    <p className="mx-auto max-w-[42ch] px-4 pb-5 text-center text-caption text-ink-2">{detail}</p>
  </div>;
}
