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
