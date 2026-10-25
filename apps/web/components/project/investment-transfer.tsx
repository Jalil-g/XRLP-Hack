import { ArrowUpRight, Check, LockKeyhole, ShieldCheck } from "lucide-react";
import { API_MODE } from "@/lib/api";
import { formatAmount, shortAddress } from "@/lib/utils";
import styles from "./investment-transfer.module.css";

type Endpoint = { label: string; name: string; address?: string; kind: "wallet" | "vault" };

export function InvestmentTransfer({ amount, investorName, investorAddress, projectName, confirmed }: {
  amount: string; investorName: string; investorAddress: string; projectName: string; confirmed: boolean;
}) {
  return <FundsTransfer amount={amount} source={{ label: "Your wallet", name: investorName, address: investorAddress, kind: "wallet" }} destination={{ label: "Project vault", name: projectName, kind: "vault" }} confirmed={confirmed} successLabel="Deposit confirmed" note="Funds enter the project vault. The builder is paid as each milestone passes its checks." />;
}

/** An indeterminate transfer illustration. Amounts and confirmation come from the response. */
export function FundsTransfer({ amount, source, destination, confirmed, successLabel, note }: {
  amount: string; source: Endpoint; destination: Endpoint; confirmed: boolean; successLabel: string; note: string;
}) {
  return <div className={styles.transfer} data-state={confirmed ? "confirmed" : "pending"}>
    <div className={styles.theater}>
      <div className={styles.meta}><span>{API_MODE === "mock" ? "Mock transfer" : "XRPL Devnet"}</span><span>RLUSD <ArrowUpRight size={12} aria-hidden="true" /></span></div>
      <div className={styles.amount}><span className={styles.amountLabel}>{confirmed ? "Transfer received" : "Moving your capital"}</span><p>{formatAmount(amount, { cents: true })}<span>RLUSD</span></p></div>
      <div className={styles.stage} aria-hidden="true">
        <svg className={styles.floor} viewBox="0 0 500 260" preserveAspectRatio="none" fill="none">
          <ellipse cx="250" cy="188" rx="213" ry="55" stroke="#a8bd8240" />
          <ellipse cx="250" cy="188" rx="173" ry="39" stroke="#a8bd8225" />
          <path d="M37 188H463M80 166L420 211M80 211L420 166M250 133V243M140 141L360 235M360 141L140 235" stroke="#a8bd821a" />
          <path className={styles.route} d="M105 154C140 13 360 13 395 154" stroke="#d4ef94" strokeWidth="1" strokeDasharray="3 7" />
          <path className={styles.routeSecondary} d="M105 154C170 75 330 75 395 154" stroke="#a9c37e" strokeWidth="1" strokeDasharray="2 8" />
        </svg>
        <div className={`${styles.device} ${styles.source}`}><AccountSculpture kind={source.kind} /><span className={styles.pedestal} /></div>
        <div className={`${styles.device} ${styles.destination}`}><AccountSculpture kind={destination.kind} /><span className={styles.pedestal} />{confirmed && <span className={styles.arrivalRing} />}</div>
        {Array.from({ length: 7 }, (_, index) => <span key={index} className={styles.packet} style={{ animationDelay: `${index * 0.16}s` }}><span className={styles.token}>$</span></span>)}
        <div className={styles.network}><span /><span /><span /><i>XRPL</i></div>
        {confirmed && <span className={styles.received}><Check size={16} strokeWidth={3} /></span>}
      </div>
      <div className={styles.accounts}>
        <div><span>{source.label}</span><strong>{source.name}</strong>{source.address && <small title={source.address}>{shortAddress(source.address)}</small>}</div>
        <div><span>{destination.label}</span><strong>{destination.name}</strong><small>{confirmed ? "Received" : "Awaiting confirmation"}</small></div>
      </div>
    </div>
    <div className={styles.status} role="status"><span className={styles.statusIcon}>{confirmed ? <Check size={16} /> : <LockKeyhole size={15} />}</span><div><p>{confirmed ? `${API_MODE === "mock" ? "Mock · " : ""}${successLabel}` : "Waiting for confirmation"}</p><span>{confirmed ? "Your transaction receipt is ready below." : "Your request is being processed. Keep this window open."}</span></div></div>
    <p className={styles.note}><ShieldCheck size={15} aria-hidden="true" />{note}</p>
  </div>;
}

function AccountSculpture({ kind }: { kind: Endpoint["kind"] }) {
  return kind === "wallet" ? <div className={styles.wallet}><span className={styles.walletCard} /><span className={styles.walletBody}><i>DP</i><span className={styles.walletClasp}><b /></span></span></div> : <div className={styles.vault}><span className={styles.vaultSide} /><span className={styles.vaultTop} /><span className={styles.vaultDoor}><span className={styles.vaultDial}><i /><b /></span><span className={styles.vaultHandle} /></span></div>;
}
