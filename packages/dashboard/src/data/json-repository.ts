import { readFile } from "node:fs/promises";
import type { DashboardData, DashboardRepository } from "./repositories";
import { InMemoryDashboardRepository } from "./repositories";

export class JsonDashboardRepository implements DashboardRepository {
  constructor(private readonly path: string) {}

  private async load() {
    try {
      const raw = await readFile(this.path, "utf8");
      const data = JSON.parse(raw) as DashboardData;
      return new InMemoryDashboardRepository({
        experts: Array.isArray(data.experts) ? data.experts : [],
        memberships: Array.isArray(data.memberships) ? data.memberships : []
      });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return new InMemoryDashboardRepository();
      }
      throw error;
    }
  }

  async getExpert(expertId: string) {
    return (await this.load()).getExpert(expertId);
  }

  async getMembership(expertId: string, userId: string) {
    return (await this.load()).getMembership(expertId, userId);
  }

  async listMembershipsByUser(userId: string) {
    return (await this.load()).listMembershipsByUser(userId);
  }

  async listMembershipsByExpert(expertId: string) {
    return (await this.load()).listMembershipsByExpert(expertId);
  }
}
