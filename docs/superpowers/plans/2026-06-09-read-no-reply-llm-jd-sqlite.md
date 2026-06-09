# Read No Reply LLM JD SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production read-no-reply LLM opening and follow-up generation use JD from SQLite only, with no job-detail page collection fallback.

**Architecture:** Keep the behavior inside the existing `READ_NO_REPLY_AUTO_REMINDER_MAIN` production flow. Rename the JD helper to make its SQLite-only contract explicit, keep both LLM branches calling that helper by exact `encryptJobId`, and add a dependency-free Node verification script that guards against browser-detail collection being added to this helper later.

**Tech Stack:** Electron main process TypeScript, Puppeteer page automation already present in the flow, `@geekgeekrun/sqlite-plugin`, Node.js ESM verification script, pnpm workspace scripts.

---

## File Structure

- Modify `packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts`
  - Owns the production read-no-reply automation loop.
  - Change only the LLM JD helper name and its two LLM call sites.
  - Keep empty `encryptJobId`, missing SQLite row, and SQLite errors returning `''`.

- Create `scripts/verify-read-no-reply-llm-jd-sqlite-only.mjs`
  - Reads the production flow source.
  - Extracts the `getSqliteJobJdByEncryptJobId()` function body.
  - Fails if the helper does not query SQLite, if it contains browser/detail collection tokens, or if the two LLM JD call sites do not use the SQLite helper.

- Modify `package.json`
  - Adds a root workspace verification command for the static guard script.

---

### Task 1: Add SQLite-Only Static Guard

**Files:**
- Create: `scripts/verify-read-no-reply-llm-jd-sqlite-only.mjs`
- Modify: `package.json`

- [ ] **Step 1: Create the failing guard script**

Create `scripts/verify-read-no-reply-llm-jd-sqlite-only.mjs` with this complete content:

```js
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceFile = resolve(
  rootDir,
  'packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts'
)
const source = readFileSync(sourceFile, 'utf8')
const functionName = 'getSqliteJobJdByEncryptJobId'

function fail(message) {
  console.error(message)
  process.exit(1)
}

function extractFunctionBody(name) {
  const startToken = `async function ${name}`
  const startIndex = source.indexOf(startToken)
  if (startIndex === -1) {
    fail(`Missing function ${name}`)
  }

  const bodyStart = source.indexOf('{', startIndex)
  if (bodyStart === -1) {
    fail(`Missing function body for ${name}`)
  }

  let depth = 0
  for (let i = bodyStart; i < source.length; i++) {
    const char = source[i]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        return source.slice(bodyStart + 1, i)
      }
    }
  }

  fail(`Unclosed function body for ${name}`)
}

const body = extractFunctionBody(functionName)

if (!body.includes('getJobInfoRecord(await dbInitPromise, encryptJobId)')) {
  fail(`${functionName} must read JD through getJobInfoRecord(await dbInitPromise, encryptJobId)`)
}

for (const forbiddenToken of [
  'waitForPage',
  '.goto(',
  '.click(',
  'job/detail.json',
  'job-detail',
  'targetPage',
  'pageMapByName',
  'evaluate('
]) {
  if (body.includes(forbiddenToken)) {
    fail(`${functionName} must not contain browser/detail collection token: ${forbiddenToken}`)
  }
}

const llmJdCallPattern = /jobJd:\s*await getSqliteJobJdByEncryptJobId\(currentEncryptJobId\)/g
const llmJdCallCount = source.match(llmJdCallPattern)?.length ?? 0

if (llmJdCallCount !== 2) {
  fail(`Expected 2 LLM JD call sites to use ${functionName}; found ${llmJdCallCount}`)
}

if (source.includes('jobJd: await getJobJdByEncryptJobId(currentEncryptJobId)')) {
  fail('Found old LLM JD helper call site')
}

console.log('read-no-reply LLM JD lookup is SQLite-only')
```

- [ ] **Step 2: Run the guard and confirm it fails before the production change**

Run:

```bash
node ./scripts/verify-read-no-reply-llm-jd-sqlite-only.mjs
```

Expected output:

```text
Missing function getSqliteJobJdByEncryptJobId
```

- [ ] **Step 3: Add the root verification script**

Modify the root `package.json` scripts block from:

```json
"scripts": {
  "start": "node ./packages/run-core-of-geek-auto-start-chat-with-boss/daemon-main.mjs"
},
```

to:

```json
"scripts": {
  "start": "node ./packages/run-core-of-geek-auto-start-chat-with-boss/daemon-main.mjs",
  "verify:read-no-reply-llm-jd": "node ./scripts/verify-read-no-reply-llm-jd-sqlite-only.mjs"
},
```

- [ ] **Step 4: Do not commit yet**

Keep these verification changes staged only after Task 2 passes, so the commit contains both the behavior boundary and its guard.

---

### Task 2: Make Production LLM JD Lookup Explicitly SQLite-Only

**Files:**
- Modify: `packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts`

- [ ] **Step 1: Rename and document the JD helper**

Replace this function:

```ts
async function getJobJdByEncryptJobId(encryptJobId?: string | null) {
  if (!encryptJobId) {
    return ''
  }
  try {
    const jobInfo = await getJobInfoRecord(await dbInitPromise, encryptJobId)
    return jobInfo?.description?.trim?.() ?? ''
  } catch (err) {
    console.log(`get job JD failed: ${encryptJobId}`, err)
    return ''
  }
}
```

with:

```ts
// Keep LLM JD lookup SQLite-only. Opening job details here can steal focus on macOS.
async function getSqliteJobJdByEncryptJobId(encryptJobId?: string | null) {
  if (!encryptJobId) {
    return ''
  }
  try {
    const jobInfo = await getJobInfoRecord(await dbInitPromise, encryptJobId)
    return jobInfo?.description?.trim?.() ?? ''
  } catch (err) {
    console.log(`get job JD from sqlite failed: ${encryptJobId}`, err)
    return ''
  }
}
```

- [ ] **Step 2: Update the opening-message LLM branch**

Replace this call:

```ts
const textToSend = await getGptContent(messageList, {
  jobJd: await getJobJdByEncryptJobId(currentEncryptJobId)
})
```

with:

```ts
const textToSend = await getGptContent(messageList, {
  jobJd: await getSqliteJobJdByEncryptJobId(currentEncryptJobId)
})
```

- [ ] **Step 3: Update the follow-up LLM branch**

Replace the second occurrence of:

```ts
const textToSend = await getGptContent(messageList, {
  jobJd: await getJobJdByEncryptJobId(currentEncryptJobId)
})
```

with:

```ts
const textToSend = await getGptContent(messageList, {
  jobJd: await getSqliteJobJdByEncryptJobId(currentEncryptJobId)
})
```

- [ ] **Step 4: Run the static guard through Node**

Run:

```bash
node ./scripts/verify-read-no-reply-llm-jd-sqlite-only.mjs
```

Expected output:

```text
read-no-reply LLM JD lookup is SQLite-only
```

- [ ] **Step 5: Run the static guard through pnpm**

Run:

```bash
pnpm run verify:read-no-reply-llm-jd
```

Expected output includes:

```text
read-no-reply LLM JD lookup is SQLite-only
```

- [ ] **Step 6: Run the UI node typecheck**

Run:

```bash
pnpm --dir packages/ui run typecheck:node
```

Expected output:

```text
> geekgeekrun-ui@0.17.4 typecheck:node
> tsc --noEmit -p tsconfig.node.json --composite false
```

and process exit code `0`.

- [ ] **Step 7: Static source audit for forbidden production LLM JD collection**

Run:

```bash
rg -n "getSqliteJobJdByEncryptJobId|getJobJdByEncryptJobId|jobJd: await|waitForPage|job/detail.json|job-detail|targetPage|pageMapByName|evaluate\\(" packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts
```

Expected findings:

```text
packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts:<line>:async function getSqliteJobJdByEncryptJobId(encryptJobId?: string | null) {
packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts:<line>:              jobJd: await getSqliteJobJdByEncryptJobId(currentEncryptJobId)
packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts:<line>:              jobJd: await getSqliteJobJdByEncryptJobId(currentEncryptJobId)
```

Other findings for `waitForPage`, `targetPage`, `pageMapByName`, or `evaluate(` may exist elsewhere in `index.ts`; confirm they are outside the `getSqliteJobJdByEncryptJobId()` helper and are not used as JD fallback inside the two LLM generation calls.

- [ ] **Step 8: Commit the implementation**

Run:

```bash
git add package.json scripts/verify-read-no-reply-llm-jd-sqlite-only.mjs packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts
git commit -m "fix: keep read-no-reply LLM JD lookup sqlite-only"
```

Expected commit summary:

```text
fix: keep read-no-reply LLM JD lookup sqlite-only
```

---

## Self-Review

Spec coverage:

- Exact `encryptJobId` lookup is covered by Task 2 Step 1 and existing `currentEncryptJobId` resolution remains unchanged.
- SQLite-only data source is covered by Task 2 Step 1 and enforced by Task 1 Step 1.
- Empty JD and SQLite lookup errors continue returning `''`, covered by Task 2 Step 1.
- Opening and follow-up LLM branches both call the same helper, covered by Task 2 Steps 2 and 3.
- No mock/test-window changes are included in the file structure or tasks.
- No job closed/status, browser launch, `bringToFront`, non-LLM message, schema, freshness, or manual refresh changes are included.

Placeholder scan:

- No `TBD`, `TODO`, `implement later`, or undefined functions are present.

Type consistency:

- The helper is named `getSqliteJobJdByEncryptJobId` in the script, production function, and both call sites.
- The `encryptJobId?: string | null` signature and `getJobInfoRecord(await dbInitPromise, encryptJobId)` call match the existing production code.
