// Pure (offline) XLS-65/66 math for Drawproof: broker rates, first-loss cover sizing, fees, vault dates.
// No network, no wallets — unit-tested in test/lending-math.test.ts.
// Units: XLS-66 rates are in 1/10 basis points (100000 = 100%); our fee bps are plain basis points (10000 = 100%).

/** Seconds in the protocol's interest year (XLS-66 uses a 365-day year). */
export const SECONDS_PER_YEAR = 365 * 86_400;
/** 100% in 1/10 bps (XLS-66 rate unit). */
export const TENTH_BPS_ONE = 100_000;

/** LoanBroker first-loss cover: CoverAvailable must stay >= 10% of debt. */
export const COVER_RATE_MINIMUM = 10_000;
/** On default, up to 100% of the minimum cover is liquidated to the vault. */
export const COVER_RATE_LIQUIDATION = 100_000;
/** LoanBroker ManagementFeeRate: 10% of interest to the broker owner (platform). Protocol max is 10000. */
export const MANAGEMENT_FEE_RATE = 10_000;
export const MANAGEMENT_FEE_RATE_MAX = 10_000;
/** LoanOriginationFee in bps of principal: 1.5% (private construction lenders charge 1-3 points). */
export const ORIGINATION_FEE_BPS = 150;
/** Cover deposit floor as a share of principal, in bps (10%). */
export const COVER_DEPOSIT_FLOOR_BPS = 1_000;
/** Headroom over the computed protocol minimum, in bps (10%), so rounding never trips tecINSUFFICIENT_FUNDS. */
export const COVER_HEADROOM_BPS = 1_000;

/** LoanSet requires now + PaymentInterval x PaymentTotal + 60 <= RedemptionDate (66.1.2). */
export const LOANSET_REDEMPTION_MARGIN_S = 60;
/** Minimum slack between SubscriptionDate and the LoanSet that follows it. */
export const MIN_LOANSET_WINDOW_S = 60;
/** Default buffer between loan maturity and RedemptionDate for real terms. */
export const REDEMPTION_BUFFER_S = 2 * 86_400;
/** Spec minimum: RedemptionDate - SubscriptionDate >= 180s (65.1.4). */
export const MIN_INVESTMENT_PERIOD_S = 180;

// ---------------------------------------------------------------- RLUSD decimal helpers (6 dp, micro units)

const MICRO = 1_000_000n;

/** "1234.5" -> 1234500000n. Throws on more than 6 decimals or junk. */
export function toMicro(v: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(v.trim());
  if (!m) throw new Error(`not an RLUSD amount with <= 6 decimals: ${JSON.stringify(v)}`);
  return BigInt(m[1]!) * MICRO + BigInt((m[2] ?? "").padEnd(6, "0"));
}

/** 1234500000n -> "1234.5". */
export function fromMicro(n: bigint): string {
  if (n < 0n) throw new Error(`negative amount ${n}`);
  const i = n / MICRO;
  const f = (n % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  return f ? `${i}.${f}` : `${i}`;
}

const ceilMicro = (x: number) => BigInt(Math.ceil(x * 1e6 - 1e-6));

// ---------------------------------------------------------------- broker rates

export interface BrokerRates {
  coverRateMinimum: number;
  coverRateLiquidation: number;
  managementFeeRate: number;
}

/** Throws unless the rates are valid LoanBrokerSet values (both cover rates zero or both non-zero: temINVALID otherwise). */
export function validateBrokerRates(r: BrokerRates): BrokerRates {
  const int = (name: string, v: number, max: number) => {
    if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`${name} must be an integer in 0..${max} (got ${v})`);
  };
  int("CoverRateMinimum", r.coverRateMinimum, TENTH_BPS_ONE);
  int("CoverRateLiquidation", r.coverRateLiquidation, TENTH_BPS_ONE);
  int("ManagementFeeRate", r.managementFeeRate, MANAGEMENT_FEE_RATE_MAX);
  if ((r.coverRateMinimum === 0) !== (r.coverRateLiquidation === 0)) {
    throw new Error(`CoverRateMinimum and CoverRateLiquidation must be both zero or both non-zero (got ${r.coverRateMinimum}/${r.coverRateLiquidation})`);
  }
  return r;
}

// ---------------------------------------------------------------- loan schedule + interest

export interface LoanSchedule {
  paymentTotal: number;
  paymentIntervalS: number;
}

/** Same derivation as closeLoanAndCreateEscrows: N = round(termDays / intervalDays) (>= 1), interval in seconds. */
export function loanScheduleFromTerms(terms: { termDays: number; paymentIntervalDays: number }): LoanSchedule {
  return {
    paymentTotal: Math.max(1, Math.round(terms.termDays / terms.paymentIntervalDays)),
    paymentIntervalS: terms.paymentIntervalDays * 86_400,
  };
}

/**
 * Total scheduled interest of an amortized XLS-66 loan (what LoanSet books into the vault):
 * periodic rate r = InterestRate/100000 x interval/year; payment = P r / (1 - (1+r)^-N); interest = N x payment - P.
 * Devnet check (XRPL-01): P=1000, 10%/yr, 2 x 120s -> TotalValueOutstanding 1000.00057.
 */
export function expectedInterest(p: { principal: string; interestRate: number } & LoanSchedule): number {
  const P = Number(p.principal);
  const r = (p.interestRate / TENTH_BPS_ONE) * (p.paymentIntervalS / SECONDS_PER_YEAR);
  const n = p.paymentTotal;
  if (r === 0) return 0;
  const payment = (P * r) / (1 - Math.pow(1 + r, -n));
  return payment * n - P;
}

// ---------------------------------------------------------------- first-loss cover

/**
 * Protocol minimum for LoanSet to pass: CoverAvailable >= (DebtTotal + principal + interest) x CoverRateMinimum
 * (XLS-66 §3.8.5.2, tecINSUFFICIENT_FUNDS otherwise). Rounded up to 6 dp.
 */
export function minimumCover(p: { principal: string; interest: number; existingDebt?: string; coverRateMinimum?: number }): string {
  const rate = p.coverRateMinimum ?? COVER_RATE_MINIMUM;
  const debt = Number(p.existingDebt ?? "0") + Number(p.principal) + p.interest;
  return fromMicro(ceilMicro((debt * rate) / TENTH_BPS_ONE));
}

/**
 * Default platform cover deposit: max(10% of principal, protocol minimum + 10% headroom).
 * With the default 10% CoverRateMinimum the minimum term always wins (it includes interest).
 */
export function defaultCoverDeposit(p: {
  principal: string;
  interest: number;
  existingDebt?: string;
  coverRateMinimum?: number;
  floorBps?: number;
  headroomBps?: number;
}): string {
  const floor = (toMicro(p.principal) * BigInt(p.floorBps ?? COVER_DEPOSIT_FLOOR_BPS)) / 10_000n;
  const min = toMicro(minimumCover(p));
  const withHeadroom = min + (min * BigInt(p.headroomBps ?? COVER_HEADROOM_BPS) + 9_999n) / 10_000n;
  return fromMicro(withHeadroom > floor ? withHeadroom : floor);
}

// ---------------------------------------------------------------- fees

/** LoanOriginationFee = principal x bps / 10000, rounded down to 6 dp (taken from the principal at LoanSet, paid to the platform). */
export function originationFeeFor(principal: string, bps: number = ORIGINATION_FEE_BPS): string {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) throw new Error(`origination fee bps must be an integer in 0..10000 (got ${bps})`);
  return fromMicro((toMicro(principal) * BigInt(bps)) / 10_000n);
}

/** Broker management fee on the scheduled interest: interest x ManagementFeeRate / 100000. */
export function managementFeeOn(interest: number, managementFeeRate: number = MANAGEMENT_FEE_RATE): number {
  return (interest * managementFeeRate) / TENTH_BPS_ONE;
}

// ---------------------------------------------------------------- closed-ended vault dates

export interface VaultDates {
  /** Ripple-epoch seconds: last second deposits are accepted (= funding deadline). */
  subscriptionDate: number;
  /** Ripple-epoch seconds: withdrawals reopen (= maturity + buffer). */
  redemptionDate: number;
}

/** RedemptionDate = SubscriptionDate + PaymentInterval x PaymentTotal + 60 + buffer. */
export function vaultDatesFor(p: { subscriptionDate: number; bufferS?: number } & LoanSchedule): VaultDates {
  const bufferS = p.bufferS ?? REDEMPTION_BUFFER_S;
  const redemptionDate = p.subscriptionDate + p.paymentIntervalS * p.paymentTotal + LOANSET_REDEMPTION_MARGIN_S + bufferS;
  return validateVaultDates({ ...p, redemptionDate, minLoanSetWindowS: Math.min(bufferS, MIN_LOANSET_WINDOW_S) });
}

/**
 * Throws unless the dates leave room for the LoanSet: Redemption - Subscription >= 180s, and (if a schedule is given)
 * RedemptionDate >= SubscriptionDate + PaymentInterval x PaymentTotal + 60 + minLoanSetWindowS
 * (LoanSet happens after SubscriptionDate and must fit the whole schedule before RedemptionDate).
 */
export function validateVaultDates(p: VaultDates & Partial<LoanSchedule> & { minLoanSetWindowS?: number }): VaultDates {
  const { subscriptionDate: sub, redemptionDate: red } = p;
  if (!Number.isInteger(sub) || !Number.isInteger(red)) throw new Error(`vault dates must be integer Ripple-epoch seconds (got ${sub}/${red})`);
  if (red - sub < MIN_INVESTMENT_PERIOD_S) throw new Error(`RedemptionDate must be >= SubscriptionDate + ${MIN_INVESTMENT_PERIOD_S}s (got ${red - sub}s)`);
  if (p.paymentTotal != null && p.paymentIntervalS != null) {
    const window = p.minLoanSetWindowS ?? MIN_LOANSET_WINDOW_S;
    const need = sub + p.paymentIntervalS * p.paymentTotal + LOANSET_REDEMPTION_MARGIN_S + window;
    if (red < need) {
      throw new Error(
        `RedemptionDate ${red} too early for ${p.paymentTotal} x ${p.paymentIntervalS}s: needs >= ${need} ` +
          `(SubscriptionDate + schedule + ${LOANSET_REDEMPTION_MARGIN_S}s + ${window}s LoanSet window)`,
      );
    }
  }
  return { subscriptionDate: sub, redemptionDate: red };
}
