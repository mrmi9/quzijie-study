const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const contentDirectory = path.join(root, 'content');
const targetPath = path.join(root, 'miniprogram', 'data', 'questions.js');
const sourceFiles = fs.readdirSync(contentDirectory)
  .filter((name) => name.endsWith('-questions.json'))
  .sort();
const questions = sourceFiles.flatMap((name) => JSON.parse(fs.readFileSync(path.join(contentDirectory, name), 'utf8')));
const output = [
  '// 此文件由 npm run build:data 从 content/*-questions.json 生成，请勿直接编辑。',
  `module.exports=${JSON.stringify(questions)};`,
  ''
].join('\n');

fs.writeFileSync(targetPath, output, 'utf8');
console.log(`Generated ${path.relative(root, targetPath)} from ${sourceFiles.length} banks with ${questions.length} questions.`);
