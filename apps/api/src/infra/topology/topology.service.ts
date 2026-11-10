import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { InfraDevicesService } from "../devices/devices.service";

/**
 * Assembles the graph the frontend's React Flow topology view renders —
 * nodes from InfraDevice, edges from InfraRelationship (each tagged
 * VERIFIED or INFERRED, per PRODUCT_SPEC.md section 6: "Differentiate
 * verified connections from inferred relationships").
 */
@Injectable()
export class TopologyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly devicesService: InfraDevicesService,
  ) {}

  async getSnapshot(environmentId: string) {
    const [devices, relationships, summary] = await Promise.all([
      this.prisma.infraDevice.findMany({ where: { environmentId }, orderBy: { name: "asc" } }),
      this.prisma.infraRelationship.findMany({ where: { environmentId } }),
      this.devicesService.getDashboardSummary(environmentId),
    ]);

    return {
      nodes: devices.map((device) => ({
        id: device.id,
        name: device.name,
        category: device.category,
        onlineState: device.onlineState,
        enrollmentStatus: device.enrollmentStatus,
        parentDeviceId: device.parentDeviceId,
      })),
      edges: relationships.map((relationship) => ({
        id: relationship.id,
        from: relationship.fromDeviceId,
        to: relationship.toDeviceId,
        type: relationship.type,
        kind: relationship.kind,
      })),
      summary,
    };
  }
}
