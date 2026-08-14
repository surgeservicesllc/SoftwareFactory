/**
 * Whether a resolved IP address may be probed.
 *
 * `target.ts` rejects a *hostname* that is obviously private. That is not
 * enough on its own: a perfectly public-looking hostname can resolve to
 * `127.0.0.1`, `169.254.169.254`, or an address inside the deployment's own
 * network. Checking the name only catches the careless case, not the
 * deliberate one.
 *
 * This module checks the address that was actually resolved, so it is the half
 * that holds against a hostile operator rather than a mistaken one.
 */

export type AddressRejection =
  | "LOOPBACK"
  | "PRIVATE"
  | "LINK_LOCAL_OR_METADATA"
  | "CARRIER_GRADE_NAT"
  | "UNSPECIFIED_OR_RESERVED"
  | "UNIQUE_LOCAL"
  | "UNPARSEABLE";

export interface AddressCheck {
  readonly allowed: boolean;
  readonly rejection: AddressRejection | null;
}

const ALLOWED: AddressCheck = Object.freeze({ allowed: true, rejection: null });

function reject(rejection: AddressRejection): AddressCheck {
  return Object.freeze({ allowed: false, rejection });
}

function checkIpv4(address: string): AddressCheck {
  const parts = address.split(".");
  if (parts.length !== 4) return reject("UNPARSEABLE");

  const octets: number[] = [];
  for (const part of parts) {
    // Reject anything that is not a plain decimal octet. `Number("0x7f")` and
    // `Number(" 10")` both parse, and both are ways of writing an address that
    // a naive check would wave through.
    if (!/^\d{1,3}$/.test(part)) return reject("UNPARSEABLE");
    const octet = Number(part);
    if (octet > 255) return reject("UNPARSEABLE");
    octets.push(octet);
  }

  const [first, second] = octets as [number, number, number, number];

  if (first === 127) return reject("LOOPBACK");
  if (first === 0) return reject("UNSPECIFIED_OR_RESERVED");
  if (first === 10) return reject("PRIVATE");
  if (first === 172 && second >= 16 && second <= 31) return reject("PRIVATE");
  if (first === 192 && second === 168) return reject("PRIVATE");
  // 169.254.0.0/16 covers link-local and, importantly, 169.254.169.254 — the
  // cloud instance metadata endpoint on every major provider.
  if (first === 169 && second === 254) return reject("LINK_LOCAL_OR_METADATA");
  if (first === 100 && second >= 64 && second <= 127) return reject("CARRIER_GRADE_NAT");
  // 192.0.0.0/24, 192.0.2.0/24, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24
  if (first === 192 && second === 0) return reject("UNSPECIFIED_OR_RESERVED");
  if (first === 198 && (second === 18 || second === 19)) return reject("UNSPECIFIED_OR_RESERVED");
  if (first === 198 && second === 51) return reject("UNSPECIFIED_OR_RESERVED");
  if (first === 203 && second === 0) return reject("UNSPECIFIED_OR_RESERVED");
  // 224.0.0.0/4 multicast and 240.0.0.0/4 reserved, which includes broadcast.
  if (first >= 224) return reject("UNSPECIFIED_OR_RESERVED");

  return ALLOWED;
}

function checkIpv6(address: string): AddressCheck {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";

  // An IPv4-mapped or IPv4-compatible address carries a v4 address inside a v6
  // one. Checking only the v6 form would let ::ffff:127.0.0.1 straight through.
  const mapped = /^::(?:ffff:(?:0{1,4}:)?)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(normalized);
  if (mapped?.[1]) return checkIpv4(mapped[1]);

  // The same address can be written with the embedded v4 part in hex —
  // `::ffff:7f00:1` is `127.0.0.1`. Matching only the dotted form leaves the
  // shorter spelling as a straight bypass.
  const mappedHex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (mappedHex?.[1] && mappedHex[2]) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return checkIpv4(
      `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`,
    );
  }

  if (normalized === "::" || normalized === "::0") return reject("UNSPECIFIED_OR_RESERVED");
  if (normalized === "::1") return reject("LOOPBACK");
  // fc00::/7 unique local — the IPv6 equivalent of the private ranges.
  if (/^f[cd][0-9a-f]{2}:/.test(normalized)) return reject("UNIQUE_LOCAL");
  // fe80::/10 link-local.
  if (/^fe[89ab][0-9a-f]:/.test(normalized)) return reject("LINK_LOCAL_OR_METADATA");
  // ff00::/8 multicast.
  if (/^ff[0-9a-f]{2}:/.test(normalized)) return reject("UNSPECIFIED_OR_RESERVED");

  return ALLOWED;
}

/**
 * Check one resolved address. `family` is 4 or 6 as Node reports it; when it is
 * absent the form of the string decides.
 */
export function checkResolvedAddress(address: string, family?: number): AddressCheck {
  if (typeof address !== "string" || address.length === 0) return reject("UNPARSEABLE");
  if (family === 6 || address.includes(":")) return checkIpv6(address);
  if (family === 4 || /^\d/.test(address)) return checkIpv4(address);
  return reject("UNPARSEABLE");
}

export const ADDRESS_REJECTION_EXPLANATIONS: Record<AddressRejection, string> = {
  LOOPBACK: "The hostname resolved to a loopback address.",
  PRIVATE: "The hostname resolved to a private network address.",
  LINK_LOCAL_OR_METADATA: "The hostname resolved to a link-local or cloud metadata address.",
  CARRIER_GRADE_NAT: "The hostname resolved to a carrier-grade NAT address.",
  UNSPECIFIED_OR_RESERVED: "The hostname resolved to a reserved or unspecified address.",
  UNIQUE_LOCAL: "The hostname resolved to a unique-local address.",
  UNPARSEABLE: "The hostname resolved to an address that could not be parsed.",
};
