export const SUBJECTS = {
  cpp: { id: "cpp", name: "C/C++", shortName: "C/C++", order: 1, groupId: "cpp" },
  linux: { id: "linux", name: "Linux", shortName: "Linux", order: 2, groupId: "linux-os" },
  os: { id: "os", name: "操作系统", shortName: "操作系统", order: 3, groupId: "linux-os" },
  ds: { id: "ds", name: "数据结构", shortName: "数据结构", order: 4, groupId: "ds" },
  network: { id: "network", name: "计算机网络", shortName: "计网", order: 5, groupId: "network-stl" },
  stl: { id: "stl", name: "STL", shortName: "STL", order: 6, groupId: "network-stl" },
  co: { id: "co", name: "计算机组成原理", shortName: "组成原理", order: 7, groupId: "postgraduate" }
} as const;

export const MODULES = [
  { id: "cpp", name: "C/C++", subtitle: "语言基础与面向对象", color: "#2563eb", type: "subject", subjectIds: ["cpp"] },
  { id: "linux-os", name: "Linux / 操作系统", subtitle: "双方向专项练习", color: "#7c3aed", type: "group", subjectIds: ["linux", "os"] },
  { id: "ds", name: "数据结构", subtitle: "结构、算法与复杂度", color: "#059669", type: "subject", subjectIds: ["ds"] },
  { id: "network-stl", name: "计网 / STL", subtitle: "双方向专项练习", color: "#ea580c", type: "group", subjectIds: ["network", "stl"] },
  { id: "postgraduate", name: "考研 408", subtitle: "40 题 · 60 分钟客观题模拟", color: "#db2777", type: "exam", subjectIds: ["ds", "co", "os", "network"] }
] as const;

export type SubjectId = keyof typeof SUBJECTS;

export function isSubjectId(value: string): value is SubjectId {
  return Object.prototype.hasOwnProperty.call(SUBJECTS, value);
}
