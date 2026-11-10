import { guessVendorFromMac } from "./mac-vendor-lookup";

describe("guessVendorFromMac", () => {
  it("matches a known NETGEAR OUI regardless of case", () => {
    expect(guessVendorFromMac("a0:40:a0:11:22:33")).toBe("NETGEAR");
    expect(guessVendorFromMac("A0:40:A0:11:22:33")).toBe("NETGEAR");
  });

  it("returns undefined for an unrecognized prefix rather than guessing", () => {
    expect(guessVendorFromMac("ff:ff:ff:11:22:33")).toBeUndefined();
  });
});
