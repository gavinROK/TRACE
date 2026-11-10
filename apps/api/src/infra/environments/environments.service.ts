import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CreateEnvironmentDto } from "./dto/create-environment.dto";

@Injectable()
export class EnvironmentsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list() {
    const environments = await this.prisma.infraEnvironment.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { devices: true } } },
    });
    return environments.map((env) => ({
      id: env.id,
      name: env.name,
      slug: env.slug,
      description: env.description,
      deviceCount: env._count.devices,
      createdAt: env.createdAt,
    }));
  }

  async get(id: string) {
    const environment = await this.prisma.infraEnvironment.findUnique({ where: { id } });
    if (!environment) throw new NotFoundException("Environment not found");
    return environment;
  }

  async create(dto: CreateEnvironmentDto) {
    const existing = await this.prisma.infraEnvironment.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException(`Environment slug "${dto.slug}" already exists`);
    return this.prisma.infraEnvironment.create({ data: dto });
  }
}
