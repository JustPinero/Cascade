# Citations — Cascade reference

Anthropic's Citations API lets the model emit response text with structured citations attached, pointing at specific spans in source documents. For Cascade, the use case is **inline citations from the knowledge base** — when the Overseer answers using a `KnowledgeLesson`, the response should reference the lesson by ID with a clickable link to its detail page.

## When to use the API vs. roll-our-own

**Roll-our-own with structured prompting** (the obvious-but-wrong path): tell the model in the system prompt to wrap quotes in `[L-42]` tags and parse them client-side. Cheaper to ship initially but:

- Output tokens for citations count toward billing.
- Citation accuracy is unreliable; the model may invent references or miss them.
- Cited text drifts from source text (paraphrasing).

**Anthropic Citations API** (the right path):

- `cited_text` does not count toward output tokens.
- Citations are guaranteed to point at real spans in the provided documents.
- Higher citation quality measured against humans.

## Custom content documents are the right fit for knowledge lessons

Three document types are supported. Choose based on the citation granularity you want:

| Document type | Chunked into | Citation refers to |
|---------------|--------------|---------------------|
| Plain text | Sentences | Character indices |
| PDF | Sentences (page-aware) | Page numbers |
| **Custom content** | **Provided blocks (no further chunking)** | **Block index** |

Cascade's lessons have natural boundaries — each `KnowledgeLesson` is one coherent unit. Custom content lets us put one lesson per block; citations come back as `start_block_index` / `end_block_index` that map directly to lesson IDs.

## Request shape

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 2048,
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "document",
          "source": {
            "type": "content",
            "content": [
              { "type": "text", "text": "Lesson L-42: SQLite WAL mode causes false-positive lock errors when..." },
              { "type": "text", "text": "Lesson L-43: Prisma's default connection pool of 5 is too low for serverless..." }
            ]
          },
          "title": "Cascade Knowledge Base — relevant lessons",
          "context": "Each block is one knowledge lesson. The block index maps to lesson IDs L-42, L-43, ... in order.",
          "citations": { "enabled": true },
          "cache_control": { "type": "ephemeral" }
        },
        { "type": "text", "text": "How should I handle the database lock issue I'm seeing?" }
      ]
    }
  ]
}
```

Notes:

- `citations.enabled: true` must be set on the document. **Citations must be enabled on all-or-none of documents in a request** — partial enables aren't allowed.
- `cache_control` on the document caches the source content. Citations themselves aren't cached, but the document the model reads from is.
- The `context` field is metadata the model sees but cannot cite from. Useful for "block index 0 = lesson L-42" mappings.
- `title` is short and visible to the model; Cascade can use it for the page title link.

## Response shape

```json
{
  "content": [
    { "type": "text", "text": "Looks like the WAL-mode false positives. " },
    {
      "type": "text",
      "text": "Switching to journal mode resolves it.",
      "citations": [
        {
          "type": "content_block_location",
          "cited_text": "SQLite WAL mode causes false-positive lock errors",
          "document_index": 0,
          "document_title": "Cascade Knowledge Base — relevant lessons",
          "start_block_index": 0,
          "end_block_index": 1
        }
      ]
    }
  ]
}
```

The response is a sequence of text blocks; some have citations attached. Render them in order, with citations injected as inline links.

## Mapping block index back to lesson ID

Cascade's loader needs to remember the mapping between `block_index` and `KnowledgeLesson.id` for each request:

```ts
function buildKnowledgeDocument(lessons: KnowledgeLesson[]) {
  return {
    type: "document" as const,
    source: {
      type: "content" as const,
      content: lessons.map((l) => ({ type: "text" as const, text: `${l.title}: ${l.content}` })),
    },
    title: "Cascade Knowledge Base — relevant lessons",
    context: lessons.map((l, i) => `Block ${i} = lesson L-${l.id}`).join("; "),
    citations: { enabled: true },
    cache_control: { type: "ephemeral" },
  };
}

// Track mapping for the response decoder:
const blockToLessonId = lessons.map((l) => l.id);
// citation.start_block_index → blockToLessonId[idx] → URL: /knowledge/lesson/L-42
```

## Streaming

Citations emit as `citations_delta` events attached to existing text content blocks:

```sse
event: content_block_delta
data: { "type": "content_block_delta", "index": 1, "delta": { "type": "text_delta", "text": "..." } }

event: content_block_delta
data: { "type": "content_block_delta", "index": 1,
        "delta": { "type": "citations_delta",
                   "citation": { "type": "content_block_location",
                                 "cited_text": "...",
                                 "document_index": 0,
                                 "start_block_index": 0,
                                 "end_block_index": 1 } } }
```

Accumulate citations onto the text block they belong to, the same way you accumulate text deltas.

## Compatibility with other features

| Feature | Compatible? |
|---------|-------------|
| Prompt caching (on documents) | ✅ Yes — encouraged for large knowledge bases |
| Token counting | ✅ Yes |
| Batch processing | ✅ Yes |
| Tool use | ✅ Yes |
| **Structured Outputs** | ❌ **Incompatible** — returns 400 |
| Web search | ✅ Yes (web search is itself a kind of citation source) |

The structured outputs incompatibility is irrelevant for Cascade's Overseer, which uses tool-use rather than structured outputs.

## Implementation outline for Phase 25

The natural integration point is at the moment the Overseer is about to answer a knowledge-related question. Two paths:

**Path A — always include relevant lessons as a document.** Before each Overseer request, the route handler runs `knowledge-matcher` over the user's message, attaches top-N matching lessons as a citations-enabled document. The model has them at hand if useful, ignores them if not.

**Path B — only include when the model asks.** A new tool `query_knowledge_with_citations({ query, topN })` returns matching lessons as a document block in the tool result. The model calls this tool when it wants citable knowledge.

Path B is cleaner — keeps cache prefixes stable when knowledge isn't relevant, lets the model decide when to fetch. Path A is simpler but bloats every request with potentially-irrelevant lesson documents.

Recommend Path B.

## Cost considerations

- Enabling citations adds slightly to input tokens (system prompt additions plus chunked document storage).
- `cited_text` does not count toward output tokens.
- When passed back in subsequent turns, `cited_text` does not count toward input tokens either.

Net: cheaper than emitting citations via prompt-engineered output, despite the small input overhead.

## References

- Citations: https://platform.claude.com/docs/en/docs/build-with-claude/citations
- Files API (alternative document source): see `references/anthropic-files-api.md`
