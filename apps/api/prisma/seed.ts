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

  // Simulated device inventory — deliberately varied posture (healthy,
  // at-risk, critical, and genuinely unknown) so the UI and the
  // DevicePostureRule security rule both have something real to show.
  // One device has no owner at all (shared infrastructure), matching how
  // a real inventory looks.
  const devices: Array<{
    id: string;
    name: string;
    deviceType: "LAPTOP" | "DESKTOP" | "SERVER";
    operatingSystem: string;
    osVersion: string;
    ownerEmail?: string;
    diskEncrypted: boolean | null;
    firewallEnabled: boolean | null;
    osUpToDate: boolean | null;
    screenLockEnabled: boolean | null;
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
    },
    {
      id: "device-devon-laptop",
      name: "Devon Lee's ThinkPad",
      deviceType: "LAPTOP",
      operatingSystem: "Ubuntu",
      osVersion: "22.04",
      ownerEmail: "devon.lee@acme-corp.example",
      // Manually enrolled, never checked — genuinely unknown, not a finding.
      diskEncrypted: null,
      firewallEnabled: null,
      osUpToDate: null,
      screenLockEnabled: null,
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
    },
    {
      id: "device-prod-db-server",
      name: "prod-db-01",
      deviceType: "SERVER",
      operatingSystem: "Ubuntu",
      osVersion: "22.04",
      // No owner — shared infrastructure, not any one person's device.
      diskEncrypted: true,
      firewallEnabled: false,
      osUpToDate: true,
      screenLockEnabled: null,
    },
  ];

  for (const device of devices) {
    const owner = device.ownerEmail ? developerByEmail.get(device.ownerEmail) : undefined;
    await prisma.device.upsert({
      where: { id: device.id },
      create: {
        id: device.id,
        organizationId: organization.id,
        ownerId: owner?.id,
        name: device.name,
        deviceType: device.deviceType,
        operatingSystem: device.operatingSystem,
        osVersion: device.osVersion,
        enrollmentType: "SIMULATED",
        diskEncrypted: device.diskEncrypted,
        firewallEnabled: device.firewallEnabled,
        osUpToDate: device.osUpToDate,
        screenLockEnabled: device.screenLockEnabled,
      },
      update: {
        ownerId: owner?.id,
        name: device.name,
        operatingSystem: device.operatingSystem,
        osVersion: device.osVersion,
        diskEncrypted: device.diskEncrypted,
        firewallEnabled: device.firewallEnabled,
        osUpToDate: device.osUpToDate,
        screenLockEnabled: device.screenLockEnabled,
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
