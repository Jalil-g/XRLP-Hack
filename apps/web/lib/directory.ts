import type { Builder, Party } from "./contract";

/** Keep the header usable during an outage without calling it an empty directory. */
export async function loadDirectory(source: {
  listParties(): Promise<Party[]>;
  listBuilders(): Promise<Builder[]>;
}) {
  const [parties, builders] = await Promise.allSettled([source.listParties(), source.listBuilders()]);
  return {
    parties: parties.status === "fulfilled" ? parties.value : [],
    builders: builders.status === "fulfilled" ? builders.value : [],
    directoryUnavailable: parties.status === "rejected" || builders.status === "rejected",
  };
}
