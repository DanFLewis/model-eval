# Findings

## Hidden reasoning consumes max_tokens on Ollama's OpenAI-compatible endpoint

When a model that supports thinking (gemma4:e4b here) is called through Ollama's `/v1/chat/completions`, the reasoning tokens count against `max_tokens`. With a small limit the budget is used up before any answer is written, and the response comes back with empty `message.content` and `finish_reason: "length"`. Nothing errors; the output is just blank, which looks like a model failure when it is a configuration problem.

Fix: raise `max_tokens` (700 was used for this four-label JSON task in the earlier session), or use Ollama's native `/api/chat`, which accepts `think: false` and skips the reasoning. `eval.js` reports the symptom explicitly as `empty_content (finish_reason=length; max_tokens too small?)` instead of a generic parse failure. `--extra '{"think":false}'` passes the flag through, but I have not verified it against `/v1`; the `think:false` behavior on the native endpoint is from the earlier session.

The mock server in `test/` reproduces the symptom (empty content plus `finish_reason: "length"` below a threshold) so the detection path is tested. The mock says nothing about Ollama itself.

## Measurements

- **Earlier session, not produced by this tool:** the original single-file script scored 12/13 on gemma4:e4b through a local gateway with `max_tokens: 700` and 13 s between requests. That run used unsanitized emails. Only the count carries over; no per-case record or latency figures from it are included here.
- **This tool against the mock server:** passes its four checks (13/13 for a correct mock, 2/13 for an always-"ignore" mock, empty content flagged at `max_tokens` 200 and recovered at 700, 429 retried). These verify the tool, not a model.
- **This tool against local Ollama (v0.40.16), 13 cases, temperature 0, `max_tokens` 700, `http://localhost:11434/v1`:**

| Model | Options | Correct | Avg latency | p95 | Errors |
|---|---|---|---|---|---|
| gemma4:e4b | default | 12/13 (92.3%) | 1300 ms | 1700 ms | 0 |
| gemma4:e4b | `think:false` | 12/13 (92.3%) | 1225 ms | 1491 ms | 0 |
| qwen3.5:9b | default | 5/13 (38.5%) | 8186 ms | 19740 ms | 8 |
| qwen3.5:9b | `think:false` | 5/13 (38.5%) | 8216 ms | 12470 ms | 8 |

  Result files are in `results/`. gemma4:e4b misses one case (an onsite reminder it labels `reply_needed` instead of `add_to_calendar`) in both runs. The latency difference between its two runs is small and could be noise. All 8 qwen3.5:9b errors are `empty_content` with `finish_reason=length`: its reasoning uses up the 700 tokens, so qwen's 38.5% mostly measures the token budget, not its judgment.

- **`think:false` on `/v1` does not work.** For qwen3.5:9b a `/v1` call with `think:false` still returned empty content plus a `reasoning` field, and the error count did not change. The same flag on the native `/api/chat` endpoint returned a normal reply with no thinking. For gemma4:e4b the flag changed nothing measurable.
- **An earlier attempt failed.** The first real run returned HTTP 500 on all 13 requests because Ollama could not allocate a ~2.8 GB pinned host-memory block. A later retry loaded the model on the first request with no changes, so the cause was most likely a transient low-memory state on this machine. That is inference; it was not reproduced.

## Not yet done

- Run `max_tokens` settings (e.g. 200 vs 700) side by side on the same cases against a real model.
- Give qwen3.5:9b a larger budget (or use `/api/chat` with `think:false`) so it can be compared with gemma4:e4b fairly.
- Repeat runs to see how much of the latency and accuracy difference is noise.
