// Runs every suite and prints one line each. Usage: node tests/all.js   (no install needed)
const { spawnSync } = require('child_process'), path = require('path');
const suites = ['api', 'spec', 'spec2', 'spec3', 'e2e', 'e2e-spec'];
let bad = 0, total = 0;
for (const s of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, s + '.js')], { encoding: 'utf8' });
  const out = (r.stdout || '').split('\n'), passed = out.filter(l => l.startsWith('PASS')).length, failed = out.filter(l => l.startsWith('FAIL')).length;
  total += passed; bad += failed + (r.status === 0 ? 0 : failed ? 0 : 1);
  console.log(`${s.padEnd(9)} ${String(passed).padStart(4)} passed  ${failed} failed ${r.status === 0 ? '' : ' <-- exit code ' + r.status}`);
  out.filter(l => l.startsWith('FAIL') || l.startsWith('CRASH')).forEach(l => console.log('   ' + l.slice(0, 200)));
}
console.log(`\n${total} checks passed, ${bad} problems`);
process.exit(bad ? 1 : 0);
