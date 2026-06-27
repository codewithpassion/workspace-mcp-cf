# Google Workspace MCP Tool Inventory

**Source:** `taylorwilsdon/google_workspace_mcp` v1.22.0  
**Root:** `/home/roboto/devel/workspace-mcp-CF/tmp/google_workspace_mcp`  
**Date:** 2026-06-27

---

## Summary

| Module | File | Tools |
|--------|------|-------|
| Gmail | `gmail/gmail_tools.py` | 14 |
| Calendar | `gcalendar/calendar_tools.py` | 7 |
| Drive | `gdrive/drive_tools.py` | 16 |
| Docs | `gdocs/docs_tools.py` | 20 |
| Sheets | `gsheets/sheets_tools.py` | 14 |
| Slides | `gslides/slides_tools.py` | 7 |
| Forms | `gforms/forms_tools.py` | 6 |
| Tasks | `gtasks/tasks_tools.py` | 6 |
| Chat | `gchat/chat_tools.py` | 6 |
| Contacts | `gcontacts/contacts_tools.py` | 8 |
| Search | `gsearch/search_tools.py` | 2 |
| Apps Script | `gappsscript/apps_script_tools.py` | 15 |
| **TOTAL** | | **121** |

---

## Shared Core Helpers

All modules import from `core/` and `auth/`:

### Decorators & Infrastructure

| Helper | Location | Purpose |
|--------|----------|---------|
| `@server.tool(...)` | `core/server.py` | FastMCP tool registration decorator |
| `@require_google_service(service, scope)` | `auth/service_decorator.py` | Injects authenticated Google API client as first `service` arg; handles OAuth 2.1, service accounts, env-var creds |
| `@require_multiple_services([...])` | `auth/service_decorator.py` | Same but injects multiple named services (e.g. `drive` + `docs`) |
| `@handle_http_errors(name, ...)` | `core/utils.py` | Wraps HTTP errors, logs, re-raises with structured messages |
| `SCOPE_GROUPS` dict | `auth/service_decorator.py` | Maps symbolic scope names (`"gmail_read"`, `"drive_full"`, etc.) to full OAuth scope URLs |

### Utility Types

| Alias | Actual Type | Used In |
|-------|-------------|---------|
| `StringList` | `str \| List[str]` (accepts JSON array or comma-str) | gmail, gdrive, gcalendar, gchat, gtasks, gcontacts, gsearch |
| `DictList` | `List[Dict[str, Any]]` | gcontacts |
| `JsonDict` | `Dict[str, Any]` | gmail, gforms |
| `ObjectList` | `List[object]` | gappsscript |

### Cross-Cutting Utilities

| Helper | Location | Purpose |
|--------|----------|---------|
| `store_attachment()` / download URL | `core/attachment_storage.py` | stdio mode → local file path; streamable-HTTP mode → temp 1-hour URL |
| `ssrf_safe_stream(url, ...)` | `core/http_utils.py` | SSRF-safe streaming download for remote file content |
| `create_comment_tools(app_name, file_id_param)` | `core/comments.py` | Factory that registers `list_{app}_comments` + `manage_{app}_comment` tools (Drive API `comments()` / `replies()`) for Docs, Sheets, Slides |
| `TransientNetworkError` | `core/utils.py` | Raised by gchat `search_messages` when all spaces fail with SSL errors |

### OAuth Scope Constants (`auth/scopes.py`)

Key scope strings used throughout:

```
gmail.readonly         = https://www.googleapis.com/auth/gmail.readonly
gmail.send             = https://www.googleapis.com/auth/gmail.send
gmail.compose          = https://www.googleapis.com/auth/gmail.compose
gmail.modify           = https://www.googleapis.com/auth/gmail.modify
gmail.labels           = https://www.googleapis.com/auth/gmail.labels
gmail.settings.basic   = https://www.googleapis.com/auth/gmail.settings.basic
calendar               = https://www.googleapis.com/auth/calendar
calendar.readonly      = https://www.googleapis.com/auth/calendar.readonly
calendar.events        = https://www.googleapis.com/auth/calendar.events
drive                  = https://www.googleapis.com/auth/drive
drive.readonly         = https://www.googleapis.com/auth/drive.readonly
drive.file             = https://www.googleapis.com/auth/drive.file
documents              = https://www.googleapis.com/auth/documents
documents.readonly     = https://www.googleapis.com/auth/documents.readonly
spreadsheets           = https://www.googleapis.com/auth/spreadsheets
spreadsheets.readonly  = https://www.googleapis.com/auth/spreadsheets.readonly
presentations          = https://www.googleapis.com/auth/presentations
presentations.readonly = https://www.googleapis.com/auth/presentations.readonly
forms.body             = https://www.googleapis.com/auth/forms.body
forms.body.readonly    = https://www.googleapis.com/auth/forms.body.readonly
forms.responses.readonly = https://www.googleapis.com/auth/forms.responses.readonly
tasks                  = https://www.googleapis.com/auth/tasks
tasks.readonly         = https://www.googleapis.com/auth/tasks.readonly
contacts               = https://www.googleapis.com/auth/contacts
contacts.readonly      = https://www.googleapis.com/auth/contacts.readonly
chat.messages          = https://www.googleapis.com/auth/chat.messages
chat.messages.readonly = https://www.googleapis.com/auth/chat.messages.readonly
chat.spaces            = https://www.googleapis.com/auth/chat.spaces
chat.spaces.readonly   = https://www.googleapis.com/auth/chat.spaces.readonly
cse                    = https://www.googleapis.com/auth/cse
script.projects        = https://www.googleapis.com/auth/script.projects
script.projects.readonly = https://www.googleapis.com/auth/script.projects.readonly
script.deployments     = https://www.googleapis.com/auth/script.deployments
script.deployments.readonly = https://www.googleapis.com/auth/script.deployments.readonly
script.external_request = https://www.googleapis.com/auth/script.external_request  (used for run)
script.processes       = https://www.googleapis.com/auth/script.processes
script.metrics         = https://www.googleapis.com/auth/script.metrics
```

---

## 1. Gmail (`gmail/gmail_tools.py`) — 14 tools

### Module-level Helpers

- `_html_to_text(html)` — html2text conversion
- `_extract_message_body(payload)` / `_extract_message_bodies(payload)` — MIME multipart traversal
- `_format_body_content(...)` — formats body with truncation
- `_format_attachment_result(...)` / `_extract_attachments(payload)` — attachment list extraction
- `_derive_reply_headers(...)` / `_fetch_thread_reply_context(...)` — In-Reply-To / References header derivation
- `_get_send_as_signature_html(service, ...)` — fetches Send-As alias signature via `gmail.users().settings().sendAs().get()`
- `GMAIL_BATCH_SIZE = 25` — chunk size for batch API calls

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `search_gmail_messages` | Search messages by Gmail query string | `query` (req), `user_google_email` (req), `page_size` int=10, `page_token` opt | `gmail.users().messages().list()` | Formatted text: message IDs, thread IDs, Gmail web links, next_page_token | gmail.readonly | Pagination via page_token |
| 2 | `get_gmail_message_content` | Get full content of a single message | `message_id` (req), `user_google_email` (req), `body_format` "text"\|"html"\|"raw"=text | `gmail.users().messages().get()` (full or raw) | Formatted text: subject, sender, recipients, date, body | gmail.readonly | MIME multipart parsing, HTML→text fallback, raw base64url decode |
| 3 | `get_gmail_messages_content_batch` | Batch-fetch up to 25 messages | `message_ids` List[str] (req), `user_google_email` (req), `format` "full"\|"metadata"=full, `body_format` text\|html\|raw=text | `gmail.new_batch_http_request()` + `users().messages().get()` in 25-message chunks | Formatted list of messages with separators | gmail.readonly | **Gmail Batch HTTP API** in 25-msg chunks; SSL exponential backoff fallback to sequential |
| 4 | `get_gmail_attachment_content` | Download an email attachment | `message_id` (req), `attachment_id` (req), `user_google_email` (req), `return_base64` bool=False | `gmail.users().messages().attachments().get()` + re-fetch message metadata | Local file path (stdio) or temp URL (HTTP), optionally base64 block | gmail.readonly | Transport-mode-aware (`attachment_storage`); re-fetches message metadata for filename/MIME; optional inline base64 for sandboxed clients |
| 5 | `send_gmail_message` | Send new email or forward existing | `user_google_email` (req), `to` (req), `subject` opt, `body` opt, `body_format` plain\|html=plain, `forward_message_id` opt, `include_forwarded_attachments` bool=True, `cc`/`bcc`/`from_name`/`from_email`/`reply_to`/`in_reply_to`/`references` opt, `attachments` List opt, `inline_images` List[dict] opt | `gmail.users().messages().send()` with raw MIME; forward also `users().messages().get()` | Confirmation with sent message ID | gmail.readonly + gmail.send | **MIME multipart construction** (EmailMessage); inline images via multipart/related with CID; forward with attachment carry-over; Send-As alias + signature fetch |
| 6 | `draft_gmail_message` | Create an email draft | `user_google_email` (req), `subject` (req), `body` (req), `body_format` plain\|html=plain, `to`/`cc`/`bcc`/`from_name`/`from_email` opt, `attachments` List opt, `inline_images` List[dict] opt | `gmail.users().drafts().create()` | Draft ID and confirmation | gmail.compose | MIME multipart construction; inline images; Send-As aliases |
| 7 | `get_gmail_thread_content` | Get complete thread with all messages | `thread_id` (req), `user_google_email` (req), `body_format` text\|html\|raw=text, `include_analysis` bool=False | `gmail.users().threads().get()` | Formatted thread string; if `include_analysis=True` → dict `{content, analysis}` with last_sender, ball_in_court, per-sender counts, participants | gmail.readonly | Thread ownership analysis; multi-message MIME parsing |
| 8 | `get_gmail_threads_content_batch` | Batch-fetch up to 25 threads | `thread_ids` List[str] (req), `user_google_email` (req), `body_format` text\|html\|raw=text | `gmail.new_batch_http_request()` + `users().threads().get()` in 25-thread chunks | Formatted list of threads with separators | gmail.readonly | **Gmail Batch HTTP API** in 25-thread chunks; SSL exponential backoff fallback |
| 9 | `list_gmail_labels` | List all Gmail labels | `user_google_email` (req) | `gmail.users().labels().list()` | Formatted list: system labels + user labels with IDs | gmail.readonly | — |
| 10 | `manage_gmail_label` | Create, update, or delete a label | `user_google_email` (req), `action` "create"\|"update"\|"delete" (req), `name` opt, `label_id` opt, `label_list_visibility` opt, `message_list_visibility` opt | `gmail.users().labels().create/get/update/delete()` | Confirmation with label name and ID | gmail.labels | — |
| 11 | `list_gmail_filters` | List all Gmail filters | `user_google_email` (req) | `gmail.users().settings().filters().list()` | Formatted filter list with criteria and actions | gmail.settings.basic | — |
| 12 | `manage_gmail_filter` | Create or delete a filter | `user_google_email` (req), `action` "create"\|"delete" (req), `criteria` dict opt, `filter_action` dict opt, `filter_id` opt | `gmail.users().settings().filters().create/get/delete()` | Filter ID and confirmation | gmail.settings.basic | — |
| 13 | `modify_gmail_message_labels` | Add/remove labels on a single message | `user_google_email` (req), `message_id` (req), `add_label_ids` List[str] opt, `remove_label_ids` List[str] opt | `gmail.users().messages().modify()` | Confirmation with label changes | gmail.modify | Archive = remove INBOX; trash = add TRASH |
| 14 | `batch_modify_gmail_message_labels` | Add/remove labels on multiple messages | `user_google_email` (req), `message_ids` List[str] (req), `add_label_ids` List[str] opt, `remove_label_ids` List[str] opt | `gmail.users().messages().batchModify()` | Confirmation with message count | gmail.modify | Single batchModify call for all messages |

---

## 2. Google Calendar (`gcalendar/calendar_tools.py`) — 7 tools

### Module-level Helpers

- `_parse_reminders_json(reminders)` — normalizes reminders (JSON string or list)
- `_apply_transparency_if_valid(body, transparency)` — validates transparency field
- `_apply_visibility_if_valid(body, visibility)` — validates visibility field
- `_validate_auto_decline_mode(mode, fn)` — validates OOO/FocusTime auto-decline mode
- `_preserve_existing_fields(event, updates)` — read-modify-write helper for PATCH
- `_correct_time_format_for_api(dt_str, param, tz)` — RFC3339 normalization with IANA DST-aware timezone handling; date-only → datetime conversion
- `_strip_utc_offset(datetime_str)` — removes trailing UTC offset for Calendar API compatibility

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `list_calendars` | List all accessible calendars | `user_google_email` (req) | `calendar.calendarList().list()` | Formatted list: summary, ID, primary flag | calendar.readonly | — |
| 2 | `get_events` | Get events (single by ID or multiple by time range) | `user_google_email` (req), `calendar_id` str="primary", `event_id` opt, `time_min`/`time_max` RFC3339 opt, `max_results` int=25, `query` opt, `detailed` bool=False, `include_attachments` bool=False | `calendar.events().get()` (single) or `calendar.events().list()` (range) | Formatted event list with summary, time, location, attendees, links | calendar.readonly | RFC3339 normalization, DST-aware timezone, keyword search |
| 3 | `manage_event` | Create/update/delete/RSVP calendar event | `user_google_email` (req), `action` "create"\|"update"\|"delete"\|"rsvp" (req), `summary`/`start_time`/`end_time`/`event_id`/`calendar_id`/`description`/`location`/`attendees`/`timezone`/`attachments`/`add_google_meet`/`conference_data`/`conference_provider`/`conference_uri`/`conference_passcode`/`conference_id`/`reminders`/`use_default_reminders`/`transparency`/`visibility`/`color_id`/`recurrence`/`guests_can_*`/`response`/`rsvp_comment`/`send_updates` all opt | `calendar.events().insert/patch/delete()` + `get()` for RSVP | Confirmation with event ID, title, time, URL | calendar.events | **Most complex Calendar tool**: RFC3339 normalization, DST-aware timezone, Google Meet + third-party conference (Zoom/Webex/Teams via add-on conferenceData), attendee normalization, RRULE recurrence rules, read-modify-write for updates |
| 4 | `manage_out_of_office` | Create/list/update/delete OOO events | `user_google_email` (req), `action` "create"\|"list"\|"update"\|"delete" (req), `start_time`/`end_time`/`summary`/`auto_decline_mode`/`decline_message`/`recurrence`/`timezone`/`time_min`/`time_max`/`max_results`/`event_id`/`calendar_id` opt | `calendar.events().insert/list/patch/delete()` with `eventType=outOfOffice` | Confirmation or formatted OOO event list | calendar.events | Date-only→dateTime auto-conversion; IANA DST; auto_decline_mode options |
| 5 | `manage_focus_time` | Create/list/update/delete Focus Time events | `user_google_email` (req), `action` "create"\|"list"\|"update"\|"delete" (req), same as OOO + `chat_status` "doNotDisturb"\|"available" opt, `description` opt | `calendar.events().insert/list/patch/delete()` with `eventType=focusTime` | Confirmation or formatted Focus Time event list | calendar.events | `chat_status` DND/available; same date/timezone complexity as OOO |
| 6 | `query_freebusy` | Query free/busy info for calendars | `user_google_email` (req), `time_min` RFC3339 (req), `time_max` RFC3339 (req), `calendar_ids` List[str] opt, `group_expansion_max` int opt, `calendar_expansion_max` int opt | `calendar.freebusy().query()` | Formatted busy periods per calendar | calendar.readonly | Multi-calendar query; RFC3339 normalization |
| 7 | `create_calendar` | Create a new secondary calendar | `user_google_email` (req), `summary` (req), `description` opt, `timezone` opt | `calendar.calendars().insert()` | Calendar ID, name, URL | calendar (full) | — |

---

## 3. Google Drive (`gdrive/drive_tools.py`) — 16 tools

### Module-level Helpers

- `_extract_office_xml_text(content_bytes, mime_type)` — extracts text from DOCX/XLSX/PPTX Office XML
- `_extract_pdf_text(content_bytes)` — PDF text extraction (pdfminer/fallback)
- `_encode_image_content(content_bytes, mime_type)` — base64-encodes image for LLM display
- `ssrf_safe_stream(url, ...)` imported from `core.http_utils` — SSRF-safe streaming URL download
- `MediaIoBaseUpload` (googleapiclient.http) — resumable upload with chunking

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `search_drive_files` | Search Drive files with structured or full-text query | `user_google_email` (req), `query` str (req), `page_size` int=10, `page_token` opt, `search_type` "structured"\|"fullText"="structured", `include_shared_drives` bool=False, `drive_id` opt | `drive.files().list()` | Formatted file list with ID, name, mimeType, modifiedTime, webViewLink, next_page_token | drive.readonly | Structured vs fullText query building; shared drive support; pagination |
| 2 | `get_drive_file_content` | Read file content inline for LLM | `user_google_email` (req), `file_id` (req), `max_length` int opt | `drive.files().export_media()` (Google native) or `files().get_media()` (binary) | Text content (native docs → plain text; DOCX/XLSX/PPTX → Office XML extraction; PDF → text; images → base64) | drive.readonly | **Multi-format content extraction**: Google Docs/Sheets/Slides export, Office XML text extraction, PDF text extraction, image base64; content truncation |
| 3 | `get_drive_file_download_url` | Get a download URL or save file locally | `user_google_email` (req), `file_id` (req), `file_name` opt, `export_format` opt | `drive.files().get()` metadata + `files().export_media()` or `get_media()` | Local file path (stdio) or temp 1-hour URL (HTTP); or `webContentLink` for binary | drive.readonly | Transport-mode aware; exports Google native formats; attachment_storage |
| 4 | `list_drive_items` | List files/folders in a folder or shared drives | `user_google_email` (req), `folder_id` opt, `page_size` int=20, `page_token` opt, `include_shared_drives` bool=False | `drive.files().list()` (folder contents) or `drives().list()` (shared drives) | Formatted list with name, ID, mimeType, modifiedTime, size | drive.readonly | Shared drives listing vs folder contents |
| 5 | `create_drive_folder` | Create a folder | `user_google_email` (req), `folder_name` (req), `parent_folder_id` opt | `drive.files().create()` with `mimeType=application/vnd.google-apps.folder` | Folder ID, name, URL | drive.file | — |
| 6 | `create_drive_file` | Create a file with content | `user_google_email` (req), `file_name` (req), `content` str opt, `mime_type` opt, `parent_folder_id` opt, `file_url` opt, `base64_content` opt | `drive.files().create()` with MediaIoBaseUpload; if `file_url` → `ssrf_safe_stream()` download first | File ID, name, URL | drive.file | **File upload**: supports text/content, base64 content, or SSRF-safe URL streaming; MediaIoBaseUpload for resumable upload |
| 7 | `import_to_google_doc` | Import file to Google Doc (auto-convert) | `user_google_email` (req), `file_path_or_url` (req), `file_name` opt, `parent_folder_id` opt, `source_format` opt | `drive.files().create()` with `convert=True` for MD/DOCX/TXT/HTML/RTF/ODT; SSRF-safe stream for URLs | Doc ID, name, URL | drive.file | **Format import + conversion**: MD/DOCX/TXT/HTML/RTF/ODT → Google Doc via Drive auto-convert |
| 8 | `import_to_google_slides` | Import file to Google Slides | `user_google_email` (req), `file_path_or_url` (req), `file_name` opt, `parent_folder_id` opt | `drive.files().create()` with convert for PPTX/PPT/ODP | Slides ID, name, URL | drive.file | PPTX/PPT/ODP → Google Slides conversion |
| 9 | `import_to_google_sheets` | Import file to Google Sheets | `user_google_email` (req), `file_path_or_url` (req), `file_name` opt, `parent_folder_id` opt | `drive.files().create()` with convert for XLSX/XLS/ODS/CSV/TSV | Sheets ID, name, URL | drive.file | XLSX/XLS/ODS/CSV/TSV → Google Sheets conversion |
| 10 | `get_drive_file_permissions` | Get all permissions for a file | `user_google_email` (req), `file_id` (req) | `drive.files().get()` with `fields=permissions` | Formatted permissions list with role, type, emailAddress | drive.readonly | — |
| 11 | `check_drive_file_public_access` | Check if a file is publicly accessible | `user_google_email` (req), `file_name` (req) | `drive.files().list()` search by name + check `anyone`/`anyoneWithLink` permission | Public/private status with access level | drive.readonly | Searches by name (not ID); checks anyone-with-link permissions |
| 12 | `update_drive_file` | Update file metadata and/or content | `user_google_email` (req), `file_id` (req), `new_name` opt, `new_content` str opt, `new_mime_type` opt, `new_content_url` opt, `convert` bool=False, `add_parents` opt, `remove_parents` opt | `drive.files().update()` with optional MediaIoBaseUpload; SSRF-safe stream for URL content | Confirmation with file ID, name, URL | drive.file | Metadata + content update; SSRF-safe URL streaming; Drive auto-convert for re-import |
| 13 | `get_drive_shareable_link` | Get shareable links for a file | `user_google_email` (req), `file_id` (req) | `drive.files().get()` with permissions fields | View link, download link, webContentLink, permissions summary | drive.readonly | — |
| 14 | `manage_drive_access` | Grant/update/revoke file access permissions | `user_google_email` (req), `action` "grant"\|"grant_batch"\|"update"\|"revoke"\|"transfer_owner" (req), `file_id` (req), `email`/`emails` opt, `role` "reader"\|"writer"\|"commenter"\|"owner" opt, `permission_id` opt, `notify` bool=True, `message` opt, `transfer_ownership` bool=False | `drive.permissions().create/update/delete()` | Confirmation with permission IDs | drive (full) | **Batch grant** (multiple emails in one call); transfer ownership |
| 15 | `copy_drive_file` | Copy a file | `user_google_email` (req), `file_id` (req), `new_name` opt, `parent_folder_id` opt | `drive.files().copy()` | Copy file ID, name, URL | drive.file | — |
| 16 | `set_drive_file_permissions` | Set link-sharing and writer/copy permissions | `user_google_email` (req), `file_id` (req), `link_sharing` "off"\|"view"\|"edit"\|"comment" opt, `writers_can_share` bool opt, `copy_requires_writer_permission` bool opt | `drive.files().update()` (metadata) + `drive.permissions().create/update/delete()` (anyone permission) | Confirmation with new settings | drive (full) | Link sharing control via anyone-with-link permission |

---

## 4. Google Docs (`gdocs/docs_tools.py`) — 20 tools

### Module-level Imports

- `gdocs.docs_helpers` — `extract_doc_text()`, `_extract_tab_text()`, etc.
- `gdocs.docs_structure` — `_build_doc_structure()` for inspect_doc_structure
- `gdocs.docs_tables` — TableOperationManager
- `gdocs.docs_markdown` — `convert_doc_to_markdown()` (Docs → markdown conversion)
- `gdocs.docs_markdown_writer` — `markdown_to_docs_requests()` (Markdown → Docs batchUpdate requests)
- `gdocs.operation_schemas` — `BatchDocOperations` Pydantic schema (20+ operation types)
- `gdocs.managers` — `TableOperationManager`, `HeaderFooterManager`, `ValidationManager`, `BatchOperationManager`
- `core.comments.create_comment_tools` — registers `list_document_comments` + `manage_document_comment`
- Uses `@require_multiple_services([("drive", "drive_read"), ("docs", "docs_write")])` for most tools

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `search_docs` | Search for Google Docs | `user_google_email` (req), `query` str opt, `folder_id` opt, `page_size` int=10, `page_token` opt | `drive.files().list()` with `mimeType=application/vnd.google-apps.document` | Formatted list with file IDs, names, dates | drive.readonly | — |
| 2 | `get_doc_content` | Get document content (native or imported) | `user_google_email` (req), `document_id` (req), `export_format` opt | `docs.documents().get()` (native) with tabs traversal; `drive.files().export_media()` or `get_media()` for non-native | Extracted text content; Office XML/PDF extraction for non-native | drive.readonly + docs.readonly | **Dual-path**: native docs traverse all tabs with `_extract_tab_text()`; non-native → Office XML, PDF, or raw text extraction |
| 3 | `list_docs_in_folder` | List Docs in a folder | `user_google_email` (req), `folder_id` (req), `page_size` int=20, `page_token` opt | `drive.files().list()` with folder parent + docs mimeType filter | Formatted file list | drive.readonly | — |
| 4 | `create_doc` | Create a new document | `user_google_email` (req), `title` str="Untitled", `content` str opt | `docs.documents().create()` + optional `docs.documents().batchUpdate()` for initial text insertion | Doc ID, title, URL | docs (write) | — |
| 5 | `modify_doc_text` | Insert/replace/delete text or apply formatting | `user_google_email` (req), `document_id` (req), `action` "insert"\|"replace"\|"delete"\|"format_text" (req), `text`/`index`/`start_index`/`end_index`/`search_text`/`replace_text`/`format_options`/`segment_id`/`tab_id`/`end_of_segment` opt | `docs.documents().batchUpdate()` with insertText/deleteContentRange/replaceAllText/updateTextStyle requests | Confirmation | docs (write) | Segment ID + tab_id support for headers/footers/tabs; `end_of_segment` flag |
| 6 | `find_and_replace_doc` | Find and replace text | `user_google_email` (req), `document_id` (req), `search_text` (req), `replace_text` (req), `match_case` bool=False | `docs.documents().batchUpdate()` with `replaceAllText` | Number of replacements made | docs (write) | — |
| 7 | `insert_doc_elements` | Insert table, list, or page break | `user_google_email` (req), `document_id` (req), `element_type` "table"\|"list"\|"page_break" (req), `index` int opt, `rows`/`cols` int opt, `items` List[str] opt, `list_type` opt, `tab_id` opt | `docs.documents().batchUpdate()` with insertTable/insertPageBreak/createParagraphBullets | Confirmation | docs (write) | — |
| 8 | `insert_doc_image` | Insert an image into a document | `user_google_email` (req), `document_id` (req), `image_source` "drive"\|"url" (req), `image_url`/`drive_file_id` opt, `index` int opt, `width`/`height` EMU opt | `docs.documents().batchUpdate()` with `insertInlineImage`; Drive URL for Drive files, direct URL for web | Confirmation with image object ID | docs (write) + drive.readonly | Drive file URL construction for Drive images |
| 9 | `update_doc_headers_footers` | Add/update document headers and footers | `user_google_email` (req), `document_id` (req), `header_text`/`footer_text` opt, `default_header_id`/`default_footer_id` opt | `docs.documents().batchUpdate()` via HeaderFooterManager; auto-creates section if missing | Confirmation with header/footer IDs | docs (write) | HeaderFooterManager handles auto-creation of missing sections |
| 10 | `batch_update_doc` | Apply 20+ operation types via BatchDocOperations schema | `user_google_email` (req), `document_id` (req), `operations` List[BatchDocOperations] (req) | `docs.documents().batchUpdate()` via BatchOperationManager | Confirmation | docs (write) | **Most complex Docs tool**: 20+ op types — insert_text, delete_text, replace_text, format_text, update_paragraph_style, update_table_cell_style, insert_table, insert/delete_table_row/col, merge/unmerge cells, insert_page/section_break, find_replace, create_bullet_list, create/replace/delete_named_range, update_document_style, update_section_style, create_header_footer, insert_image, insert/delete/update_doc_tab |
| 11 | `inspect_doc_structure` | Get detailed structure of a document | `user_google_email` (req), `document_id` (req), `include_content` bool=True, `tab_id` opt | `docs.documents().get()` | JSON structure: elements, tables, headers, footers, tabs, named ranges, index positions | docs.readonly | Required prerequisite for `create_table_with_data`; returns position indices needed for subsequent batchUpdates |
| 12 | `debug_docs_runtime_info` | Return runtime canary/diagnostics | `user_google_email` (req) | none (local) | Runtime info string | — | Diagnostics only |
| 13 | `create_table_with_data` | Create a table and fill with data | `user_google_email` (req), `document_id` (req), `rows` int (req), `cols` int (req), `data` List[List[str]] opt, `index` int opt, `tab_id` opt | `docs.documents().batchUpdate()` via TableOperationManager | Confirmation; **must call `inspect_doc_structure` first** | docs (write) | Requires prior structure inspection for valid insertion index; TableOperationManager builds insertTable + insertText cell-fill requests |
| 14 | `debug_table_structure` | Inspect per-cell table structure | `user_google_email` (req), `document_id` (req) | `docs.documents().get()` | Per-cell debug info with positions | docs.readonly | Debugging tool for table cell indices |
| 15 | `export_doc_to_pdf` | Export doc as PDF and save to Drive | `user_google_email` (req), `document_id` (req), `output_folder_id` opt, `output_file_name` opt | `drive.files().export_media()` (PDF export) + `drive.files().create()` (upload) | PDF file ID, name, URL | drive.file + docs.readonly | **PDF export + re-upload**: export_media streams PDF; MediaIoBaseUpload uploads it back to Drive |
| 16 | `update_paragraph_style` | Apply paragraph/heading style with optional bullets | `user_google_email` (req), `document_id` (req), `start_index`/`end_index` int (req), `named_style_type` str opt, `alignment` opt, `space_above`/`space_below` pt opt, `bullet_preset` opt, `tab_id` opt | `docs.documents().batchUpdate()` with updateParagraphStyle + optional createParagraphBullets | Confirmation | docs (write) | Named style types (HEADING_1–6, NORMAL_TEXT, etc.) |
| 17 | `get_doc_as_markdown` | Convert document to Markdown | `user_google_email` (req), `document_id` (req), `include_comments` "inline"\|"appendix"\|"none"="none" | `docs.documents().get()` + `drive.comments().list()`; `convert_doc_to_markdown()` from gdocs.docs_markdown; 30s timeout | Markdown string | docs.readonly + drive.readonly | **Docs→Markdown conversion**: traverses elements, tables, lists; inline/appendix comment modes; 30s timeout |
| 18 | `manage_doc_tab` | Create/rename/delete/populate tabs | `user_google_email` (req), `document_id` (req), `action` "create"\|"rename"\|"delete"\|"populate_from_markdown" (req), `tab_id` opt, `tab_title` opt, `markdown_content` opt, `replace_existing` bool=False | `docs.documents().batchUpdate()` with insertDocumentTab/deleteDocumentTab/updateDocumentTab; `markdown_to_docs_requests()` for markdown → batchUpdate requests | Confirmation with tab ID | docs (write) | **Markdown→Docs conversion**: `markdown_to_docs_requests()` parses MD and generates position-based batchUpdate requests for headings, lists, paragraphs |
| 19 | `list_document_comments` | List comments on a document | `user_google_email` (req), `document_id` (req), `max_comments` int opt | `drive.comments().list()` (Drive API, paginated) | Formatted comments with author, content, replies, resolved status | drive.readonly | Via `create_comment_tools` factory; paginates up to max_comments |
| 20 | `manage_document_comment` | Create/reply/resolve a document comment | `user_google_email` (req), `document_id` (req), `action` "create"\|"reply"\|"resolve" (req), `comment_content` opt, `comment_id` opt | `drive.comments().create()` or `drive.replies().create()` | Confirmation with comment/reply ID | drive (full) | Via `create_comment_tools` factory; Drive API cannot anchor to specific text (doc-level only) |

---

## 5. Google Sheets (`gsheets/sheets_tools.py`) — 14 tools

### Module-level Imports

- `gsheets.sheets_helpers` — `CONDITION_TYPES`, `parse_color()`, `format_condition_rule()`, `parse_format_options()`, etc.
- `core.comments.create_comment_tools` — registers `list_spreadsheet_comments` + `manage_spreadsheet_comment`

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `list_spreadsheets` | List accessible spreadsheets | `user_google_email` (req), `folder_id` opt, `page_size` int=20, `page_token` opt | `drive.files().list()` with `mimeType=application/vnd.google-apps.spreadsheet` | Formatted file list with IDs, names, dates | drive.readonly | — |
| 2 | `get_spreadsheet_info` | Get spreadsheet metadata | `user_google_email` (req), `spreadsheet_id` (req) | `sheets.spreadsheets().get()` | Formatted: sheet names, dimensions, conditional format counts, URL | sheets.readonly | — |
| 3 | `read_sheet_values` | Read cell values from a range | `user_google_email` (req), `spreadsheet_id` (req), `range` str (req), `include_hyperlinks` bool=False, `include_notes` bool=False, `include_formulas` bool=False | `sheets.spreadsheets().values().get()` + optional extra calls for hyperlinks/notes/formulas + `spreadsheets().get()` for detailed error info | Formatted cell data; Sheets error token detection (`#VALUE!` etc.) with detailed errors | sheets.readonly | Each optional include costs extra API call; error token detection and expansion |
| 4 | `modify_sheet_values` | Write or clear cell values | `user_google_email` (req), `spreadsheet_id` (req), `range` str (req), `values` List[List] opt, `action` "update"\|"clear"="update", `value_input_option` opt | `sheets.spreadsheets().values().update()` or `values().clear()` | Confirmation with cells updated | sheets (write) | Error detection in response |
| 5 | `format_sheet_range` | Apply cell formatting to a range | `user_google_email` (req), `spreadsheet_id` (req), `range` str (req), `bold`/`italic` bool opt, `font_size` int opt, `font_color`/`background_color` RGB opt, `number_format` str opt, `wrap_strategy` opt, `horizontal_alignment`/`vertical_alignment` opt | `sheets.spreadsheets().batchUpdate()` with `repeatCell` | Confirmation | sheets (write) | Color parsing, number format strings, wrap/alignment options |
| 6 | `manage_conditional_formatting` | Add/update/delete conditional format rules | `user_google_email` (req), `spreadsheet_id` (req), `action` "add"\|"update"\|"delete" (req), `range` str opt, `rule_type` "boolean"\|"gradient" opt, `condition_type` opt, `condition_values` List opt, `format` dict opt, `rule_index` int opt | `sheets.spreadsheets().batchUpdate()` with addConditionalFormatRule/updateConditionalFormatRule/deleteConditionalFormatRule | Confirmation | sheets (write) | `CONDITION_TYPES` validation; boolean vs gradient rules |
| 7 | `create_spreadsheet` | Create a new spreadsheet | `user_google_email` (req), `title` str="Untitled", `sheet_names` List[str] opt | `sheets.spreadsheets().create()` | Spreadsheet ID, sheet IDs, URL | sheets (write) | Optional initial sheet names |
| 8 | `create_sheet` | Add a new sheet or duplicate an existing sheet | `user_google_email` (req), `spreadsheet_id` (req), `title` str (req), `source_sheet_name` opt | `sheets.spreadsheets().batchUpdate()` with `addSheet` or `duplicateSheet` | New sheet ID and title | sheets (write) | Duplicate path resolves sheet ID from name |
| 9 | `list_sheet_tables` | List structured tables in a spreadsheet | `user_google_email` (req), `spreadsheet_id` (req) | `sheets.spreadsheets().get()` with `fields=sheets.data.rowData,sheets.properties,tables` | Formatted table list with tableId, name, range | sheets.readonly | Tables field (newer Sheets API feature) |
| 10 | `append_table_rows` | Append rows to a structured table | `user_google_email` (req), `spreadsheet_id` (req), `table_id` str (req), `rows` List[List] (req) | `sheets.spreadsheets().batchUpdate()` with `appendCells` + tableId; resolves sheet_id from tableId first | Confirmation | sheets (write) | Requires tableId resolution from spreadsheet metadata |
| 11 | `resize_sheet_dimensions` | Resize columns/rows; freeze, hide/unhide, insert/delete | `user_google_email` (req), `spreadsheet_id` (req), `sheet_id` int opt, `column_sizes` List[dict] opt, `row_sizes` List[dict] opt, `auto_resize` bool opt, `freeze_rows`/`freeze_cols` int opt, `hide_rows`/`hide_cols` bool opt, `row_start`/`row_end`/`col_start`/`col_end` int opt, `insert_rows`/`delete_rows` int opt, `insert_cols`/`delete_cols` int opt | `sheets.spreadsheets().batchUpdate()` with updateDimensionProperties/autoResizeDimensions/appendDimension/insertDimension/deleteDimension/updateSheetProperties | Confirmation | sheets (write) | **Multi-operation**: column/row sizing, auto-resize, freeze panes, hide/unhide, insert/delete rows/columns in single call |
| 12 | `move_sheet_rows` | Move rows to a new position | `user_google_email` (req), `spreadsheet_id` (req), `sheet_id` int (req), `source_start`/`source_end` int (req), `dest_index` int (req) | `sheets.spreadsheets().batchUpdate()` with `copyPaste` + `deleteDimension`; validates source data; handles grid expansion | Confirmation | sheets (write) | Validates source rows exist; handles grid expansion if dest beyond bounds |
| 13 | `list_spreadsheet_comments` | List comments on a spreadsheet | `user_google_email` (req), `spreadsheet_id` (req), `max_comments` int opt | `drive.comments().list()` (Drive API) | Formatted comments | drive.readonly | Via `create_comment_tools` factory |
| 14 | `manage_spreadsheet_comment` | Create/reply/resolve a comment | `user_google_email` (req), `spreadsheet_id` (req), `action` "create"\|"reply"\|"resolve" (req), `comment_content` opt, `comment_id` opt | `drive.comments().create()` or `drive.replies().create()` | Confirmation | drive (full) | Via `create_comment_tools` factory |

---

## 6. Google Slides (`gslides/slides_tools.py`) — 7 tools

### Module-level Helpers

- `_extract_shape_text(shape)` — extracts sorted text runs from a Slides shape
- `_iter_text_bearing_elements(elements)` — recursively yields text from shapes and elementGroup children
- `_describe_elements(elements, indent)` — builds descriptive lines for all page elements (recurses into elementGroups)
- `gslides.slides_helpers.validate_batch_update_requests(requests)` — validates request structure
- `gslides.slides_helpers.validate_insert_text_targets(service, pres_id, requests)` — validates insertText objectIds are text-capable (not slide IDs)
- `core.comments.create_comment_tools` — registers `list_presentation_comments` + `manage_presentation_comment`

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `create_presentation` | Create a new presentation | `user_google_email` (req), `title` str="Untitled Presentation" | `slides.presentations().create()` | Presentation ID, URL, slide count | presentations (write) | — |
| 2 | `get_presentation` | Get presentation details and slide text | `user_google_email` (req), `presentation_id` (req) | `slides.presentations().get()` | Formatted: title, slide count, per-slide element list with text content | presentations.readonly | Recursive text extraction from shapes + elementGroups; grouped shape text visible |
| 3 | `batch_update_presentation` | Apply raw batch updates to a presentation | `user_google_email` (req), `presentation_id` (req), `requests` List[dict] (req) | `slides.presentations().batchUpdate()` with pre-validation | Confirmation with request count, replies (new slide/shape IDs) | presentations (write) | **Validation layer**: `validate_batch_update_requests()` checks structure; `validate_insert_text_targets()` ensures insertText objectIds are text-capable shapes (not slide IDs) — common LLM mistake |
| 4 | `get_page` | Get details of a specific slide | `user_google_email` (req), `presentation_id` (req), `page_object_id` (req) | `slides.presentations().pages().get()` | Page type, element count, per-element descriptions (type, ID, text content) | presentations.readonly | Recursive element description including grouped shapes; returns element IDs needed for batch_update |
| 5 | `get_page_thumbnail` | Generate a PNG thumbnail URL for a slide | `user_google_email` (req), `presentation_id` (req), `page_object_id` (req), `thumbnail_size` "LARGE"\|"MEDIUM"\|"SMALL"="MEDIUM" | `slides.presentations().pages().getThumbnail()` | PNG `contentUrl` (temporary Google-hosted URL) | presentations.readonly | Thumbnail URL is temporary |
| 6 | `list_presentation_comments` | List comments on a presentation | `user_google_email` (req), `presentation_id` (req), `max_comments` int opt | `drive.comments().list()` | Formatted comments | drive.readonly | Via `create_comment_tools` factory |
| 7 | `manage_presentation_comment` | Create/reply/resolve a comment | `user_google_email` (req), `presentation_id` (req), `action` "create"\|"reply"\|"resolve" (req), `comment_content` opt, `comment_id` opt | `drive.comments().create()` or `drive.replies().create()` | Confirmation | drive (full) | Via `create_comment_tools` factory |

---

## 7. Google Forms (`gforms/forms_tools.py`) — 6 tools

### Module-level Helpers

- `_extract_option_values(question)` — extracts choices from choice/grid questions
- `_get_question_type(question_item)` — maps Form question type enum to string
- `_serialize_form_item(item)` — handles questionItem, questionGroupItem, pageBreakItem, textItem, imageItem, videoItem

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `create_form` | Create a new Form | `user_google_email` (req), `title` str (req), `description` str opt | `forms.forms().create()` | formId, edit URL, responder URL | forms.body | — |
| 2 | `get_form` | Get form structure and all items | `user_google_email` (req), `form_id` (req) | `forms.forms().get()` | Structured JSON: form info + all items with type detection (question type, options, grid, etc.) | forms.body.readonly | Multi-type item serialization |
| 3 | `set_publish_settings` | Publish/unpublish a form or toggle accepting responses | `user_google_email` (req), `form_id` (req), `is_published` bool opt, `is_accepting_responses` bool opt | `forms.forms().setPublishSettings()` | Confirmation | forms.body | — |
| 4 | `get_form_response` | Get a single form response | `user_google_email` (req), `form_id` (req), `response_id` (req) | `forms.forms().responses().get()` | Formatted answers by questionId | forms.responses.readonly | — |
| 5 | `list_form_responses` | List all form responses | `user_google_email` (req), `form_id` (req), `page_size` int=10, `page_token` opt | `forms.forms().responses().list()` | Formatted response list with pagination | forms.responses.readonly | Pagination |
| 6 | `batch_update_form` | Create/update/delete/move items or update form info | `user_google_email` (req), `form_id` (req), `requests` List[dict] (req) | `forms.forms().batchUpdate()` with createItem/updateItem/deleteItem/moveItem/updateFormInfo/updateSettings | Confirmation | forms.body | Multiple request types per call |

---

## 8. Google Tasks (`gtasks/tasks_tools.py`) — 6 tools

### Module-level Helpers

- `StructuredTask` — dataclass wrapping a task with parent reference and children list
- `get_structured_tasks(tasks)` — builds hierarchical task tree; handles orphaned subtasks with placeholder parents
- `sort_structured_tasks(structured_tasks)` — sorts by position
- `serialize_tasks(structured_tasks)` — formats hierarchical task tree as text
- `_adjust_due_max_for_tasks_api(due_max)` — bumps dueMax by one day (API uses exclusive bound)
- `_validate_rfc3339_date(param_name, value)` — requires full RFC3339 datetime, not just date string

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `list_task_lists` | List all task lists | `user_google_email` (req) | `tasks.tasklists().list()` | Formatted list with IDs and titles | tasks.readonly | — |
| 2 | `get_task_list` | Get a specific task list | `user_google_email` (req), `task_list_id` (req) | `tasks.tasklists().get()` | Task list details | tasks.readonly | — |
| 3 | `manage_task_list` | Create/update/delete/clear_completed a task list | `user_google_email` (req), `action` "create"\|"update"\|"delete"\|"clear_completed" (req), `task_list_id` opt, `title` opt | `tasks.tasklists().insert/update/delete()` + `tasks().clear()` | Confirmation | tasks (write) | `clear_completed` removes all completed tasks from list |
| 4 | `list_tasks` | List tasks in a list with hierarchy | `user_google_email` (req), `task_list_id` (req), `max_results` int=100, `show_completed` bool=False, `show_hidden` bool=False, `completed_max`/`completed_min` RFC3339 opt, `due_max`/`due_min` RFC3339 opt, `updated_min` RFC3339 opt | `tasks.tasks().list()` with auto-pagination up to max_results (max 10,000) | Hierarchical formatted task tree (StructuredTask) | tasks.readonly | **Auto-pagination** up to 10,000 tasks; `_adjust_due_max_for_tasks_api()` bumps dueMax by one day; full hierarchy reconstruction with orphan handling |
| 5 | `get_task` | Get a single task | `user_google_email` (req), `task_list_id` (req), `task_id` (req) | `tasks.tasks().get()` | Full task details: title, notes, due, status, links | tasks.readonly | — |
| 6 | `manage_task` | Create/update/delete/move a task | `user_google_email` (req), `action` "create"\|"update"\|"delete"\|"move" (req), `task_list_id` (req), `task_id` opt, `title`/`notes`/`due`/`status`/`parent` opt, `destination_list_id`/`previous_task_id` opt | `tasks.tasks().insert/update/delete/move()` | Confirmation with task ID | tasks (write) | `move` changes parent, previous sibling, or destination list; validates RFC3339 datetime for due |

---

## 9. Google Chat (`gchat/chat_tools.py`) — 6 tools

### Module-level Helpers

- `_resolve_sender(chat_svc, people_svc, message)` — resolves sender displayName via People API with bounded in-memory LRU-style cache (avoids repeated lookups)
- `_execute_chat_request(svc, req, semaphore)` — executes Chat API request with SSL retry logic and optional semaphore for concurrency control
- `_extract_rich_links(message)` — extracts RICH_LINK annotations (Drive files, etc.) from message
- `core.utils.TransientNetworkError` — raised when all spaces fail with SSL errors in `search_messages`
- `httpx` — used for attachment download (bypasses MediaIoBaseDownload)

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `list_spaces` | List Chat spaces | `user_google_email` (req), `space_type` "all"\|"room"\|"dm"="all" opt, `page_size` int=20 | `chat.spaces().list()` with spaceType filter | Formatted space list with name, displayName, type | chat.spaces.readonly | — |
| 2 | `get_messages` | Get messages from a space | `user_google_email` (req), `space_name` (req), `page_size` int=25, `page_token` opt, `filter` str opt | `chat.spaces().messages().list()` + People API for sender name resolution | Formatted messages with sender, timestamp, text, attachments, reactions, thread info | chat.messages.readonly | People API sender resolution (cached); shows attachments, reactions, rich links |
| 3 | `send_message` | Send a message to a space | `user_google_email` (req), `space_name` (req), `text` (req), `thread_name` opt, `thread_key` opt | `chat.spaces().messages().create()` | Confirmation with message name | chat.messages | Thread reply via thread_name (existing) or thread_key (new/continuation) |
| 4 | `search_messages` | Search messages across all spaces | `user_google_email` (req), `query` str (req), `space_types` "all"\|"room"\|"dm"="all" opt, `max_spaces` int=10 | `chat.spaces().list()` + `spaces().messages().list()` per space; **client-side text filtering** | Formatted matching messages across spaces | chat.messages.readonly | **Client-side filtering**: fetches messages from each space and filters locally; semaphore-limited concurrency; SSL retry; raises `TransientNetworkError` if all spaces fail |
| 5 | `create_reaction` | Add emoji reaction to a message | `user_google_email` (req), `message_name` str (req), `emoji` str (req) | `chat.spaces().messages().reactions().create()` | Confirmation | chat.messages | Unicode emoji string |
| 6 | `download_chat_attachment` | Download a Chat message attachment | `user_google_email` (req), `space_name` (req), `message_id` (req), `attachment_resource_name` (req) | `chat.spaces().messages().get()` for metadata; **httpx** GET `https://chat.googleapis.com/v1/media/{resource}?alt=media` with Bearer token | Local file path (stdio) or temp URL (HTTP) | chat.messages.readonly | **httpx download** (not MediaIoBaseDownload); uses Bearer token from credentials; `attachment_storage` for transport-mode-aware save |

---

## 10. Google Contacts (`gcontacts/contacts_tools.py`) — 8 tools

### Module-level Helpers (Pydantic Models)

- `PhoneInput` — `value` (req), `type` opt
- `EmailInput` — `value` (req), `type` opt
- `OrganizationInput` — `name`/`title`/`department` opt
- `NicknameInput`, `UrlInput`, `UserDefinedInput`, `RelationInput`
- `ContactInput` — full contact creation schema with all field types
- `ContactUpdateInput` — partial update schema
- `_build_person_body(data)` — converts Pydantic input to People API Person resource body; handles deprecated single-value aliases with deprecation warnings
- `_warmup_search_cache(service, user)` — performs empty query to prime People API search cache (tracked per-user in `_search_cache_warmed_up`)
- Merge helpers from `gcontacts.contacts_helpers`: `_merge_phones`, `_merge_emails`, `_merge_organizations`, `_merge_nicknames`, `_merge_urls`, `_merge_user_defined`, `_merge_relations`

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `list_contacts` | List all contacts | `user_google_email` (req), `page_size` int=100, `page_token` opt, `sort_order` opt | `people.people().connections().list()` with DETAILED_PERSON_FIELDS | Formatted contact list with name, email, phone, organization | contacts.readonly | DETAILED_PERSON_FIELDS constant lists all requested person fields |
| 2 | `get_contact` | Get a single contact by resource name | `user_google_email` (req), `resource_name` str (req) | `people.people().get()` with DETAILED_PERSON_FIELDS | Full contact details: names, nicknames, emails, phones, orgs, bios, addresses, birthdays, URLs, userDefined, relations, photos, metadata, memberships | contacts.readonly | — |
| 3 | `search_contacts` | Search contacts by name/email/phone | `user_google_email` (req), `query` str (req), `page_size` int=10 (max 30) | `people.people().searchContacts()` preceded by `_warmup_search_cache()` | Formatted contact list with match highlights | contacts.readonly | **Cache warmup** required before first search (empty query); max 30 results |
| 4 | `manage_contact` | Create, update, or delete a contact | `user_google_email` (req), `action` "create"\|"update"\|"delete" (req), `resource_name` opt, `contact_data` ContactInput\|ContactUpdateInput opt, `merge_mode` "merge"\|"replace"\|"remove"="merge" opt, `field` opt | `people.people().createContact()` or `updateContact()` (read-modify-write + etag retry) or `deleteContact()` | Confirmation with resource name | contacts (write) | **Etag retry loop** (up to 3 on 412 Precondition Failed); **merge modes** (merge/replace/remove) per field; read-modify-write pattern |
| 5 | `list_contact_groups` | List contact groups/labels | `user_google_email` (req), `page_size` int=20 | `people.contactGroups().list()` | Formatted groups with name, resourceName, memberCount | contacts.readonly | — |
| 6 | `get_contact_group` | Get a contact group with its members | `user_google_email` (req), `resource_name` str (req), `max_members` int=100 | `people.contactGroups().get()` with maxMembers | Group details + member resource names | contacts.readonly | — |
| 7 | `manage_contacts_batch` | Batch create/update/delete contacts | `user_google_email` (req), `action` "create"\|"update"\|"delete" (req), `contacts` List[ContactInput] opt, `resource_names` List[str] opt, `field` str opt (update only) | `people.people().batchCreateContacts/batchUpdateContacts/batchDeleteContacts()` | Confirmation with created/updated resource names | contacts (write) | **Batch limits**: up to 200 create/update, 500 delete; update requires single `field` param (single updateMask field per batch to avoid conflicts) |
| 8 | `manage_contact_group` | Create/update/delete group or modify members | `user_google_email` (req), `action` "create"\|"update"\|"delete"\|"modify_members" (req), `resource_name` opt, `name` str opt, `add_resource_names`/`remove_resource_names` List[str] opt | `people.contactGroups().create/update/delete()` + `contactGroups().members().modify()` | Confirmation | contacts (write) | — |

---

## 11. Google Search (`gsearch/search_tools.py`) — 2 tools

### Module-level Notes

- Requires `GOOGLE_PSE_API_KEY` and `GOOGLE_PSE_ENGINE_ID` environment variables (not OAuth-scoped in the usual sense; uses API key)
- `@require_google_service("customsearch", "customsearch")` — injects `customsearch` v1 client; scope = `https://www.googleapis.com/auth/cse`

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `search_custom` | Search via Google Programmable Search Engine | `user_google_email` (req), `q` str (req), `num` int=10, `start` int=1, `safe` "active"\|"moderate"\|"off"="off", `search_type` "image" opt, `site_search` str opt, `site_search_filter` "e"\|"i" opt, `date_restrict` str opt, `file_type` str opt, `language` str opt, `country` str opt, `sites` List[str] opt | `customsearch.cse().list()` | Formatted results: title, URL, snippet, og:type, publish date; pagination hint | cse | `sites` param → auto-builds `site:x OR site:y` query expansion; pagination via `start` |
| 2 | `get_search_engine_info` | Get PSE metadata and indexed result count | `user_google_email` (req) | `customsearch.cse().list()` with test query "test" num=1 | Engine title, refinements (facets with label/anchor), total indexed results | cse | Runs a minimal query to extract context metadata |

---

## 12. Google Apps Script (`gappsscript/apps_script_tools.py`) — 15 tools

### Module-level Notes

- `list_script_projects` and `delete_script_project` use the **Drive API** (not Apps Script API) because the Script API has no `projects.list()` or project delete methods
- `generate_trigger_code` makes **no API call** — it generates Apps Script JS code as a string
- Services: `drive` (v3) for list/delete; `script` (v1) for all others

### Tools

| # | Tool Name | Description | Key Parameters | API Method | Return Shape | Scopes | Complexity Notes |
|---|-----------|-------------|----------------|------------|-------------|--------|-----------------|
| 1 | `list_script_projects` | List Apps Script projects | `user_google_email` (req), `page_size` int=50, `page_token` opt | `drive.files().list()` with `mimeType=application/vnd.google-apps.script` | Formatted list: name, ID, created/modified times | drive.readonly | Uses Drive API (Script API has no list method) |
| 2 | `get_script_project` | Get project metadata + all source files | `user_google_email` (req), `script_id` (req) | `script.projects().get()` + `projects().getContent()` concurrently | Project metadata + all files with source (first 200 chars shown) | script.projects.readonly | Concurrent `asyncio.gather()` for metadata + content |
| 3 | `get_script_content` | Get source of one file within a project | `user_google_email` (req), `script_id` (req), `file_name` (req) | `script.projects().getContent()` + filter by file name | Full file source + type | script.projects.readonly | Uses getContent() not get() (get() only returns metadata) |
| 4 | `create_script_project` | Create a new Apps Script project | `user_google_email` (req), `title` str (req), `parent_id` opt | `script.projects().create()` | Script ID, edit URL | script.projects | Optional parent_id for bound scripts |
| 5 | `update_script_content` | Update or create files in a project | `user_google_email` (req), `script_id` (req), `files` List[dict] (req) | `script.projects().updateContent()` | Confirmation with updated file list | script.projects | `files` = list of `{name, type, source}` objects; **destructive** (overwrites all project files) |
| 6 | `run_script_function` | Execute a function in a deployed script | `user_google_email` (req), `script_id` (req), `function_name` (req), `parameters` List opt, `dev_mode` bool=False | `script.scripts().run()` | Execution result or error message | script.external_request | `dev_mode` runs latest vs deployed version; requires script to be deployed as API executable |
| 7 | `manage_deployment` | Create/update/delete a deployment | `user_google_email` (req), `action` "create"\|"update"\|"delete" (req), `script_id` (req), `deployment_id` opt, `description` opt, `version_description` opt | create: `projects().versions().create()` + `projects().deployments().create()`; update: `deployments().update()`; delete: `deployments().delete()` | Deployment ID, version number, description | script.deployments | **Create auto-creates version first** then deploys; two-step operation |
| 8 | `list_deployments` | List all deployments for a project | `user_google_email` (req), `script_id` (req) | `script.projects().deployments().list()` | Formatted list: deployment ID, description, updated time | script.deployments.readonly | — |
| 9 | `list_script_processes` | List recent execution processes | `user_google_email` (req), `page_size` int=50, `script_id` opt | `script.processes().list()` | Formatted list: function, status, start time, duration | script.projects.readonly | Optional filter by script_id |
| 10 | `delete_script_project` | Permanently delete a script project | `user_google_email` (req), `script_id` (req) | `drive.files().delete()` (Drive API — scripts are Drive files) | Confirmation | drive (full) | Uses Drive API; **permanent, irreversible** |
| 11 | `list_versions` | List all versions of a project | `user_google_email` (req), `script_id` (req) | `script.projects().versions().list()` | Formatted list: version number, description, created time | script.projects.readonly | — |
| 12 | `create_version` | Create an immutable version snapshot | `user_google_email` (req), `script_id` (req), `description` str opt | `script.projects().versions().create()` | Version number, created time | script.projects (full) | Immutable once created |
| 13 | `get_version` | Get details of a specific version | `user_google_email` (req), `script_id` (req), `version_number` int (req) | `script.projects().versions().get()` | Version number, description, created time | script.projects.readonly | — |
| 14 | `get_script_metrics` | Get execution metrics (users, runs, failures) | `user_google_email` (req), `script_id` (req), `metrics_granularity` "DAILY"\|"WEEKLY"="DAILY" | `script.projects().getMetrics()` | Formatted time-series: active users, total executions, failed executions | script.projects.readonly | — |
| 15 | `generate_trigger_code` | Generate Apps Script trigger setup code | `trigger_type` (req), `function_name` (req), `schedule` str="" | **No API call** — local code generation | Apps Script JS code string + setup instructions | none | Trigger types: time_minutes/hours/daily/weekly, on_open, on_edit, on_form_submit, on_change; generates installable or simple trigger code |

---

## Hardest Tools to Port (TypeScript)

Ranked by porting complexity:

| Rank | Tool | Module | Why Hard |
|------|------|--------|----------|
| 1 | `send_gmail_message` | gmail | Full MIME multipart construction (`EmailMessage` + `multipart/related` for inline images with CID headers); forward mode with attachment carry-over; Send-As alias + signature fetch. No direct TS equivalent of Python's `email.message.EmailMessage`. Requires careful base64url encoding. |
| 2 | `draft_gmail_message` | gmail | Same MIME complexity as `send_gmail_message` minus forward logic |
| 3 | `get_gmail_messages_content_batch` / `get_gmail_threads_content_batch` | gmail | Gmail Batch HTTP API (`new_batch_http_request`) has no official TypeScript client support — must implement multipart/mixed HTTP batching manually or fall back to sequential with exponential backoff |
| 4 | `batch_update_doc` | gdocs | 20+ operation types via `BatchDocOperations` Pydantic schema; `BatchOperationManager` maps schema → Docs API requests; position-index system; segment_id for headers/footers; tab_id for multi-tab docs |
| 5 | `manage_doc_tab` (populate_from_markdown) | gdocs | `markdown_to_docs_requests()` converts Markdown to Docs batchUpdate requests; must handle headings, lists, paragraphs as positional insertions |
| 6 | `get_doc_as_markdown` | gdocs | `convert_doc_to_markdown()` traverses Docs API JSON (elements, tables, lists, inline images) → Markdown; inline/appendix comment modes; 30s timeout |
| 7 | `get_drive_file_content` | gdrive | Multi-format branching: Google native export → plain text; DOCX/XLSX/PPTX → Office XML text extraction (ZIP traversal); PDF → pdfminer text extraction; images → base64 for LLM |
| 8 | `manage_contact` (update with merge modes) | gcontacts | Read-modify-write with etag retry loop (412 Precondition Failed); three merge modes (merge/replace/remove) per-field with 7 field-specific merge helpers |
| 9 | `create_drive_file` / `update_drive_file` / `import_to_google_*` | gdrive | `ssrf_safe_stream()` SSRF-safe URL streaming; `MediaIoBaseUpload` resumable chunked upload — must implement chunked upload protocol in TS |
| 10 | `download_chat_attachment` | gchat | Custom httpx download (not using Drive/googleapis client); Bearer token injection; SSRF-safe media endpoint; transport-mode-aware storage |

### Secondary Porting Challenges

- **Transport mode duality** (`core/attachment_storage.py`): All file-serving tools behave differently in stdio vs streamable-HTTP mode. TS port must replicate this dispatch.
- **`@require_google_service` / `@require_multiple_services`** decorators: These handle OAuth 2.1, service accounts, env-var creds, and multi-account multi-scope resolution. Significant auth infrastructure to replicate.
- **`create_comment_tools()` factory**: Registers tools dynamically at module load time. TS equivalent will need to be explicit or use a function that returns tool definitions.
- **`search_messages` (gchat)**: Client-side text filtering across all spaces — no server-side search on Chat API. Must replicate semaphore-limited concurrency and SSL retry.
- **Pydantic contact schemas** (`gcontacts`): `ContactInput` / `ContactUpdateInput` with multi-type field arrays. Zod equivalents are straightforward but verbose.
