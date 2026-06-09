# Read No Reply LLM JD SQLite Design

## Context

The read-no-reply auto reminder flow can generate an LLM-based opening message or follow-up message. Feedback from macOS users indicates that extra job-detail page opens during JD collection can steal focus and switch Spaces.

The relevant production flow is `READ_NO_REPLY_AUTO_REMINDER_MAIN`. It already has access to the current chat conversation and can derive the target BOSS job id from `conversation$.encryptJobId`, with the left-side chat list item as a fallback. JD data is persisted in SQLite `job_info.description`, keyed by `job_info.encryptJobId`.

## Goal

For production read-no-reply LLM opening and follow-up messages, JD lookup must be SQLite-only:

- Resolve the target `encryptJobId` from the current chat conversation.
- Query SQLite `job_info.description` by that exact `encryptJobId`.
- Pass the resulting JD text into the existing LLM prompt builder.
- If no JD is available or SQLite lookup fails, continue with an empty JD so the existing prompt fallback is used.
- Do not open a BOSS job-detail page, click a job card, or trigger JD collection for this LLM generation path.

## Non-Goals

This change does not modify:

- The LLM mock/test window random JD collection behavior.
- The existing job closed/status check logic.
- Browser launch, `bringToFront`, macOS focus behavior, or a general low-disturbance mode.
- Normal non-LLM fixed-message or emoji fallback behavior.
- SQLite schema, JD freshness rules, manual JD refresh, or structured JD resolution logs.

## Current Behavior

The production LLM call path is:

1. Select a chat conversation in the BOSS chat page.
2. Read `conversation$.encryptJobId`, falling back to the chat list item id when needed.
3. Call `getJobJdByEncryptJobId(currentEncryptJobId)`.
4. Pass the returned text into `getGptContent()`.
5. `getGptContent()` calls `requestNewMessageContent()`.

The desired behavior is to keep this path SQLite-only and make that contract explicit. Any code in this path must not add fallback logic that opens BOSS job-detail pages to collect missing JD.

## Design

Add a small explicit boundary around JD lookup for this flow. The existing `getJobJdByEncryptJobId()` may remain the implementation point, but its contract should be clear:

- Input: `encryptJobId` for the currently selected chat conversation.
- Data source: SQLite only, through `getJobInfoRecord(db, encryptJobId)`.
- Output: trimmed `description` or an empty string.
- Failure handling: catch lookup errors, log them, return an empty string.
- Forbidden behavior: no browser navigation, no page clicks, no job-detail opening, no network wait for `job/detail.json`.

The LLM opening-message branch and follow-up branch should both use this same function before calling `getGptContent()`.

## Target Matching

The JD must only be matched by exact `encryptJobId`. No fuzzy matching by job title, company name, boss name, or page text is allowed.

The target id resolution remains:

1. Prefer `conversation$.encryptJobId` from the selected chat editor.
2. Fall back to `friendListData[toCheckItemAtIndex].encryptJobId` only when the current conversation id is unavailable.

If no `encryptJobId` is available, the JD lookup returns an empty string and the LLM prompt uses its existing no-JD fallback.

## Empty JD Behavior

An empty JD is not fatal. The flow continues and the existing prompt path uses the no-JD placeholder. Existing LLM fallback behavior remains unchanged:

- Opening message LLM failure falls back to configured constant content.
- Follow-up LLM failure follows the current fallback setting, such as sending the look-forward reply emotion.

## Verification

Static verification:

- Confirm the production read-no-reply LLM branches call the SQLite-only JD lookup.
- Confirm there is no call in that LLM JD lookup path to `waitForPage`, job-detail selectors, page navigation, page click, or `job/detail.json` waits.

Functional verification:

- Run type checking for the UI package if implementation changes TypeScript.
- Test the LLM opening-message branch with an existing SQLite JD.
- Test the LLM follow-up branch with an existing SQLite JD.
- Test both branches when SQLite has no matching `job_info` row; generation should continue without opening a job-detail page.

## Risks

If SQLite lacks JD for a conversation, generated messages may be less specific. This is acceptable for this scope because avoiding extra job-detail page opens is more important than automatic JD backfill in the production read-no-reply LLM path.

If the current conversation id cannot be read, the flow must not guess. It should continue without JD rather than risk using another job's JD.
