const SUBJECTS = {
  cpp: { id: 'cpp', name: 'C/C++', shortName: 'C/C++', color: '#2563eb', groupId: 'cpp', description: '语言基础、内存、面向对象与模板' },
  linux: { id: 'linux', name: 'Linux', shortName: 'Linux', color: '#7c3aed', groupId: 'linux-os', description: '命令、权限、进程、服务与排障' },
  os: { id: 'os', name: '操作系统', shortName: '操作系统', color: '#6d28d9', groupId: 'linux-os', description: '进程、同步、内存、文件与 I/O' },
  ds: { id: 'ds', name: '数据结构', shortName: '数据结构', color: '#059669', groupId: 'ds', description: '线性结构、树、图、查找与排序' },
  network: { id: 'network', name: '计算机网络', shortName: '计网', color: '#ea580c', groupId: 'network-stl', description: '体系结构、链路、IP、传输与应用' },
  stl: { id: 'stl', name: 'STL', shortName: 'STL', color: '#c2410c', groupId: 'network-stl', description: '容器、迭代器、算法与函数对象' },
  co: { id: 'co', name: '计算机组成原理', shortName: '组成原理', color: '#db2777', groupId: 'postgraduate', description: '数据表示、存储、指令、CPU 与 I/O' }
};

const MODULES = [
  { id: 'cpp', name: 'C/C++', subtitle: '语言基础与面向对象', color: '#2563eb', type: 'subject', subjectIds: ['cpp'] },
  { id: 'linux-os', name: 'Linux / 操作系统', subtitle: '双方向专项练习', color: '#7c3aed', type: 'group', subjectIds: ['linux', 'os'] },
  { id: 'ds', name: '数据结构', subtitle: '结构、算法与复杂度', color: '#059669', type: 'subject', subjectIds: ['ds'] },
  { id: 'network-stl', name: '计网 / STL', subtitle: '双方向专项练习', color: '#ea580c', type: 'group', subjectIds: ['network', 'stl'] },
  { id: 'postgraduate', name: '考研 408', subtitle: '40 题 · 60 分钟客观题模拟', color: '#db2777', type: 'exam', subjectIds: ['ds', 'co', 'os', 'network'] }
];

function getSubject(subjectId) {
  return SUBJECTS[subjectId] || null;
}

function getModule(moduleId) {
  return MODULES.find((item) => item.id === moduleId) || null;
}

function getSubjects(subjectIds) {
  return (subjectIds || Object.keys(SUBJECTS)).map(getSubject).filter(Boolean);
}

module.exports = {
  SUBJECTS,
  MODULES,
  getSubject,
  getModule,
  getSubjects,
  subjectIds: Object.keys(SUBJECTS)
};
