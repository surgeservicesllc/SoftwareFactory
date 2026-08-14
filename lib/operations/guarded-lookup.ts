import "server-only";

import { lookup as nodeLookup, type LookupAddress, type LookupOptions } from "node:dns";

import { ADDRESS_REJECTION_EXPLANATIONS, checkResolvedAddress } from "@/lib/operations/address";

/**
 * A DNS lookup that refuses to hand back a private address.
 *
 * Why this shape rather than "resolve, check, then fetch": resolving separately
 * leaves a window. The name can answer with a public address for our check and
 * a private one for the connection that follows — that is DNS rebinding, and it
 * is the whole attack. Checking a resolution we then throw away proves nothing
 * about the address the socket actually reaches.
 *
 * Passing this as undici's `connect.lookup` closes the window instead of
 * narrowing it, because the address this function returns is the exact address
 * the socket connects to. There is no second resolution to disagree with the
 * first.
 *
 * It is deliberately a *lookup*, not an allowlist of hosts: the operator still
 * chooses the target, and `validateMonitorTarget` still governs which URLs may
 * be stored at all. This guards the one thing that validation cannot see.
 */

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

/**
 * Node's `dns.lookup` signature, with every resolved address checked.
 *
 * A single blocked answer fails the whole lookup, even when a public address
 * was offered alongside it. Filtering to the public one was the first instinct
 * and is wrong: a hostname answering with both is a rebinding setup, and
 * connecting to the acceptable half would be luck rather than a control.
 */
export function guardedLookup(
  hostname: string,
  options: LookupOptions | number | LookupCallback,
  callback?: LookupCallback,
): void {
  const resolvedCallback = (typeof options === "function" ? options : callback) as LookupCallback;
  const resolvedOptions = typeof options === "function" ? {} : options;

  // Always resolve every answer, whatever the caller asked for. Checking only
  // the first address would let a hostname hide a private one behind a public
  // one, which is exactly the setup this guards against.
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

    // Any blocked answer fails the lookup, even when a public one was also
    // offered. Picking the public one would be choosing not to look.
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
