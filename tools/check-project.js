const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const miniprogramRoot = path.join(root, 'miniprogram');
const errors = [];
const wxmlFiles = [];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    errors.push(`${path.relative(root, file)}: ${error.message}`);
    return null;
  }
}

function collectJson(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectJson(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.json')) readJson(fullPath);
  });
}

function collectWxml(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectWxml(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.wxml')) wxmlFiles.push(fullPath);
  });
}

function checkWxml(file) {
  const source = fs.readFileSync(file, 'utf8').replace(/<!--[^]*?-->/g, '');
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
    } else {
      stack.push(name);
    }
  }
  if (stack.length) errors.push(`${path.relative(root, file)}: 未闭合标签 <${stack[stack.length - 1]}>`);
}

collectJson(root);
collectWxml(miniprogramRoot);
wxmlFiles.forEach(checkWxml);
const app = readJson(path.join(miniprogramRoot, 'app.json'));
if (app) {
  const pages = (app.pages || []).map((page) => ({ root: '', page }));
  (app.subPackages || []).forEach((subpackage) => {
    (subpackage.pages || []).forEach((page) => pages.push({ root: subpackage.root, page }));
  });
  pages.forEach((entry) => {
    const base = path.join(miniprogramRoot, entry.root, entry.page);
    ['.js', '.json', '.wxml', '.wxss'].forEach((extension) => {
      if (!fs.existsSync(`${base}${extension}`)) {
        errors.push(`页面文件缺失: ${path.relative(root, base)}${extension}`);
      }
    });
  });
}

const pageFiles = [];
function collectPageJs(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectPageJs(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.js') && fullPath.includes(`${path.sep}pages${path.sep}`)) {
      pageFiles.push(fullPath);
    }
  });
}
collectPageJs(miniprogramRoot);
pageFiles.forEach((file) => {
  if (fs.readFileSync(file, 'utf8').includes('wx.request(')) {
    errors.push(`${path.relative(root, file)}: 页面不得直接调用 wx.request`);
  }
});

const sourceQuestions = readJson(path.join(root, 'content', 'cpp-questions.json'));
const runtimeQuestions = require(path.join(miniprogramRoot, 'modules', 'cpp', 'data', 'questions.js'));
if (sourceQuestions && JSON.stringify(sourceQuestions) !== JSON.stringify(runtimeQuestions)) {
  errors.push('运行时题库与 content/cpp-questions.json 不一致，请执行 npm run build:data');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Project structure checked: ${pageFiles.length} pages, ${wxmlFiles.length} WXML files, all routes complete.`);
