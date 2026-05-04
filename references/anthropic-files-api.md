# Files API — Cascade reference (research only)

The Files API lets you upload a document once and reference it by `file_id` in many requests, instead of re-uploading content. For Cascade's growing knowledge base, this is the right shape long-term — pay for upload once, reference often.

**Status: research only, not implemented.** This doc captures the design constraints so a future Cascade slice can adopt it cleanly.

## Beta status

Currently beta. Requires header `anthropic-beta: files-api-2025-04-14` on every request. Not supported on Bedrock or Vertex AI (relevant if Cascade ever ports). Direct Claude API only.

## Key facts for Cascade

- **Files persist until deleted.** No expiry. Stored in workspace-scoped storage.
- **Free to upload, store, and download metadata.** Only billed for tokens at messaging time.
- **Limits:** 500 MB per file, 500 GB per organization. Cascade's entire knowledge corpus would fit in one file.
- **Workspace-scoped.** All API keys in a workspace share the same file pool.
- **File API rate limit during beta:** ~100 requests/minute. Plenty for Cascade.

## Two ways to use it

### Pattern A — one big knowledge corpus file (custom content)

Cascade's `KnowledgeLesson` rows are stored locally in SQLite. We could periodically (on harvest, or nightly) build a single text or JSON file from the corpus, upload it, and store the `file_id` in `CascadeConfig`. Every Overseer request that wants knowledge access references that one file.

Tradeoffs:
- ✅ One file_id to manage. Cheap to reference.
- ✅ Combines with caching: the file's content can sit in the cached prefix.
- ❌ Re-upload required when lessons change. A new lesson harvested means uploading a new corpus.
- ❌ No fine-grained citation back to a single lesson without custom-content document blocks.

### Pattern B — per-lesson files (one file per lesson)

Each `KnowledgeLesson` becomes one Files API entry. The Overseer attaches multiple `file_id` references per request. Lesson updates re-upload one file.

Tradeoffs:
- ✅ Fine-grained citation possible — each lesson is its own document.
- ✅ Lesson updates are localized.
- ❌ More API calls to manage (upload, delete, list).
- ❌ Each request references multiple file_ids; less obvious how to combine with caching breakpoint placement.

## Upload

```bash
curl -X POST https://api.anthropic.com/v1/files \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: files-api-2025-04-14" \
  -F "file=@/path/to/lesson-L-42.txt"
```

Response:

```json
{
  "id": "file_011CNha8iCJcU1wXNR6q4V8w",
  "type": "file",
  "filename": "lesson-L-42.txt",
  "mime_type": "text/plain",
  "size_bytes": 1024,
  "created_at": "2026-05-01T00:00:00Z",
  "downloadable": false
}
```

Cascade would persist `id` to a new column on `KnowledgeLesson` (e.g. `anthropicFileId String?`).

## Reference in a Messages request

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
          "source": { "type": "file", "file_id": "file_011CNha8iCJcU1wXNR6q4V8w" },
          "title": "Lesson L-42: SQLite WAL mode",
          "citations": { "enabled": true }
        },
        { "type": "text", "text": "How should I handle this lock issue?" }
      ]
    }
  ]
}
```

## Combines with citations and caching

- **Citations work directly on `file_id`-referenced documents.** Plain-text files chunk to sentences (citations come back as character indices); PDFs chunk to sentences-with-page-numbers (page citations).
- **Prompt caching:** placing `cache_control` on a document block that uses `file_id` caches the document content (the model still loads the bytes from the file once per cache write). Subsequent reads hit cache normally.

This is the strongest case for the Files API: large knowledge documents that are re-read often. Citations attribute model claims to specific lesson spans; caching means each request only pays for the dynamic suffix.

## Lifecycle management

- **List:** `GET /v1/files` returns all files in the workspace.
- **Get metadata:** `GET /v1/files/{file_id}`.
- **Delete:** `DELETE /v1/files/{file_id}`. After delete, files become inaccessible to new requests but in-flight requests already referencing them complete normally.
- **Download:** only files created by skills/code execution can be downloaded. Files Cascade uploaded cannot be re-downloaded — keep your local source of truth.

## Cost model

- Upload, list, delete, metadata: **free**.
- Token costs at messaging time only — same as inlining the content. The Files API saves no tokens, only bandwidth and request size.

## When Cascade should adopt this

The decision criteria, ordered by importance:

1. **Knowledge corpus exceeds 50K tokens regularly attached to requests.** Inlining 50K tokens per request when the corpus is mostly stable is wasteful even with caching, because every cache write is paid in full. File-referenced content amortizes the storage but the actual token cost is the same — the win is bandwidth and request body size.
2. **`knowledge-matcher` is rewritten to operate on file_id references.** This is the trigger; the matcher v2 is the natural place to introduce file-id awareness.
3. **You're confident about workspace boundaries.** Files are workspace-scoped — a Cascade-hosted-for-team variant would need per-team file_id pools.

Until those are true, **inlining the matched lessons as plain-text documents is simpler and cheaper per request** for Cascade's current scale.

## Recommended path

- **Phase 25 (UX polish):** stay inline. Use plain-text or custom-content documents per request, with citations enabled and `cache_control` on the document block.
- **Future phase:** when `knowledge-matcher` is rewritten or the corpus grows past ~50 lessons, evaluate Files API. Add `anthropicFileId` to `KnowledgeLesson`, write an upload-on-create hook, transition to Pattern B.

## References

- Files API: https://platform.claude.com/docs/en/docs/build-with-claude/files
- Citations on file-referenced documents: https://platform.claude.com/docs/en/docs/build-with-claude/citations
