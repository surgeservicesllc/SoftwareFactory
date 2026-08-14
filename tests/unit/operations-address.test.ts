import { describe, expect, it } from "vitest";

import { checkResolvedAddress } from "@/lib/operations/address";

/**
 * The half of SSRF defence that hostname validation cannot do.
 *
 * `validateMonitorTarget` rejects an obviously private *name*. A hostname is
 * not an address, so these cover what a name can resolve to — including the
 * encodings that exist specifically to slip past a naive check.
 */

describe("resolved address checks", () => {
  it("blocks loopback in both families, including the IPv4-mapped form", () => {
    expect(checkResolvedAddress("127.0.0.1").rejection).toBe("LOOPBACK");
    expect(checkResolvedAddress("127.255.255.254").rejection).toBe("LOOPBACK");
    expect(checkResolvedAddress("::1", 6).rejection).toBe("LOOPBACK");
    // The one a v6-only check waves straight through.
    expect(checkResolvedAddress("::ffff:127.0.0.1", 6).rejection).toBe("LOOPBACK");
    // The hex spelling of the same address. Matching only the dotted form
    // leaves this as a straight bypass, which is how it was written first.
    expect(checkResolvedAddress("::ffff:7f00:1", 6).rejection).toBe("LOOPBACK");
    expect(checkResolvedAddress("::ffff:a00:1", 6).rejection).toBe("PRIVATE");
    expect(checkResolvedAddress("::ffff:a9fe:a9fe", 6).rejection).toBe("LINK_LOCAL_OR_METADATA");
    // A genuinely public address in the same shape must still pass.
    expect(checkResolvedAddress("::ffff:808:808", 6).allowed).toBe(true);
  });

  it("blocks the cloud metadata address every provider shares", () => {
    expect(checkResolvedAddress("169.254.169.254").rejection).toBe("LINK_LOCAL_OR_METADATA");
    expect(checkResolvedAddress("169.254.170.2").rejection).toBe("LINK_LOCAL_OR_METADATA");
    expect(checkResolvedAddress("fe80::1", 6).rejection).toBe("LINK_LOCAL_OR_METADATA");
  });

  it("blocks every private IPv4 range and IPv6 unique-local", () => {
    for (const address of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1"]) {
      expect(checkResolvedAddress(address).rejection, address).toBe("PRIVATE");
    }
    expect(checkResolvedAddress("fd00::1", 6).rejection).toBe("UNIQUE_LOCAL");
    expect(checkResolvedAddress("fc00::1", 6).rejection).toBe("UNIQUE_LOCAL");
  });

  it("allows the public addresses just outside those ranges", () => {
    // Boundary cases, because an off-by-one here silently blocks real targets.
    expect(checkResolvedAddress("172.15.255.255").allowed).toBe(true);
    expect(checkResolvedAddress("172.32.0.1").allowed).toBe(true);
    expect(checkResolvedAddress("192.167.1.1").allowed).toBe(true);
    expect(checkResolvedAddress("11.0.0.1").allowed).toBe(true);
    expect(checkResolvedAddress("100.63.255.255").allowed).toBe(true);
    expect(checkResolvedAddress("100.128.0.1").allowed).toBe(true);
    expect(checkResolvedAddress("8.8.8.8").allowed).toBe(true);
    expect(checkResolvedAddress("2606:4700::1111", 6).allowed).toBe(true);
  });

  it("blocks carrier-grade NAT, which is neither public nor obviously private", () => {
    expect(checkResolvedAddress("100.64.0.1").rejection).toBe("CARRIER_GRADE_NAT");
    expect(checkResolvedAddress("100.127.255.255").rejection).toBe("CARRIER_GRADE_NAT");
  });

  it("refuses an address written to look like something else", () => {
    // `Number()` accepts all of these, so a check built on it would pass them.
    expect(checkResolvedAddress("0x7f.0.0.1").rejection).toBe("UNPARSEABLE");
    expect(checkResolvedAddress(" 10.0.0.1").rejection).toBe("UNPARSEABLE");
    expect(checkResolvedAddress("010.0.0.1").allowed).toBe(false);
    expect(checkResolvedAddress("2130706433").rejection).toBe("UNPARSEABLE");
    expect(checkResolvedAddress("127.1").rejection).toBe("UNPARSEABLE");
    expect(checkResolvedAddress("999.0.0.1").rejection).toBe("UNPARSEABLE");
    expect(checkResolvedAddress("").rejection).toBe("UNPARSEABLE");
  });

  it("blocks the unspecified, multicast and reserved space", () => {
    expect(checkResolvedAddress("0.0.0.0").rejection).toBe("UNSPECIFIED_OR_RESERVED");
    expect(checkResolvedAddress("224.0.0.1").rejection).toBe("UNSPECIFIED_OR_RESERVED");
    expect(checkResolvedAddress("255.255.255.255").rejection).toBe("UNSPECIFIED_OR_RESERVED");
    expect(checkResolvedAddress("::", 6).rejection).toBe("UNSPECIFIED_OR_RESERVED");
    expect(checkResolvedAddress("ff02::1", 6).rejection).toBe("UNSPECIFIED_OR_RESERVED");
  });

  it("strips a zone index rather than being defeated by one", () => {
    expect(checkResolvedAddress("fe80::1%eth0", 6).rejection).toBe("LINK_LOCAL_OR_METADATA");
    expect(checkResolvedAddress("[::1]", 6).rejection).toBe("LOOPBACK");
  });
});
