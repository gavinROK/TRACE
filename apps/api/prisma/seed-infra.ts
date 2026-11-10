import { PrismaClient } from "@prisma/client";

/**
 * Seeds the one real environment this project was built against:
 * Gavin's actual homelab (PRODUCT_SPEC.md section 3). Every field below
 * is a fact the operator stated directly, not a guess — no IP address,
 * MAC address, credential, or live health value is invented, per
 * section 3's "Do not invent device addresses, credentials, topology
 * connections, firmware versions, or current health metrics." Every
 * device starts DISCOVERED/UNKNOWN with no management protocols until
 * real credentials are enrolled and a live check succeeds.
 *
 * Safe to re-run: every write is an upsert keyed by (environmentId, name).
 */
const prisma = new PrismaClient();

async function main() {
  const environment = await prisma.infraEnvironment.upsert({
    where: { slug: "gavins-home-infrastructure" },
    create: {
      slug: "gavins-home-infrastructure",
      name: "Gavin's Home Infrastructure",
      description: "Personal homelab — initial TRACE development and testing environment.",
    },
    update: {},
  });

  const devices: Array<{
    name: string;
    category:
      | "PHYSICAL_SERVER"
      | "NAS"
      | "MANAGED_SWITCH"
      | "KVM"
      | "PRINTER";
    manufacturer?: string;
    model?: string;
    operatingSystem?: string;
    notes?: string;
  }> = [
    {
      name: "Beelink SER9 MAX",
      category: "PHYSICAL_SERVER",
      manufacturer: "Beelink",
      model: "SER9 MAX",
      operatingSystem: "Proxmox VE",
      notes:
        "AMD Ryzen 7 H 255, 8 cores / 16 threads, 64GB DDR5, 1TB NVMe, 10GbE networking. " +
        "Hosts VMs and containers. Hardware spec reported by the operator — not yet enrolled; " +
        "no IP, credential, or live metrics have been collected.",
    },
    {
      name: "ZimaBoard 2",
      category: "NAS",
      notes:
        "Used for network storage, backups, and other services. Candidate for a future TRACE " +
        "management gateway (see docs/ARCHITECTURE.md). Not yet enrolled.",
    },
    {
      name: "NETGEAR GS108T",
      category: "MANAGED_SWITCH",
      manufacturer: "NETGEAR",
      model: "GS108T",
      notes: "Managed Ethernet switch. Not yet enrolled — no SNMPv3 credential configured.",
    },
    {
      name: "JetKVM",
      category: "KVM",
      manufacturer: "JetKVM",
      notes: "Remote hardware management device. Not yet enrolled.",
    },
    {
      name: "Bambu Lab P2S",
      category: "PRINTER",
      manufacturer: "Bambu Lab",
      model: "P2S",
      notes: "3D printer connected to an AMS 2 Pro. Not yet enrolled.",
    },
  ];

  for (const device of devices) {
    await prisma.infraDevice.upsert({
      where: { environmentId_name: { environmentId: environment.id, name: device.name } },
      create: {
        environmentId: environment.id,
        name: device.name,
        category: device.category,
        manufacturer: device.manufacturer,
        model: device.model,
        operatingSystem: device.operatingSystem,
        notes: device.notes,
        ipAddresses: [],
        macAddresses: [],
        managementProtocols: [],
      },
      update: {
        manufacturer: device.manufacturer,
        model: device.model,
        operatingSystem: device.operatingSystem,
        notes: device.notes,
      },
    });
  }

  console.log(`Seeded environment "${environment.name}" with ${devices.length} devices.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
