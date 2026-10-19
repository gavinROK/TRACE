import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AddSoftwareDto } from "./dto/add-software.dto";
import { EnrollDeviceDto } from "./dto/enroll-device.dto";
import { computePostureStatus } from "./device-posture";

const WITH_RELATIONS = {
  include: {
    owner: { select: { id: true, name: true } },
    department: { select: { id: true, name: true } },
    software: { orderBy: { name: "asc" } },
  },
} satisfies Prisma.DeviceDefaultArgs;
type DeviceWithRelations = Prisma.DeviceGetPayload<typeof WITH_RELATIONS>;

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async enrollDevice(organizationId: string, dto: EnrollDeviceDto) {
    if (dto.ownerId) {
      const owner = await this.prisma.developer.findFirst({
        where: { id: dto.ownerId, organizationId },
        select: { id: true },
      });
      if (!owner) {
        throw new BadRequestException("ownerId must belong to the caller's organization");
      }
    }
    if (dto.departmentId) {
      const department = await this.prisma.department.findFirst({
        where: { id: dto.departmentId, organizationId },
        select: { id: true },
      });
      if (!department) {
        throw new BadRequestException("departmentId must belong to the caller's organization");
      }
    }

    const device = await this.prisma.device.create({
      data: {
        organizationId,
        ownerId: dto.ownerId,
        departmentId: dto.departmentId,
        name: dto.name,
        deviceType: dto.deviceType,
        operatingSystem: dto.operatingSystem,
        osVersion: dto.osVersion,
        serialNumber: dto.serialNumber,
        enrollmentType: "MANUAL",
        diskEncrypted: dto.diskEncrypted,
        firewallEnabled: dto.firewallEnabled,
        osUpToDate: dto.osUpToDate,
        screenLockEnabled: dto.screenLockEnabled,
        lastCheckInAt: dto.lastCheckInAt ? new Date(dto.lastCheckInAt) : undefined,
      },
      ...WITH_RELATIONS,
    });

    return this.toProfile(device);
  }

  async listDevices(organizationId: string) {
    const devices = await this.prisma.device.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      ...WITH_RELATIONS,
    });
    return devices.map((device) => this.toProfile(device));
  }

  /** Bulk-adds software to one device — backs both manual entry (one
   * item) and CSV import (many). Never overwrites or dedupes existing
   * rows; each call just appends, matching how a real inventory grows as
   * more is reported. */
  async addSoftware(organizationId: string, deviceId: string, dto: AddSoftwareDto) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, organizationId },
      select: { id: true },
    });
    if (!device) {
      throw new NotFoundException("Device not found");
    }

    await this.prisma.softwareInstallation.createMany({
      data: dto.items.map((item) => ({
        organizationId,
        deviceId,
        name: item.name,
        version: item.version,
        publisher: item.publisher,
        installedAt: item.installedAt ? new Date(item.installedAt) : undefined,
        source: dto.source,
      })),
    });

    const updated = await this.prisma.device.findFirstOrThrow({
      where: { id: deviceId, organizationId },
      ...WITH_RELATIONS,
    });
    return this.toProfile(updated);
  }

  private toProfile(device: DeviceWithRelations) {
    return {
      id: device.id,
      name: device.name,
      deviceType: device.deviceType,
      operatingSystem: device.operatingSystem,
      osVersion: device.osVersion,
      serialNumber: device.serialNumber,
      enrollmentType: device.enrollmentType,
      owner: device.owner,
      department: device.department,
      posture: {
        diskEncrypted: device.diskEncrypted,
        firewallEnabled: device.firewallEnabled,
        osUpToDate: device.osUpToDate,
        screenLockEnabled: device.screenLockEnabled,
        status: computePostureStatus(device),
      },
      software: device.software.map((item) => ({
        id: item.id,
        name: item.name,
        version: item.version,
        publisher: item.publisher,
        installedAt: item.installedAt,
        source: item.source,
      })),
      lastCheckInAt: device.lastCheckInAt,
      createdAt: device.createdAt,
    };
  }
}
