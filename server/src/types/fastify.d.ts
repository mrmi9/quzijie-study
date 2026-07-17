import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    userId: string;
    adminUser?: {
      id: string;
      username: string;
      displayName: string;
      roles: Array<"OWNER" | "EDITOR" | "REVIEWER" | "PUBLISHER">;
      sessionId: string;
    };
  }
}
