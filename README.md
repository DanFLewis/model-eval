# model-eval

A small, zero-dependency Node tool for scoring a model on a labelled classification task through any OpenAI-compatible `/chat/completions` endpoint. Node 18+ (uses built-in `fetch`).

It started as a one-off script for checking whether a small local model could triage job-search emails into four actions. This version separates the pieces: cases, prompt, and target are all inputs.

## Usage

    node eval.js --cases cases.email-triage.json --prompt prompt.email-triage.txt \
      --base-url http://localhost:11434/v1 --model gemma4:e4b --max-tokens 700

Target settings come from flags or environment: `EVAL_BASE_URL`, `EVAL_MODEL`, `EVAL_API_KEY` (optional; sent as a Bearer token). Prefer the env var for keys.

| Flag | Purpose |
| --- | --- |
| `--max-tokens` | Sent as `max_tokens`. Default 700. See FINDINGS.md before lowering it for reasoning models. |
| `--delay-ms` | Pause between requests, for rate-limited gateways. |
| `--retries` | Retries on 429, 5xx and network errors (default 3). Honors `Retry-After`, else exponential backoff capped at 30 s. |
| `--timeout-ms` | Per-request timeout (default 120000). |
| `--label-field` | JSON field in the model's reply that holds the label (default from the cases file, else `action`). |
| `--extra` | JSON merged into the request body, e.g. `'{"think":false}'`. |
| `--out` | Results file (default `results.<model>.json`). |

Output is a per-case PASS/FAIL line, then a summary with accuracy and average and p95 latency. The results JSON holds the same summary plus, per case: expected, got, error, the model's stated reason, latency, and `finish_reason`. Exit code is 0 only if every case passes (2 for usage errors).

## File formats

Cases file:

    { "labelField": "action", "cases": [ { "id": "rejection", "input": "<email text>", "expected": "track_only" } ] }

The prompt file is used verbatim as the system message. The model must answer with a JSON object; the first `{...}` span in the reply is parsed and `labelField` is compared to `expected`. Empty content, missing JSON, and malformed JSON are each recorded as a distinct error and count as a failure.

## Tests

    node test/run-tests.js

Starts `test/mock-server.js` (a local fake endpoint) and checks scoring, exit codes, the default `max_tokens`, empty-content detection, and 429/`Retry-After` retry. These test the tool, not any model.

## Sample data

`cases.email-triage.json` has 13 hand-written emails across four actions (`reply_needed`, `add_to_calendar`, `track_only`, `ignore`). Names, places and addresses are generic. 13 cases is enough to catch a broken prompt or config, not to rank models; treat differences of one case as noise.
