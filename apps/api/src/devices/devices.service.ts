import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { computePostureStatus } from "./device-posture";
import { EnrollDeviceDto } from "./dto/enroll-device.dto";

const WITH_OWNER = { include: { owner: { select: { id: true, name: true } } } } satisfies Prisma.DeviceDefaultArgs;
type DeviceWithOwner = Prisma.DeviceGetPayload<typeof WITH_OWNER>;

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

    const device = await this.prisma.device.create({
      data: {
        organizationId,
        ownerId: dto.ownerId,
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
      },
      ...WITH_OWNER,
    });

    return this.toProfile(device);
  }

  async listDevices(organizationId: string) {
    const devices = await this.prisma.device.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      ...WITH_OWNER,
    });
    return devices.map((device) => this.toProfile(device));
  }

  private toProfile(device: DeviceWithOwner) {
    return {
      id: device.id,
      name: device.name,
      deviceType: device.deviceType,
      operatingSystem: device.operatingSystem,
      osVersion: device.osVersion,
      serialNumber: device.serialNumber,
      enrollmentType: device.enrollmentType,
      owner: device.owner,
      posture: {
        diskEncrypted: device.diskEncrypted,
        firewallEnabled: device.firewallEnabled,
        osUpToDate: device.osUpToDate,
        screenLockEnabled: device.screenLockEnabled,
        status: computePostureStatus(device),
      },
      lastCheckInAt: device.lastCheckInAt,
      createdAt: device.createdAt,
    };
  }
}
