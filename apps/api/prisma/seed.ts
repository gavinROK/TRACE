import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

/**
 * Local development seed data only — mirrors the shape of
 * apps/web/lib/data.ts (same organization/department/developer names) so a
 * demo of the real backend lines up with what the frontend already shows
 * with its own static mock data. Safe to re-run: every write is an upsert
 * keyed by a fixed, deterministic id or natural key.
 */
const prisma = new PrismaClient();

function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: "acme-corp" },
    create: { name: "Acme Corp", slug: "acme-corp" },
    update: {},
  });

  const departments = await Promise.all(
    [
      { id: "dept-engineering", name: "Engineering", description: "Product engineering and platform teams." },
      { id: "dept-operations", name: "Operations", description: "Infrastructure, IT, and internal tooling." },
      { id: "dept-security", name: "Security", description: "Application and network security." },
    ].map((dept) =>
      prisma.department.upsert({
        where: { id: dept.id },
        create: { ...dept, organizationId: organization.id },
        update: { name: dept.name, description: dept.description },
      }),
    ),
  );
  const [engineering, operations, security] = departments;

  // githubLogin on Ada/Priya matches MockGithubApiClient's sample commit
  // authors, so a sync run against the mock client (the default when no
  // real GitHub App is configured) produces activity correctly attributed
  // to a real seeded developer, demonstrating the attribution path without
  // needing a live GitHub App.
  const developers = [
    { email: "ada.chen@acme-corp.example", name: "Ada Chen", role: "Staff Engineer", departmentId: engineering.id, githubLogin: "mock-dev-ada" },
    { email: "marcus.webb@acme-corp.example", name: "Marcus Webb", role: "Backend Engineer", departmentId: engineering.id },
    { email: "priya.sharma@acme-corp.example", name: "Priya Sharma", role: "Frontend Engineer", departmentId: engineering.id, githubLogin: "mock-dev-priya" },
    { email: "devon.lee@acme-corp.example", name: "Devon Lee", role: "Platform Engineer", departmentId: engineering.id },
    { email: "isabel.ortiz@acme-corp.example", name: "Isabel Ortiz", role: "DevOps Engineer", departmentId: operations.id },
    { email: "noah.kim@acme-corp.example", name: "Noah Kim", role: "IT Systems Administrator", departmentId: operations.id },
    { email: "sofia.rossi@acme-corp.example", name: "Sofia Rossi", role: "Security Engineer", departmentId: security.id },
  ];

  const developerByEmail = new Map<string, { id: string }>();
  for (const developer of developers) {
    const row = await prisma.developer.upsert({
      where: { organizationId_email: { organizationId: organization.id, email: developer.email } },
      create: { ...developer, organizationId: organization.id },
      update: { name: developer.name, role: developer.role, departmentId: developer.departmentId, githubLogin: developer.githubLogin },
    });
    developerByEmail.set(developer.email, row);
  }

  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  // Simulated device + infrastructure asset inventory — deliberately
  // varied posture (healthy, at-risk, critical, and genuinely unknown)
  // and check-in recency (recent, stale, and never) so the UI and all
  // three device security rules have real, varied data to show. Three
  // of these are network infrastructure (no owner — department-assigned
  // instead), matching how a real inventory looks: not everything is a
  // person's laptop.
  const devices: Array<{
    id: string;
    name: string;
    deviceType:
      | "LAPTOP"
      | "DESKTOP"
      | "SERVER"
      | "SWITCH"
      | "ROUTER"
      | "VIRTUAL_MACHINE";
    operatingSystem: string;
    osVersion: string;
    ownerEmail?: string;
    departmentId?: string;
    diskEncrypted: boolean | null;
    firewallEnabled: boolean | null;
    osUpToDate: boolean | null;
    screenLockEnabled: boolean | null;
    lastCheckInAt: Date | null;
  }> = [
    {
      id: "device-ada-laptop",
      name: "Ada Chen's MacBook Pro",
      deviceType: "LAPTOP",
      operatingSystem: "macOS",
      osVersion: "15.1",
      ownerEmail: "ada.chen@acme-corp.example",
      diskEncrypted: true,
      firewallEnabled: true,
      osUpToDate: true,
      screenLockEnabled: true,
      lastCheckInAt: daysAgo(5),
    },
    {
      id: "device-marcus-laptop",
      name: "Marcus Webb's Dell Latitude",
      deviceType: "LAPTOP",
      operatingSystem: "Windows",
      osVersion: "11",
      ownerEmail: "marcus.webb@acme-corp.example",
      diskEncrypted: false,
      firewallEnabled: true,
      osUpToDate: true,
      screenLockEnabled: true,
      lastCheckInAt: daysAgo(10),
    },
    {
      id: "device-priya-laptop",
      name: "Priya Sharma's MacBook Air",
      deviceType: "LAPTOP",
      operatingSystem: "macOS",
      osVersion: "14.6",
      ownerEmail: "priya.sharma@acme-corp.example",
      diskEncrypted: true,
      firewallEnabled: true,
      osUpToDate: false,
      screenLockEnabled: false,
      // Deliberately stale (>90 days) as well as CRITICAL posture, so
      // this one device demonstrates both DevicePostureRule and
      // DeviceDataQualityRule firing simultaneously with different types.
      lastCheckInAt: daysAgo(200),
    },
    {
      id: "device-devon-laptop",
      name: "Devon Lee's ThinkPad",
      deviceType: "LAPTOP",
      operatingSystem: "Ubuntu",
      osVersion: "22.04",
      ownerEmail: "devon.lee@acme-corp.example",
      // Manually enrolled, never checked — genuinely unknown, not a
      // finding from DevicePostureRule. Combined with no check-in date
      // at all, DeviceDataQualityRule should report both as ONE finding.
      diskEncrypted: null,
      firewallEnabled: null,
      osUpToDate: null,
      screenLockEnabled: null,
      lastCheckInAt: null,
    },
    {
      id: "device-isabel-laptop",
      name: "Isabel Ortiz's MacBook Pro",
      deviceType: "LAPTOP",
      operatingSystem: "macOS",
      osVersion: "15.1",
      ownerEmail: "isabel.ortiz@acme-corp.example",
      diskEncrypted: true,
      firewallEnabled: true,
      osUpToDate: true,
      screenLockEnabled: true,
      lastCheckInAt: daysAgo(2),
    },
    {
      id: "device-noah-desktop",
      name: "Noah Kim's Desktop",
      deviceType: "DESKTOP",
      operatingSystem: "Windows",
      osVersion: "10",
      ownerEmail: "noah.kim@acme-corp.example",
      diskEncrypted: true,
      firewallEnabled: true,
      osUpToDate: false,
      screenLockEnabled: true,
      lastCheckInAt: daysAgo(45),
    },
    {
      id: "device-sofia-laptop",
      name: "Sofia Rossi's MacBook Pro",
      deviceType: "LAPTOP",
      operatingSystem: "macOS",
      osVersion: "15.1",
      ownerEmail: "sofia.rossi@acme-corp.example",
      diskEncrypted: true,
      firewallEnabled: true,
      osUpToDate: true,
      screenLockEnabled: true,
      lastCheckInAt: daysAgo(1),
    },
    {
      id: "device-prod-db-server",
      name: "prod-db-01",
      deviceType: "SERVER",
      operatingSystem: "Ubuntu",
      osVersion: "22.04",
      // No owner, no department — fully unowned shared infrastructure.
      diskEncrypted: true,
      firewallEnabled: false,
      osUpToDate: true,
      screenLockEnabled: null,
      lastCheckInAt: null,
    },
    {
      id: "device-core-switch",
      name: "core-switch-01",
      deviceType: "SWITCH",
      operatingSystem: "Cisco IOS",
      osVersion: "15.2(7)E",
      departmentId: operations.id,
      diskEncrypted: null,
      firewallEnabled: false,
      osUpToDate: null,
      screenLockEnabled: null,
      lastCheckInAt: daysAgo(15),
    },
    {
      id: "device-edge-router",
      name: "edge-router-01",
      deviceType: "ROUTER",
      operatingSystem: "pfSense",
      osVersion: "2.7.2",
      departmentId: operations.id,
      diskEncrypted: null,
      firewallEnabled: true,
      osUpToDate: true,
      screenLockEnabled: null,
      lastCheckInAt: daysAgo(20),
    },
    {
      id: "device-ci-runner-vm",
      name: "ci-runner-01",
      deviceType: "VIRTUAL_MACHINE",
      operatingSystem: "Ubuntu",
      osVersion: "24.04",
      departmentId: engineering.id,
      diskEncrypted: true,
      firewallEnabled: true,
      osUpToDate: false,
      screenLockEnabled: null,
      lastCheckInAt: daysAgo(5),
    },
  ];

  const deviceRowById = new Map<string, { id: string }>();
  for (const device of devices) {
    const owner = device.ownerEmail ? developerByEmail.get(device.ownerEmail) : undefined;
    const row = await prisma.device.upsert({
      where: { id: device.id },
      create: {
        id: device.id,
        organizationId: organization.id,
        ownerId: owner?.id,
        departmentId: device.departmentId,
        name: device.name,
        deviceType: device.deviceType,
        operatingSystem: device.operatingSystem,
        osVersion: device.osVersion,
        enrollmentType: "SIMULATED",
        diskEncrypted: device.diskEncrypted,
        firewallEnabled: device.firewallEnabled,
        osUpToDate: device.osUpToDate,
        screenLockEnabled: device.screenLockEnabled,
        lastCheckInAt: device.lastCheckInAt,
      },
      update: {
        ownerId: owner?.id,
        departmentId: device.departmentId,
        name: device.name,
        operatingSystem: device.operatingSystem,
        osVersion: device.osVersion,
        diskEncrypted: device.diskEncrypted,
        firewallEnabled: device.firewallEnabled,
        osUpToDate: device.osUpToDate,
        screenLockEnabled: device.screenLockEnabled,
        lastCheckInAt: device.lastCheckInAt,
      },
    });
    deviceRowById.set(device.id, row);
  }

  // Simulated software inventory — a handful of installs across a couple
  // of devices, enough to demonstrate the feature without hand-seeding
  // every device's full software list.
  const softwareInstallations = [
    {
      id: "sw-ada-vscode",
      deviceId: "device-ada-laptop",
      name: "Visual Studio Code",
      version: "1.95.0",
      publisher: "Microsoft",
      installedAt: daysAgo(60),
    },
    {
      id: "sw-ada-docker",
      deviceId: "device-ada-laptop",
      name: "Docker Desktop",
      version: "4.34.0",
      publisher: "Docker, Inc.",
      installedAt: daysAgo(40),
    },
    {
      id: "sw-switch-firmware",
      deviceId: "device-core-switch",
      name: "Cisco IOS Firmware",
      version: "15.2(7)E",
      publisher: "Cisco Systems",
      installedAt: null,
    },
    {
      id: "sw-ci-runner-docker",
      deviceId: "device-ci-runner-vm",
      name: "Docker Engine",
      version: "27.3.1",
      publisher: "Docker, Inc.",
      installedAt: daysAgo(90),
    },
    {
      id: "sw-ci-runner-node",
      deviceId: "device-ci-runner-vm",
      name: "Node.js",
      version: "22.9.0",
      publisher: "Node.js Foundation",
      installedAt: daysAgo(90),
    },
  ];

  for (const software of softwareInstallations) {
    const device = deviceRowById.get(software.deviceId);
    if (!device) continue;
    await prisma.softwareInstallation.upsert({
      where: { id: software.id },
      create: {
        id: software.id,
        organizationId: organization.id,
        deviceId: device.id,
        name: software.name,
        version: software.version,
        publisher: software.publisher,
        installedAt: software.installedAt,
        source: "MANUAL",
      },
      update: {
        name: software.name,
        version: software.version,
        publisher: software.publisher,
        installedAt: software.installedAt,
      },
    });
  }

  const existingKey = await prisma.apiKey.findFirst({
    where: { organizationId: organization.id, label: "Local dev seed key" },
  });

  if (existingKey) {
    console.log("Seed complete. A local dev API key already exists for Acme Corp (not re-printed — hashes aren't reversible).");
  } else {
    const rawApiKey = `trace_dev_${randomBytes(24).toString("hex")}`;
    await prisma.apiKey.create({
      data: {
        organizationId: organization.id,
        label: "Local dev seed key",
        hashedKey: hashApiKey(rawApiKey),
      },
    });
    console.log("Seed complete.");
    console.log("");
    console.log("LOCAL DEV ONLY API key for Acme Corp (shown once — it is not stored anywhere recoverable):");
    console.log(`  ${rawApiKey}`);
    console.log("");
    console.log('Use it as: Authorization: Bearer <key> — e.g. curl -H "Authorization: Bearer <key>" http://localhost:4000/organizations/me');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
