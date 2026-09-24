# AI provider architecture

## Interface

```ts
interface LLMProvider {
  structuredGenerate<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
  textGenerate(request: TextRequest): Promise<TextResult>;
}
```

Business logic depends only on this interface (`src/ai/provider.ts`).
Adapters implement `ModelBackend.complete()`; `createProvider` wraps a backend
with routing and the structured-output guard.

## Adapters

| Backend | File | Notes |
|---|---|---|
| mock | `src/ai/providers/mock.ts` + `mock-synthesisers.ts` | Deterministic; derives output from the input (regex dates, keyword classification, template drafting). Serves every task. Test hook `MockBackend.scriptResponse(task, text|Error)`. Refused in production unless `ALLOW_MOCK_LLM_IN_PRODUCTION=1`. |
| anthropic | `src/ai/providers/anthropic.ts` | Messages API via `fetch`; no SDK. |
| openai_compatible | `src/ai/providers/openai-compatible.ts` | Chat completions via `fetch`; works with OpenAI, Azure, Mistral, Ollama, vLLM. |

## Structured output guard

`src/ai/structured.ts`: appends the JSON schema description to the system
prompt, strips fences, parses, validates with Zod, retries once with the
validation errors, then throws `ProviderError`. Partial or unchecked data is
never returned. Backend failures are wrapped as `ProviderError`.

## Routing

Capabilities → tiers (`src/ai/routing.ts`):

| Capability | Tier | Used for |
|---|---|---|
| classification, extraction | cheap | route inference, document type, dates/events |
| structuring, drafting | mid | summaries, chronology synthesis, letters, preparation notes |
| analysis, critique | high | possible-claim analysis, reviewer |

Environment: `LLM_PROVIDER`, `LLM_MODEL_CHEAP|MID|HIGH`, `LLM_MODEL_<CAPABILITY>`.
The most expensive model is never used for routine interactions.

## Tasks

| Task | Capability | Output |
|---|---|---|
| `extract_document_v1` | extraction | document type/date/author, proposed events, proposed facts, employer allegations |
| `classify_document_v1` | classification | document type |
| `infer_routes_v1` | classification | candidate entry routes + clarifying questions |
| `summarise_case_v1` | structuring | "what is happening" + still unclear |
| `draft_<artifact>_v1` | drafting | Markdown document from confirmed material |
| `analyse_claim_v1` | analysis | element-by-element factual status from confirmed facts (fact ids only) |
| `review_analysis_v1` | critique | ten control questions; findings can only downgrade |

Prompts forbid invented facts, scores, percentages and strength words; the
deterministic review (`src/legal/claims/review.ts`) enforces the same in code.

## Failure behaviour

- Extraction proposal failure: text is kept, document marked `requires_review`, user can retry.
- Claim analysis failure: affected elements become `information_missing`; deterministic elements still computed.
- Reviewer failure: deterministic checks still run; uncertainty recorded.
- Drafting failure: surfaced as an error; case record untouched.

## Fair use

`src/entitlements/fair-use.ts` counts generations per user/case/kind/day with
configurable limits. Consumers never see tokens or credits.

## Data handling

Only the material needed for the task is sent (confirmed facts and events,
document text for extraction). No cross-case context. Provider keys live only
in server environment variables.
