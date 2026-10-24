// Small pure helpers: money (integer cents, never floats), geo distance, formatting.

/** "25000.00" -> 2500000n cents. Accepts up to 6 decimals (Rlusd), truncates to cents. */
export function toCents(amount: string): bigint {
  const clean = amount.replace(/[,\s$]/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(clean);
  if (!m) throw new Error(`not a decimal amount: ${amount}`);
  const whole = BigInt(m[1]!);
  const frac = (m[2] ?? "").padEnd(2, "0").slice(0, 2);
  return whole * 100n + BigInt(frac);
}

export function centsToString(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const s = `${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** Human money: 25000.00 -> "25,000.00 RLUSD". */
export function fmtMoney(amount: string | bigint): string {
  const s = typeof amount === "bigint" ? centsToString(amount) : amount;
  const [w, f = "00"] = s.split(".");
  return `${w!.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${f.padEnd(2, "0").slice(0, 2)} RLUSD`;
}

/** ratio a/b as a percentage with one decimal, computed on cents. */
export function pct(a: bigint, b: bigint): number {
  if (b === 0n) return 0;
  return Number((a * 10000n) / b) / 100;
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function fmtDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

export function fmtDate(iso: string): string {
  return iso.replace("T", " ").replace(/:\d{2}(\.\d+)?Z$/, " UTC");
}

export const DAY_MS = 86_400_000;

export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "a, b and c" */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,'"]/g, "")
    .replace(/\b(llc|inc|corp|co|ltd|company)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
