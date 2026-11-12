#!/usr/bin/env node
'use strict';
// Zero-dependency eval runner for OpenAI-compatible /v1/chat/completions endpoints.
const fs = require('fs');

const HELP = `Usage: node eval.js --cases <file> --prompt <file> [options]

  --cases <file>        JSON: {labelField?, cases:[{id?, input, expected}]}   (required)
  --prompt <file>       system prompt text file                                (required)
  --base-url <url>      API base, e.g. http://localhost:11434/v1   (env EVAL_BASE_URL)
  --model <name>        model name                                 (env EVAL_MODEL)
  --api-key <key>       bearer token, optional                     (env EVAL_API_KEY)
  --max-tokens <n>      max_tokens sent per request (default 700)
  --temperature <x>     default 0
  --delay-ms <n>        pause between requests (default 0)
  --retries <n>         retries on 429/5xx/network error (default 3); honors Retry-After
  --timeout-ms <n>      per-request timeout (default 120000)
  --label-field <name>  JSON field holding the label (default: cases file labelField, else "action")
  --out <file>          results JSON path (default results.<model>.json)
  --extra <json>        extra JSON merged into the request body, e.g. '{"think":false}'
Prefer env vars for the key so it stays out of shell history.`;

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--help' || k === '-h') { console.log(HELP); process.exit(0); }
    if (!k.startsWith('--')) throw new Error('unexpected argument: ' + k);
    const v = argv[++i];
    if (v === undefined) throw new Error('missing value for ' + k);
    a[k.slice(2)] = v;
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : 0);

async function callOnce(url, headers, body, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { method: 'POST', headers, body, signal: ctl.signal });
  } finally { clearTimeout(t); }
}

async function request(cfg, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions';
  let lastErr;
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    try {
      const r = await callOnce(url, headers, body, cfg.timeoutMs);
      if (r.status === 429 || r.status >= 500) {
        const ra = Number(r.headers.get('retry-after'));
        const wait = ra > 0 ? ra * 1000 : Math.min(30000, 1000 * 2 ** attempt);
        lastErr = 'HTTP ' + r.status;
        if (attempt < cfg.retries) { await sleep(wait); continue; }
        return { status: r.status, error: lastErr };
      }
      if (r.status !== 200) return { status: r.status, error: 'HTTP ' + r.status };
      return { status: 200, json: await r.json() };
    } catch (e) {
      lastErr = e.name === 'AbortError' ? 'timeout' : String(e.message || e);
      if (attempt < cfg.retries) { await sleep(Math.min(30000, 1000 * 2 ** attempt)); continue; }
    }
  }
  return { status: 0, error: lastErr };
}

function extractLabel(text, field) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { error: 'no_json' };
  try {
    const j = JSON.parse(m[0]);
    return { label: j[field], reason: j.reason };
  } catch { return { error: 'bad_json' }; }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args['base-url'] || process.env.EVAL_BASE_URL;
  const model = args.model || process.env.EVAL_MODEL;
  if (!args.cases || !args.prompt || !baseUrl || !model) { console.error(HELP); process.exit(2); }
  const spec = JSON.parse(fs.readFileSync(args.cases, 'utf8').replace(/^﻿/, ''));
  const system = fs.readFileSync(args.prompt, 'utf8').trim();
  const field = args['label-field'] || spec.labelField || 'action';
  const cfg = {
    baseUrl, apiKey: args['api-key'] || process.env.EVAL_API_KEY || '',
    retries: Number(args.retries ?? 3), timeoutMs: Number(args['timeout-ms'] ?? 120000),
  };
  const maxTokens = Number(args['max-tokens'] ?? 700);
  const temperature = Number(args.temperature ?? 0);
  const delayMs = Number(args['delay-ms'] ?? 0);
  const extra = args.extra ? JSON.parse(args.extra) : {};
  const out = args.out || `results.${model.replace(/[^\w.-]+/g, '_')}.json`;

  const results = [];
  for (let i = 0; i < spec.cases.length; i++) {
    const c = spec.cases[i];
    const id = c.id || 'case-' + (i + 1);
    const body = JSON.stringify({
      model, temperature, max_tokens: maxTokens, ...extra,
      messages: [{ role: 'system', content: system }, { role: 'user', content: c.input }],
    });
    const t0 = Date.now();
    const r = await request(cfg, body);
    const latencyMs = Date.now() - t0;
    let got = null, reason = '', error = r.error || null, finish = null;
    if (r.json) {
      const ch = r.json.choices && r.json.choices[0];
      const content = (ch && ch.message && ch.message.content) || '';
      finish = ch && ch.finish_reason;
      if (!content.trim()) {
        error = 'empty_content' + (finish === 'length' ? ' (finish_reason=length; max_tokens too small?)' : '');
      } else {
        const e = extractLabel(content, field);
        got = e.label ?? null; reason = e.reason || ''; error = e.error || null;
      }
    }
    const pass = got === c.expected;
    results.push({ id, expected: c.expected, got, pass, error, reason, latencyMs, finishReason: finish });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${id.padEnd(24)} want=${String(c.expected).padEnd(16)} got=${String(got ?? '-').padEnd(16)} ${String(latencyMs).padStart(6)}ms${error ? '  [' + error + ']' : ''}`);
    if (delayMs && i < spec.cases.length - 1) await sleep(delayMs);
  }

  const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const passed = results.filter((r) => r.pass).length;
  const summary = {
    model, baseUrl, maxTokens, temperature, total: results.length, passed,
    accuracy: results.length ? passed / results.length : 0,
    latencyAvgMs: Math.round(lat.reduce((s, x) => s + x, 0) / (lat.length || 1)),
    latencyP95Ms: pct(lat, 0.95),
    errors: results.filter((r) => r.error).length,
  };
  console.log(`\n${model}: ${passed}/${summary.total} correct (${(summary.accuracy * 100).toFixed(1)}%), latency avg ${summary.latencyAvgMs}ms, p95 ${summary.latencyP95Ms}ms, errors ${summary.errors}`);
  fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
  console.log('wrote ' + out);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => { console.error(e.message || e); process.exit(2); });
