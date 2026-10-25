import { ArrowRight, Check, ShieldCheck, Vault, Wallet } from "lucide-react";
import { API_MODE } from "@/lib/api";
import { formatAmount, shortAddress } from "@/lib/utils";
import styles from "./investment-transfer.module.css";

/** Motion illustrates the request; only the API response confirms the deposit. */
export function InvestmentTransfer({ amount, investorName, investorAddress, projectName, confirmed }: {
  amount: string;
  investorName: string;
  investorAddress: string;
  projectName: string;
  confirmed: boolean;
}) {
  return (
    <div className={styles.transfer} data-state={confirmed ? "confirmed" : "pending"}>
      <div className={styles.amount}>
        <p className="tabular text-display">{formatAmount(amount, { cents: true })}</p>
        <p className="mt-1 text-small text-ink-2">RLUSD</p>
      </div>

      <div className={styles.scene}>
        <div className={styles.path} aria-hidden="true">
          <span className={styles.line} />
          {[0, 1, 2, 3].map((packet) => (
            <span key={packet} className={styles.coin} style={{ animationDelay: `${packet * 0.22}s` }}>$</span>
          ))}
        </div>
        <div className={styles.endpoint}>
          <div className={styles.wallet}><Wallet aria-hidden="true" /></div>
          <p className="mt-3 text-small font-medium">Your wallet</p>
          <p className="mt-1 break-words text-caption text-ink-2">{investorName}</p>
          <p className="mt-1 font-mono text-[11px] text-ink-2" title={investorAddress}>{shortAddress(investorAddress)}</p>
        </div>
        <div className={styles.endpoint}>
          <div className={`${styles.wallet} ${styles.vault}`}>
            <Vault aria-hidden="true" />
            {confirmed && <span className={styles.received}><Check aria-hidden="true" /></span>}
          </div>
          <p className="mt-3 text-small font-medium">Project vault</p>
          <p className="mt-1 break-words text-caption text-ink-2">{projectName}</p>
          <p className="mt-1 text-caption text-ink-2">{confirmed ? "Deposit received" : "Awaiting deposit"}</p>
        </div>
      </div>

      <p role="status" className={styles.status}>
        {confirmed ? <Check className="size-4" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
        {confirmed ? (API_MODE === "mock" ? "Mock deposit confirmed" : "Deposit confirmed") : "Waiting for deposit confirmation…"}
      </p>
      <p className="mt-4 flex items-start gap-2 text-caption text-ink-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Funds enter the project vault. The builder is paid as each milestone passes its checks.
      </p>
    </div>
  );
}
