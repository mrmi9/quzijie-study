const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const ignored = new Set(['.git', 'node_modules', 'miniprogram_npm', 'dist', 'generated']);
const files = [];

function walk(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    if (ignored.has(entry.name)) return;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  });
}

walk(root);
const failures = [];
files.forEach((file) => {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${path.relative(root, file)}\n${result.stderr}`);
});

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Syntax checked ${files.length} JavaScript files.`);
