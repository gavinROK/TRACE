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
      { id: "dept-sales", name: "Sales", description: "New business and account management." },
      { id: "dept-marketing", name: "Marketing", description: "Brand, demand generation, and content." },
      { id: "dept-finance", name: "Finance", description: "Accounting, payroll, and financial planning." },
      { id: "dept-hr", name: "Human Resources", description: "Recruiting, onboarding, and employee relations." },
      { id: "dept-support", name: "Customer Support", description: "Customer-facing technical support." },
    ].map((dept) =>
      prisma.department.upsert({
        where: { id: dept.id },
        create: { ...dept, organizationId: organization.id },
        update: { name: dept.name, description: dept.description },
      }),
    ),
  );
  const [engineering, operations, security, sales, marketing, finance, hr, support] = departments;

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

    // Additional staff so the seeded org is realistically sized for a
    // ~50-person company, not just an 7-person engineering team — added
    // for the product evaluation in docs/DEVELOPMENT_STATUS.md. None of
    // the above 7 entries changed, so every existing test/doc reference
    // to them (by name or id) still holds.
    { email: "benjamin.carver@acme-corp.example", name: "Benjamin Carver", role: "IT Support Specialist", departmentId: operations.id },
    { email: "charlotte.ibarra@acme-corp.example", name: "Charlotte Ibarra", role: "Network Administrator", departmentId: operations.id },
    { email: "alexander.quintero@acme-corp.example", name: "Alexander Quintero", role: "Systems Analyst", departmentId: operations.id },
    { email: "emily.faraday@acme-corp.example", name: "Emily Faraday", role: "Office Manager", departmentId: operations.id },
    { email: "michael.han@acme-corp.example", name: "Michael Han", role: "Software Engineer", departmentId: engineering.id },
    { email: "sophia.reinholt@acme-corp.example", name: "Sophia Reinholt", role: "QA Engineer", departmentId: engineering.id },
    { email: "james.okonkwo@acme-corp.example", name: "James Okonkwo", role: "Site Reliability Engineer", departmentId: engineering.id },
    { email: "lily.beaumont@acme-corp.example", name: "Lily Beaumont", role: "Mobile Engineer", departmentId: engineering.id },
    { email: "liam.fitzgerald@acme-corp.example", name: "Liam Fitzgerald", role: "Sales Manager", departmentId: sales.id },
    { email: "olivia.bennett@acme-corp.example", name: "Olivia Bennett", role: "Sales Representative", departmentId: sales.id },
    { email: "ethan.marsh@acme-corp.example", name: "Ethan Marsh", role: "Sales Representative", departmentId: sales.id },
    { email: "grace.whitfield@acme-corp.example", name: "Grace Whitfield", role: "Sales Representative", departmentId: sales.id },
    { email: "lucas.donovan@acme-corp.example", name: "Lucas Donovan", role: "Account Executive", departmentId: sales.id },
    { email: "harper.delgado@acme-corp.example", name: "Harper Delgado", role: "Account Executive", departmentId: sales.id },
    { email: "mason.kowalski@acme-corp.example", name: "Mason Kowalski", role: "Sales Representative", departmentId: sales.id },
    { email: "chloe.faulkner@acme-corp.example", name: "Chloe Faulkner", role: "Sales Representative", departmentId: sales.id },
    { email: "jackson.reyes@acme-corp.example", name: "Jackson Reyes", role: "Sales Representative", departmentId: sales.id },
    { email: "abigail.stone@acme-corp.example", name: "Abigail Stone", role: "Sales Representative", departmentId: sales.id },
    { email: "henry.castillo@acme-corp.example", name: "Henry Castillo", role: "Marketing Manager", departmentId: marketing.id },
    { email: "amelia.cho@acme-corp.example", name: "Amelia Cho", role: "Marketing Specialist", departmentId: marketing.id },
    { email: "sebastian.vance@acme-corp.example", name: "Sebastian Vance", role: "Content Strategist", departmentId: marketing.id },
    { email: "victoria.park@acme-corp.example", name: "Victoria Park", role: "Marketing Specialist", departmentId: marketing.id },
    { email: "owen.mercer@acme-corp.example", name: "Owen Mercer", role: "Marketing Specialist", departmentId: marketing.id },
    { email: "aria.lindqvist@acme-corp.example", name: "Aria Lindqvist", role: "Marketing Specialist", departmentId: marketing.id },
    { email: "daniel.okafor@acme-corp.example", name: "Daniel Okafor", role: "Accounting Manager", departmentId: finance.id },
    { email: "elizabeth.haas@acme-corp.example", name: "Elizabeth Haas", role: "Financial Analyst", departmentId: finance.id },
    { email: "samuel.trujillo@acme-corp.example", name: "Samuel Trujillo", role: "Financial Analyst", departmentId: finance.id },
    { email: "evelyn.mancini@acme-corp.example", name: "Evelyn Mancini", role: "Financial Analyst", departmentId: finance.id },
    { email: "theodore.lindgren@acme-corp.example", name: "Theodore Lindgren", role: "Financial Analyst", departmentId: finance.id },
    { email: "zoey.albrecht@acme-corp.example", name: "Zoey Albrecht", role: "Recruiter", departmentId: hr.id },
    { email: "jacob.thornton@acme-corp.example", name: "Jacob Thornton", role: "HR Generalist", departmentId: hr.id },
    { email: "avery.solberg@acme-corp.example", name: "Avery Solberg", role: "HR Generalist", departmentId: hr.id },
    { email: "caleb.whitaker@acme-corp.example", name: "Caleb Whitaker", role: "HR Generalist", departmentId: hr.id },
    { email: "mia.kowalczyk@acme-corp.example", name: "Mia Kowalczyk", role: "Support Team Lead", departmentId: support.id },
    { email: "logan.pemberton@acme-corp.example", name: "Logan Pemberton", role: "Support Agent", departmentId: support.id },
    { email: "ella.nakamura@acme-corp.example", name: "Ella Nakamura", role: "Support Agent", departmentId: support.id },
    { email: "levi.shepherd@acme-corp.example", name: "Levi Shepherd", role: "Support Agent", departmentId: support.id },
    { email: "scarlett.duval@acme-corp.example", name: "Scarlett Duval", role: "Support Agent", departmentId: support.id },
    { email: "mateo.villanueva@acme-corp.example", name: "Mateo Villanueva", role: "Support Agent", departmentId: support.id },
    { email: "aubrey.lindholm@acme-corp.example", name: "Aubrey Lindholm", role: "Support Agent", departmentId: support.id },
    { email: "joseph.carrington@acme-corp.example", name: "Joseph Carrington", role: "Support Agent", departmentId: support.id },
    { email: "riley.osei@acme-corp.example", name: "Riley Osei", role: "Support Agent", departmentId: support.id },
    { email: "nathaniel.burroughs@acme-corp.example", name: "Nathaniel Burroughs", role: "Support Agent", departmentId: support.id },
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

  const DESKTOP_DEPARTMENTS = new Set([finance.id, hr.id]);

  /**
   * One workstation per non-engineering/ops/security staff member, with a
   * deterministic but varied posture/check-in spread (healthy, one failing
   * check, two+ failing checks, genuinely unknown, and stale-but-healthy)
   * so the device list and all three device security rules have a
   * realistic mix at 50-person scale, not just the 11 hand-picked devices
   * above.
   */
  function buildStaffWorkstation(
    developer: { email: string; name: string; departmentId: string },
    index: number,
  ) {
    const isUnixDept =
      developer.departmentId === engineering.id ||
      developer.departmentId === operations.id ||
      developer.departmentId === security.id;
    const operatingSystem = isUnixDept ? "macOS" : "Windows";
    // Every 7th Windows machine is still on an older release — realistic
    // long-tail laggards in any fleet this size.
    const osVersion = isUnixDept ? "15.1" : index % 7 === 0 ? "10" : "11";
    const deviceType: "DESKTOP" | "LAPTOP" = DESKTOP_DEPARTMENTS.has(developer.departmentId)
      ? "DESKTOP"
      : "LAPTOP";

    const pattern = index % 5;
    let diskEncrypted: boolean | null = true;
    let firewallEnabled: boolean | null = true;
    let osUpToDate: boolean | null = true;
    let screenLockEnabled: boolean | null = true;
    let lastCheckInAt: Date | null = daysAgo(1 + (index % 14));

    if (pattern === 1) {
      // Exactly one failing check — which one rotates by index.
      const flags = ["diskEncrypted", "firewallEnabled", "osUpToDate", "screenLockEnabled"];
      const failing = flags[index % flags.length];
      if (failing === "diskEncrypted") diskEncrypted = false;
      if (failing === "firewallEnabled") firewallEnabled = false;
      if (failing === "osUpToDate") osUpToDate = false;
      if (failing === "screenLockEnabled") screenLockEnabled = false;
    } else if (pattern === 2) {
      // Two failing checks — CRITICAL.
      diskEncrypted = false;
      screenLockEnabled = false;
    } else if (pattern === 3) {
      // Genuinely unknown — manually enrolled, never checked.
      diskEncrypted = null;
      firewallEnabled = null;
      osUpToDate = null;
      screenLockEnabled = null;
      lastCheckInAt = null;
    } else if (pattern === 4) {
      // Healthy posture, but hasn't checked in for a long time.
      lastCheckInAt = daysAgo(95 + index);
    }

    return {
      id: `device-staff-${index}`,
      name: `${developer.name}'s ${deviceType === "DESKTOP" ? "Desktop" : "Laptop"}`,
      deviceType,
      operatingSystem,
      osVersion,
      ownerEmail: developer.email,
      diskEncrypted,
      firewallEnabled,
      osUpToDate,
      screenLockEnabled,
      lastCheckInAt,
    };
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
      | "ACCESS_POINT"
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
    // Five more network/server infrastructure assets — a 50-person office
    // realistically has more than one switch and more than one AP.
    {
      id: "device-floor2-switch",
      name: "floor2-switch-01",
      deviceType: "SWITCH",
      operatingSystem: "Cisco IOS",
      osVersion: "15.2(7)E",
      departmentId: operations.id,
      diskEncrypted: null,
      firewallEnabled: null,
      osUpToDate: null,
      screenLockEnabled: null,
      lastCheckInAt: daysAgo(30),
    },
    {
      id: "device-guest-ap-01",
      name: "guest-wifi-ap-01",
      deviceType: "ACCESS_POINT",
      operatingSystem: "UniFi OS",
      osVersion: "4.1.13",
      departmentId: operations.id,
      diskEncrypted: null,
      firewallEnabled: null,
      osUpToDate: true,
      screenLockEnabled: null,
      lastCheckInAt: daysAgo(3),
    },
    {
      id: "device-guest-ap-02",
      name: "guest-wifi-ap-02",
      deviceType: "ACCESS_POINT",
      operatingSystem: "UniFi OS",
      osVersion: "3.2.7",
      departmentId: operations.id,
      // Older firmware than ap-01 and never re-verified — a realistic
      // "forgotten corner of the network" case.
      diskEncrypted: null,
      firewallEnabled: null,
      osUpToDate: false,
      screenLockEnabled: null,
      lastCheckInAt: daysAgo(150),
    },
    {
      id: "device-backup-server",
      name: "backup-server-01",
      deviceType: "SERVER",
      operatingSystem: "Ubuntu",
      osVersion: "22.04",
      departmentId: operations.id,
      diskEncrypted: true,
      firewallEnabled: true,
      osUpToDate: true,
      screenLockEnabled: null,
      lastCheckInAt: daysAgo(7),
    },
    {
      id: "device-staging-vm",
      name: "staging-vm-01",
      deviceType: "VIRTUAL_MACHINE",
      operatingSystem: "Ubuntu",
      osVersion: "22.04",
      departmentId: engineering.id,
      diskEncrypted: true,
      firewallEnabled: false,
      osUpToDate: true,
      screenLockEnabled: null,
      lastCheckInAt: daysAgo(4),
    },
    // One workstation per new employee above — a realistic posture/
    // check-in distribution (not every device the same), generated
    // rather than hand-written 43 times. See postureForIndex below.
    ...developers.slice(7).map((developer, index) => buildStaffWorkstation(developer, index)),
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
  const DEPARTMENT_APP: Record<string, { name: string; version: string; publisher: string }> = {
    [sales.id]: { name: "Salesforce", version: "Winter '25", publisher: "Salesforce, Inc." },
    [marketing.id]: { name: "Canva", version: "2.1.0", publisher: "Canva Pty Ltd" },
    [finance.id]: { name: "QuickBooks", version: "24.0", publisher: "Intuit Inc." },
    [hr.id]: { name: "BambooHR", version: "Web", publisher: "BambooHR LLC" },
    [support.id]: { name: "Zendesk", version: "Web", publisher: "Zendesk, Inc." },
    [operations.id]: { name: "CrowdStrike Falcon", version: "7.2.0", publisher: "CrowdStrike, Inc." },
    [engineering.id]: { name: "Visual Studio Code", version: "1.95.0", publisher: "Microsoft" },
  };

  /**
   * Every staff workstation gets the three apps nearly everyone in a real
   * office has installed, plus one department-relevant app — enough
   * variety to exercise search/filter in the device inventory without
   * hand-seeding each one.
   */
  function buildStaffSoftware(
    developer: { departmentId: string },
    index: number,
  ): Array<{ id: string; deviceId: string; name: string; version: string; publisher: string; installedAt: Date | null }> {
    const deviceId = `device-staff-${index}`;
    const common = [
      { name: "Google Chrome", version: "130.0.6723.92", publisher: "Google LLC", installedAt: daysAgo(30 + index) },
      { name: "Slack", version: "4.39.95", publisher: "Slack Technologies, Inc.", installedAt: daysAgo(45 + index) },
      { name: "Zoom", version: "6.1.11", publisher: "Zoom Video Communications, Inc.", installedAt: daysAgo(20 + index) },
    ];
    const departmentApp = DEPARTMENT_APP[developer.departmentId];
    const all = departmentApp ? [...common, { ...departmentApp, installedAt: daysAgo(10 + index) }] : common;
    return all.map((app, appIndex) => ({
      id: `sw-staff-${index}-${appIndex}`,
      deviceId,
      name: app.name,
      version: app.version,
      publisher: app.publisher,
      installedAt: app.installedAt,
    }));
  }

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
    ...developers.slice(7).flatMap((developer, index) => buildStaffSoftware(developer, index)),
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
