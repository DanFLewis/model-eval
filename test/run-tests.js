'use strict';
const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { start } = require('./mock-server');

const root = path.join(__dirname, '..');
function run(port, model, extra = []) {
  const out = path.join(os.tmpdir(), `eval-test-${model}-${Date.now()}.json`);
  return new Promise((ok) => {
    const p = spawn(process.execPath, [path.join(root, 'eval.js'),
      '--cases', path.join(root, 'cases.email-triage.json'), '--prompt', path.join(root, 'prompt.email-triage.txt'),
      '--base-url', `http://127.0.0.1:${port}/v1`, '--model', model, '--out', out, ...extra]);
    let stdout = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.on('close', (code) => ok({ code, stdout, json: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null }));
  });
}

(async () => {
  const { server, stats, port } = await start(0);
  try {
    let r = await run(port, 'mock-good');
    assert.strictEqual(r.json.summary.total, 13);
    assert.strictEqual(r.json.summary.passed, 13, r.stdout);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(stats.lastMaxTokens, 700);
    console.log('ok  good model scores 13/13; default max_tokens is 700');

    r = await run(port, 'mock-wrong');
    assert.strictEqual(r.json.summary.passed, 2);
    assert.strictEqual(r.code, 1);
    console.log('ok  always-ignore model scores 2/13 and exits 1');

    r = await run(port, 'mock-reasoning', ['--max-tokens', '200']);
    assert.strictEqual(r.json.summary.passed, 0);
    assert.ok(r.json.results.every((x) => /empty_content/.test(x.error) && x.finishReason === 'length'));
    r = await run(port, 'mock-reasoning', ['--max-tokens', '700']);
    assert.strictEqual(r.json.summary.passed, 13);
    console.log('ok  empty content flagged at max_tokens=200; recovers at 700');

    const t0 = Date.now();
    r = await run(port, 'mock-flaky');
    assert.strictEqual(r.json.summary.passed, 13);
    assert.ok(Date.now() - t0 >= 13000, 'Retry-After not honored');
    console.log('ok  429 with Retry-After retried; all 13 recovered');
  } finally { server.close(); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
