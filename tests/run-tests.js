import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🚀 Running Location Simulator Test Suite...');

const testFiles = ['variance.test.js', 'route.test.js'];
let passed = 0;

for (const file of testFiles) {
  const filePath = path.join(__dirname, file);
  console.log(`\n▶ Running ${file}...`);
  const result = spawnSync('node', [filePath], { stdio: 'inherit' });
  if (result.status === 0) {
    passed++;
  } else {
    console.error(`❌ Test file ${file} failed!`);
    process.exit(1);
  }
}

console.log(`\n🎉 All ${passed}/${testFiles.length} test suites passed cleanly!`);
