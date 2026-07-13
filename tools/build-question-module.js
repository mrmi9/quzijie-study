const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'content', 'cpp-questions.json');
const targetPath = path.join(root, 'miniprogram', 'modules', 'cpp', 'data', 'questions.js');
const questions = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const output = [
  '// 此文件由 npm run build:data 从 content/cpp-questions.json 生成，请勿直接编辑。',
  `module.exports = ${JSON.stringify(questions, null, 2)};`,
  ''
].join('\n');

fs.writeFileSync(targetPath, output, 'utf8');
console.log(`Generated ${path.relative(root, targetPath)} with ${questions.length} questions.`);
