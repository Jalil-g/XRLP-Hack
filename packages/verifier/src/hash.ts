import { createHash } from "node:crypto";
import { Verdict } from "@xrlp/shared";

/** Canonical JSON: recursive sorted object keys, preserved array order, normal JSON primitives. */
export function canonicalJson(value: unknown): string {
  const active = new Set<object>();
  const encode = (v: unknown): string => {
    if (v === null) return "null";
    if (typeof v === "string" || typeof v === "boolean") return JSON.stringify(v);
    if (typeof v === "number" && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== "object" || v === null) throw new Error("Canonical JSON requires finite JSON data.");
    if (active.has(v)) throw new Error("Canonical JSON cannot encode cycles.");
    active.add(v);
    let result: string;
    if (Array.isArray(v)) result = `[${v.map((item) => item === undefined ? "null" : encode(item)).join(",")}]`;
    else {
      if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error("Canonical JSON requires plain objects.");
      const o = v as Record<string, unknown>;
      result = `{${Object.keys(o).filter((key) => o[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${encode(o[key])}`).join(",")}}`;
    }
    active.delete(v);
    return result;
  };
  return encode(value);
}

/** Hash the validated complete verdict, including its timestamp; never hash a placeholder. */
export function verdictHash(verdict: Verdict): string {
  return createHash("sha256").update(canonicalJson(Verdict.parse(verdict))).digest("hex");
}
