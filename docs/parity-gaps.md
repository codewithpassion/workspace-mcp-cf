# Parity Gaps — Workers Runtime Limitations

All 121 Python tools are ported and **registered**. The tools below are present and callable but have **reduced behavior** vs. the Python reference because the Cloudflare Workers runtime lacks the required libraries/CPU/filesystem (per plan §8). None are silently dropped — each returns a clear "not supported in this runtime" or best-effort result.

## Drive (`gdrive`)
- **get_drive_file_content** — Google-native export (Docs/Sheets/Slides → text) works. DOCX/XLSX/PPTX Office-XML text extraction and PDF text extraction are **not supported** (no `zipfile`/`pdfminer`); returns an explanatory message for those binary types.
- **get_drive_file_download_url** — No local file save / temp-URL service in Workers; returns metadata + a small base64 preview. Use `get_drive_file_content` for text.
- **create_drive_file / update_drive_file** — `file_path` / `file://` sources **not supported** (no local FS); `file_url` (HTTP/HTTPS) and inline/base64 content work.

## Docs (`gdocs`)
- **get_doc_content** — Native docs work (tab traversal). Non-native binary (Office-XML/PDF) text extraction **not supported**; returns a message.
- **get_doc_as_markdown** — Best-effort converter (headings, bold/italic, links, tables, lists; comments as appendix). Not byte-identical to the Python `convert_doc_to_markdown`.
- **manage_doc_tab** (`populate_from_markdown` action) — **Not supported**; the position-based Markdown→Docs request generator isn't available. Other actions (create/rename/delete) work. Workaround: `batch_update_doc` + `update_paragraph_style`.
- Comment inline anchoring → rendered as an appendix (Drive comments API can't anchor to text anyway).

## Gmail (`gmail`)
- **send_gmail_message / draft_gmail_message** — MIME is hand-built (RFC822 → URL-safe base64). Plain + HTML + simple attachments + inline images supported on a best-effort basis (no Python `email.message`).
- **get_gmail_messages_content_batch / get_gmail_threads_content_batch** — Gmail Batch HTTP API not available; implemented via **sequential fetching** (same results, more requests).

## Chat (`gchat`)
- **download_chat_attachment** — No local file storage / temp-URL in Workers; returns metadata + base64 (best-effort) with an explanatory note.

## Search (`gsearch`)
- **search_custom / get_search_engine_info** — Require `GOOGLE_PSE_API_KEY` + `GOOGLE_PSE_ENGINE_ID` (API-key, not OAuth). Return a clear "not configured" message if the secrets are absent.

---
These are inherent to the serverless runtime, not porting defects. Revisit if/when a Workers-compatible extraction path (e.g. an external extraction service or a WASM library) is added.
