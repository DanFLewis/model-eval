'use strict';
// Tiny OpenAI-compatible mock for testing eval.js. Behavior is selected by model name:
//   mock-good       keyword classifier that answers correctly
//   mock-wrong      always answers "ignore"
//   mock-reasoning  mimics Ollama's /v1 behavior: hidden reasoning eats a 300-token budget, so with
//                   max_tokens <= 300 content is empty and finish_reason is "length"
//   mock-flaky      first request per input gets 429 with Retry-After: 1
const http = require('http');

function classify(t) {
  t = t.toLowerCase();
  if (/newsletter|new remote|jobs near you/.test(t)) return 'ignore';
  if (/decided to move forward with other|received|still reviewing/.test(t)) return 'track_only';
  if (/\bat \d|\d(am|pm)|due monday/.test(t) && !/availability/.test(t)) return 'add_to_calendar';
  return 'reply_needed';
}

function start(port = 0) {
  const seen = new Set();
  const stats = { requests: 0, lastMaxTokens: null };
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (d) => (b += d));
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end(); }
      stats.requests++;
      const body = JSON.parse(b);
      stats.lastMaxTokens = body.max_tokens;
      const user = body.messages[body.messages.length - 1].content;
      if (body.model === 'mock-flaky' && !seen.has(user)) {
        seen.add(user);
        res.writeHead(429, { 'Retry-After': '1' });
        return res.end('{}');
      }
      let content, finish = 'stop';
      if (body.model === 'mock-wrong') content = '{"action":"ignore","reason":"always wrong"}';
      else if (body.model === 'mock-reasoning' && body.max_tokens <= 300) { content = ''; finish = 'length'; }
      else content = '{"action":"' + classify(user) + '","reason":"mock"}';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish }] }));
    });
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok({ server, stats, port: server.address().port })));
}

module.exports = { start };
if (require.main === module) start(Number(process.argv[2] || 8799)).then((s) => console.log('mock listening on ' + s.port));
