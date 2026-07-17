import type { FastifyInstance } from "fastify";
import type { CatalogService } from "../services/catalog.js";

export function registerCatalogRoutes(app: FastifyInstance, service: CatalogService): void {
  app.get("/api/v1/catalog", async () => ({ data: await service.getCatalog() }));
}
