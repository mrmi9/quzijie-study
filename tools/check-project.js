const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const miniprogramRoot = path.join(root, 'miniprogram');
const subpackageRoot = path.join(miniprogramRoot, 'modules', 'cpp');
const budgetBytes = 1.5 * 1024 * 1024;
const errors = [];
const wxmlFiles = [];
const pageFiles = [];
const ignoredDirectories = new Set(['.git', 'node_modules', 'miniprogram_npm', 'dist', 'generated']);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    errors.push(`${path.relative(root, file)}: ${error.message}`);
    return null;
  }
}

function walk(directory, visitor) {
  if (!fs.existsSync(directory)) return;
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) return;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath, visitor);
    else if (entry.isFile()) visitor(fullPath);
  });
}

walk(root, (file) => { if (file.endsWith('.json')) readJson(file); });
walk(miniprogramRoot, (file) => {
  if (file.endsWith('.wxml')) wxmlFiles.push(file);
  if (file.endsWith('.js') && file.includes(`${path.sep}pages${path.sep}`)) pageFiles.push(file);
});

function checkWxml(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/<!--[^]*?-->/g, '');
  if (/<[^>]+wx:(?:else|elif)[^>]+wx:for=|<[^>]+wx:for=[^>]+wx:(?:else|elif)/.test(source)) {
    errors.push(`${path.relative(root, file)}: wx:else/wx:elif 与 wx:for 不能放在同一节点，请使用 block 包裹`);
  }
  const stack = [];
  const tagPattern = /<\/?[a-zA-Z][^>]*>/g;
  let match;
  while ((match = tagPattern.exec(source))) {
    const raw = match[0];
    const nameMatch = raw.match(/^<\/?([a-zA-Z][\w-]*)/);
    if (!nameMatch || raw.endsWith('/>')) continue;
    const name = nameMatch[1];
    if (raw.startsWith('</')) {
      const expected = stack.pop();
      if (expected !== name) {
        errors.push(`${path.relative(root, file)}: 标签闭合错误，期望 </${expected || 'none'}>，实际 </${name}>`);
        return;
      }
    } else stack.push(name);
  }
  if (stack.length) errors.push(`${path.relative(root, file)}: 未闭合标签 <${stack[stack.length - 1]}>`);
}
wxmlFiles.forEach(checkWxml);

const app = readJson(path.join(miniprogramRoot, 'app.json'));
if (app) {
  const routes = (app.pages || []).map((page) => ({ root: '', page }));
  (app.subPackages || []).forEach((subpackage) => {
    (subpackage.pages || []).forEach((page) => routes.push({ root: subpackage.root, page }));
  });
  routes.forEach((entry) => {
    const base = path.join(miniprogramRoot, entry.root, entry.page);
    ['.js', '.json', '.wxml', '.wxss'].forEach((extension) => {
      if (!fs.existsSync(`${base}${extension}`)) errors.push(`页面文件缺失: ${path.relative(root, base)}${extension}`);
    });
  });
  const tabPages = new Set(app.pages || []);
  ((app.tabBar && app.tabBar.list) || []).forEach((tab) => {
    if (!tabPages.has(tab.pagePath)) errors.push(`TabBar 页面必须位于主包 pages 中：${tab.pagePath}`);
  });
  const legacyRoute = (app.subPackages || []).some((item) => item.root === 'modules/cpp' && item.pages.includes('pages/home/index'));
  if (!legacyRoute) errors.push('必须保留兼容入口 /modules/cpp/pages/home/index');
}

pageFiles.forEach((file) => {
  if (fs.readFileSync(file, 'utf8').includes('wx.request(')) errors.push(`${path.relative(root, file)}: 页面不得直接调用 wx.request`);
});

const contentFiles = fs.readdirSync(path.join(root, 'content')).filter((name) => name.endsWith('-questions.json')).sort();
const sourceQuestions = contentFiles.flatMap((name) => readJson(path.join(root, 'content', name)) || []);
delete require.cache[require.resolve(path.join(miniprogramRoot, 'data', 'questions.js'))];
const runtimeQuestions = require(path.join(miniprogramRoot, 'data', 'questions.js'));
if (JSON.stringify(sourceQuestions) !== JSON.stringify(runtimeQuestions)) errors.push('运行时题库与 content 目录源文件不一致，请执行 npm run build:data');
if (fs.existsSync(path.join(subpackageRoot, 'data', 'questions.js'))) errors.push('分包中存在重复题库副本，应只使用主包 data/questions.js');

function packageSize(directory, exclude) {
  let total = 0;
  walk(directory, (file) => {
    if (!exclude || !exclude(file)) total += fs.statSync(file).size;
  });
  return total;
}
const mainBytes = packageSize(miniprogramRoot, (file) => file === subpackageRoot || file.startsWith(`${subpackageRoot}${path.sep}`));
const subpackageBytes = packageSize(subpackageRoot);
if (mainBytes > budgetBytes) errors.push(`主包超过 1.5MB 内部预算：${mainBytes} bytes`);
if (subpackageBytes > budgetBytes) errors.push(`业务分包超过 1.5MB 内部预算：${subpackageBytes} bytes`);

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Project structure checked: ${pageFiles.length} pages, ${wxmlFiles.length} WXML files, all routes complete.`);
console.log(`Package budgets: main ${mainBytes} bytes, modules/cpp ${subpackageBytes} bytes (limit ${Math.floor(budgetBytes)} each).`);
