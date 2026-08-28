import { lookup as nodeLookup, type LookupAddress, type LookupOptions } from "node:dns";

import { ADDRESS_REJECTION_EXPLANATIONS, checkResolvedAddress } from "@/lib/operations/address";

/** Marker-free Node core shared by server routes and the standalone worker. */
export class BlockedAddressError extends Error {
  readonly code = "EBLOCKEDADDRESS";

  constructor(hostname: string, address: string, detail: string) {
    super(`${hostname} resolved to ${address}. ${detail}`);
    this.name = "BlockedAddressError";
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/** Resolve every answer and hand only the exact checked address to undici. */
export function guardedLookup(
  hostname: string,
  options: LookupOptions | number | LookupCallback,
  callback?: LookupCallback,
): void {
  const resolvedCallback = (typeof options === "function" ? options : callback) as LookupCallback;
  const resolvedOptions = typeof options === "function" ? {} : options;
  const normalizedOptions: LookupOptions =
    typeof resolvedOptions === "number"
      ? { family: resolvedOptions, all: true }
      : { ...(resolvedOptions as LookupOptions), all: true };

  nodeLookup(hostname, normalizedOptions, (error, addresses) => {
    if (error) {
      resolvedCallback(error, "");
      return;
    }

    const candidates = (Array.isArray(addresses) ? addresses : [addresses]) as LookupAddress[];
    const allowed: LookupAddress[] = [];
    let firstRejection: string | null = null;
    let firstBlocked: string | null = null;

    for (const candidate of candidates) {
      const check = checkResolvedAddress(candidate.address, candidate.family);
      if (check.allowed) {
        allowed.push(candidate);
        continue;
      }
      if (firstRejection === null && check.rejection !== null) {
        firstRejection = ADDRESS_REJECTION_EXPLANATIONS[check.rejection];
        firstBlocked = candidate.address;
      }
    }

    if (firstRejection !== null) {
      const blocked = new BlockedAddressError(hostname, firstBlocked ?? "an address", firstRejection);
      resolvedCallback(blocked as NodeJS.ErrnoException, "");
      return;
    }
    if (allowed.length === 0) {
      const empty = new Error(`${hostname} did not resolve to any address.`) as NodeJS.ErrnoException;
      empty.code = "ENOTFOUND";
      resolvedCallback(empty, "");
      return;
    }

    const wantsAll = typeof resolvedOptions === "object" && resolvedOptions.all === true;
    if (wantsAll) {
      resolvedCallback(null, allowed);
      return;
    }
    const first = allowed[0] as LookupAddress;
    resolvedCallback(null, first.address, first.family);
  });
}
