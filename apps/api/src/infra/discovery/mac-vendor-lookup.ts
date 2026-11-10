/**
 * A small, curated set of IEEE OUI (MAC address prefix) → vendor
 * mappings for the vendors most likely to turn up in a homelab. This is
 * a *hint*, not an identification — plenty of real devices from these
 * vendors won't be covered, and nothing here is the "right" way to lock
 * in whether a device really is what it looks like (the real IEEE OUI
 * registry has tens of thousands of entries; TRACE doesn't ship a copy
 * of it). `discovery-scan.service.ts` always labels this
 * `vendorGuess`, never a confirmed `manufacturer`.
 */
const OUI_VENDOR_MAP: Record<string, string> = {
  "00:09:5B": "NETGEAR", "00:0F:B5": "NETGEAR", "00:14:6C": "NETGEAR",
  "00:1B:2F": "NETGEAR", "00:1E:2A": "NETGEAR", "00:1F:33": "NETGEAR",
  "00:22:3F": "NETGEAR", "00:24:B2": "NETGEAR", "00:26:F2": "NETGEAR",
  "20:4E:7F": "NETGEAR", "2C:B0:5D": "NETGEAR", "30:46:9A": "NETGEAR",
  "A0:40:A0": "NETGEAR", "C0:3F:0E": "NETGEAR", "E0:46:9A": "NETGEAR",
  "B0:39:56": "NETGEAR", "9C:3D:CF": "NETGEAR",
  "00:1A:11": "Google", "F4:F5:D8": "Google", "54:60:09": "Google",
  "DC:A6:32": "Raspberry Pi Foundation", "B8:27:EB": "Raspberry Pi Foundation", "D8:3A:DD": "Raspberry Pi Foundation",
  "00:50:56": "VMware", "00:0C:29": "VMware", "00:1C:14": "VMware",
  "BC:24:11": "Proxmox VE (QEMU guest)",
  "08:00:27": "VirtualBox",
  "00:1D:D8": "Microsoft", "00:15:5D": "Microsoft (Hyper-V)",
  "FC:EC:DA": "Ubiquiti", "24:A4:3C": "Ubiquiti", "78:8A:20": "Ubiquiti",
  "DC:9F:DB": "Apple", "A4:83:E7": "Apple", "F0:18:98": "Apple",
  "00:1A:79": "Belkin", "94:10:3E": "Belkin",
  "D4:CA:6D": "ASUSTek", "1C:B7:2C": "ASUSTek", "2C:FD:A1": "ASUSTek",
  "90:9A:4A": "Bambu Lab",
};

export function guessVendorFromMac(mac: string): string | undefined {
  const normalized = mac
    .split(":")
    .map((part) => part.padStart(2, "0").toUpperCase())
    .slice(0, 3)
    .join(":");
  return OUI_VENDOR_MAP[normalized];
}
