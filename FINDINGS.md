# Findings

## Hidden reasoning consumes max_tokens on Ollama's OpenAI-compatible endpoint

When a model that supports thinking (gemma4:e4b here) is called through Ollama's `/v1/chat/completions`, the reasoning tokens count against `max_tokens`. With a small limit the budget is used up before any answer is written, and the response comes back with empty `message.content` and `finish_reason: "length"`. Nothing errors; the output is just blank, which looks like a model failure when it is a configuration problem.

Fix: raise `max_tokens` (700 was used for this four-label JSON task in the earlier session), or use Ollama's native `/api/chat`, which accepts `think: false` and skips the reasoning. `eval.js` reports the symptom explicitly as `empty_content (finish_reason=length; max_tokens too small?)` instead of a generic parse failure. `--extra '{"think":false}'` passes the flag through, but I have not verified it against `/v1`; the `think:false` behavior on the native endpoint is from the earlier session.

The mock server in `test/` reproduces the symptom (empty content plus `finish_reason: "length"` below a threshold) so the detection path is tested. The mock says nothing about Ollama itself.

## Measurements

- **Earlier session, not produced by this tool:** the original single-file script scored 12/13 on gemma4:e4b through a personal gateway with `max_tokens: 700` and 13 s between requests. That run used unsanitized emails. Only the count carries over; no per-case record or latency figures from it are included here.
- **This tool against the mock server:** passes its four checks (13/13 for a correct mock, 2/13 for an always-"ignore" mock, empty content flagged at `max_tokens` 200 and recovered at 700, 429 retried). These verify the tool, not a model.
- **This tool against local Ollama:** one run was attempted at `http://localhost:11434/v1` with gemma4:e4b. All 13 requests returned HTTP 500 because the Ollama runner failed to start the model (a memory allocation error on this machine). No model output was obtained, so no accuracy or latency is claimed. With default retries (3 per request) the run took about five minutes.

## Not yet done

- A clean measurement of gemma4:e4b with this tool once the model loads locally.
- `max_tokens` settings and `think:false` compared side by side on the same cases.
