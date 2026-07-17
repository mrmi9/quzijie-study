import type { DatabaseClient } from "../db.js";
import { AppError } from "../errors.js";

const BASELINE_MODULES = [
  { id: "cpp", name: "C/C++", subtitle: "语言基础、内存、面向对象与模板", color: "#2563eb", type: "SUBJECT", order: 1, subjectIds: ["cpp"] },
  { id: "linux-os", name: "Linux / 操作系统", subtitle: "双方向专项练习", color: "#7c3aed", type: "GROUP", order: 2, subjectIds: ["linux", "os"] },
  { id: "ds", name: "数据结构", subtitle: "结构、算法与复杂度", color: "#059669", type: "SUBJECT", order: 3, subjectIds: ["ds"] },
  { id: "network-stl", name: "计网 / STL", subtitle: "双方向专项练习", color: "#ea580c", type: "GROUP", order: 4, subjectIds: ["network", "stl"] },
  { id: "postgraduate", name: "考研 408", subtitle: "40 题 · 60 分钟客观题模拟", color: "#db2777", type: "EXAM", order: 5, subjectIds: ["ds", "co", "os", "network"] }
] as const;

const SUBJECT_PRESENTATION: Record<string, { color: string; description: string }> = {
  cpp: { color: "#2563eb", description: "语言基础、内存、面向对象与模板" },
  linux: { color: "#7c3aed", description: "命令、权限、进程、服务与排障" },
  os: { color: "#6d28d9", description: "进程、同步、内存、文件与 I/O" },
  ds: { color: "#059669", description: "线性结构、树、图、查找与排序" },
  network: { color: "#ea580c", description: "体系结构、链路、IP、传输与应用" },
  stl: { color: "#c2410c", description: "容器、迭代器、算法与函数对象" },
  co: { color: "#db2777", description: "数据表示、存储、指令、CPU 与 I/O" }
};

type CatalogSnapshot = {
  modules: Array<{
    id: string;
    name: string;
    subtitle: string | null;
    color: string;
    type: string;
    order: number;
    active: boolean;
    subjects: Array<{ subjectId: string; order: number }>;
  }>;
  subjects: Array<{
    id: string;
    name: string;
    shortName: string;
    color: string;
    description: string | null;
    iconKey: string | null;
    order: number;
    active: boolean;
  }>;
  chapters: Array<{
    id: string;
    subjectId: string;
    name: string;
    order: number;
    description: string | null;
    active: boolean;
  }>;
  questions: Array<{ subjectId: string; status: string }>;
};

export type PublicCatalog = {
  version: string;
  chapters: Array<{
    id: string;
    subjectId: string;
    name: string;
    order: number;
    description: string;
  }>;
  modules: Array<{
    id: string;
    name: string;
    subtitle: string;
    color: string;
    type: string;
    order: number;
    subjects: Array<{
      id: string;
      name: string;
      shortName: string;
      color: string;
      description: string;
      iconKey: string | null;
      order: number;
      totalQuestions: number;
      chapterCount: number;
    }>;
  }>;
};

export function buildPublicCatalog(snapshot: CatalogSnapshot, version: string): PublicCatalog {
  const subjects = new Map(snapshot.subjects.filter((subject) => subject.active).map((subject) => [subject.id, subject]));
  const questionCounts = new Map<string, number>();
  const chapterCounts = new Map<string, number>();
  snapshot.questions.filter((question) => question.status === "ACTIVE").forEach((question) => {
    questionCounts.set(question.subjectId, (questionCounts.get(question.subjectId) || 0) + 1);
  });
  snapshot.chapters.filter((chapter) => chapter.active).forEach((chapter) => {
    chapterCounts.set(chapter.subjectId, (chapterCounts.get(chapter.subjectId) || 0) + 1);
  });
  const modules = snapshot.modules
    .filter((module) => module.active)
    .sort((left, right) => left.order - right.order)
    .map((module) => ({
      id: module.id,
      name: module.name,
      subtitle: module.subtitle || "",
      color: module.color,
      type: module.type.toLowerCase(),
      order: module.order,
      subjects: module.subjects
        .slice()
        .sort((left, right) => left.order - right.order)
        .map((link) => subjects.get(link.subjectId))
        .filter((subject): subject is NonNullable<typeof subject> => Boolean(subject && (questionCounts.get(subject.id) || 0) > 0))
        .map((subject) => ({
          id: subject.id,
          name: subject.name,
          shortName: subject.shortName,
          color: subject.color,
          description: subject.description || "",
          iconKey: subject.iconKey,
          order: subject.order,
          totalQuestions: questionCounts.get(subject.id) || 0,
          chapterCount: chapterCounts.get(subject.id) || 0
        }))
    }))
    .filter((module) => module.subjects.length > 0);
  const visibleSubjectIds = new Set(modules.flatMap((module) => module.subjects.map((subject) => subject.id)));
  const chapters = snapshot.chapters
    .filter((chapter) => chapter.active && visibleSubjectIds.has(chapter.subjectId))
    .sort((left, right) => left.subjectId.localeCompare(right.subjectId) || left.order - right.order)
    .map((chapter) => ({
      id: chapter.id,
      subjectId: chapter.subjectId,
      name: chapter.name,
      order: chapter.order,
      description: chapter.description || ""
    }));
  return { version, modules, chapters };
}

function validPublicCatalog(value: unknown, expectedVersion: string): value is PublicCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const catalog = value as { version?: unknown; modules?: unknown };
  return catalog.version === expectedVersion && Array.isArray(catalog.modules) && Array.isArray((value as { chapters?: unknown }).chapters);
}

export class CatalogService {
  constructor(private readonly prisma: DatabaseClient) {}

  async ensureBaseline(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      if (await tx.catalogState.findUnique({ where: { id: 1 }, select: { id: true } })) return;
      const initializingCatalog = await tx.catalogModule.count() === 0;
      if (initializingCatalog) {
        for (const [subjectId, presentation] of Object.entries(SUBJECT_PRESENTATION)) {
          await tx.subject.updateMany({
            where: { id: subjectId },
            data: presentation
          });
        }
      }
      for (const module of BASELINE_MODULES) {
        const existingModule = await tx.catalogModule.findUnique({ where: { id: module.id }, select: { id: true } });
        if (!existingModule) {
          await tx.catalogModule.create({
            data: {
              id: module.id,
              name: module.name,
              subtitle: module.subtitle,
              color: module.color,
              type: module.type,
              order: module.order
            }
          });
        }
        for (const [order, subjectId] of module.subjectIds.entries()) {
          const subject = await tx.subject.findUnique({ where: { id: subjectId }, select: { id: true } });
          if (!subject) continue;
          const existingLink = await tx.catalogModuleSubject.findUnique({
            where: { moduleId_subjectId: { moduleId: module.id, subjectId } },
            select: { moduleId: true }
          });
          if (!existingLink) {
            await tx.catalogModuleSubject.create({ data: { moduleId: module.id, subjectId, order } });
          }
        }
      }
      const unlinkedSubjects = await tx.subject.findMany({
        where: { active: true, moduleLinks: { none: {} } },
        orderBy: { order: "asc" }
      });
      const moduleMax = await tx.catalogModule.aggregate({ _max: { order: true } });
      for (const [index, subject] of unlinkedSubjects.entries()) {
        const existingModule = await tx.catalogModule.findUnique({ where: { id: subject.id }, select: { id: true } });
        if (!existingModule) {
          await tx.catalogModule.create({
            data: {
              id: subject.id,
              name: subject.name,
              subtitle: subject.description || "专项练习",
              color: subject.color,
              type: "SUBJECT",
              order: (moduleMax._max.order || 0) + index + 1
            }
          });
        }
        const existingLink = await tx.catalogModuleSubject.findUnique({
          where: { moduleId_subjectId: { moduleId: subject.id, subjectId: subject.id } },
          select: { moduleId: true }
        });
        if (!existingLink) {
          await tx.catalogModuleSubject.create({ data: { moduleId: subject.id, subjectId: subject.id, order: 0 } });
        }
      }
    });
  }

  async getCatalog(): Promise<PublicCatalog> {
    const state = await this.prisma.catalogState.findUnique({
      where: { id: 1 },
      include: { activeRelease: { select: { status: true, snapshotHash: true, publicCatalog: true } } }
    });
    if (state) {
      const release = state.activeRelease;
      if (!release || release.status !== "PUBLISHED" || !release.snapshotHash || !validPublicCatalog(release.publicCatalog, release.snapshotHash)) {
        throw new AppError("当前题库发布目录缺失或校验失败", "CATALOG_RELEASE_INVALID", 503);
      }
      return release.publicCatalog;
    }
    const [modules, chapters] = await Promise.all([
      this.prisma.catalogModule.findMany({
        where: { active: true },
        orderBy: { order: "asc" },
        include: {
          subjects: {
            orderBy: { order: "asc" },
            include: {
              subject: {
                include: {
                  _count: { select: { questions: { where: { status: "ACTIVE" } }, chapters: { where: { active: true } } } }
                }
              }
            }
          }
        }
      }),
      this.prisma.chapter.findMany({ where: { active: true }, orderBy: [{ subjectId: "asc" }, { order: "asc" }] })
    ]);
    const visibleModules = modules.map((module) => ({
      id: module.id,
      name: module.name,
      subtitle: module.subtitle || "",
      color: module.color,
      type: module.type.toLowerCase(),
      order: module.order,
      subjects: module.subjects
        .filter((link) => link.subject.active && link.subject._count.questions > 0)
        .map((link) => ({
          id: link.subject.id,
          name: link.subject.name,
          shortName: link.subject.shortName,
          color: link.subject.color,
          description: link.subject.description || "",
          iconKey: link.subject.iconKey,
          order: link.subject.order,
          totalQuestions: link.subject._count.questions,
          chapterCount: link.subject._count.chapters
        }))
    })).filter((module) => module.subjects.length > 0);
    return {
      version: (await this.prisma.catalogState.findUnique({ where: { id: 1 }, include: { activeRelease: true } }))?.activeRelease?.snapshotHash || "baseline",
      modules: visibleModules,
      chapters: chapters
        .filter((chapter) => visibleModules.some((module) => module.subjects.some((subject) => subject.id === chapter.subjectId)))
        .map((chapter) => ({ id: chapter.id, subjectId: chapter.subjectId, name: chapter.name, order: chapter.order, description: chapter.description || "" }))
    };
  }
}

export { BASELINE_MODULES, SUBJECT_PRESENTATION };
