import { Page } from 'puppeteer'
import { sleepWithRandomDelay, sleep } from '@geekgeekrun/utils/sleep.mjs'
import { completes } from '@geekgeekrun/utils/gpt-request.mjs'
import { recordGptCompletionRequest, RequestSceneEnum } from '../../features/llm-request-log'
import {
  readConfigFile,
  readStorageFile,
  writeStorageFile
} from '@geekgeekrun/geek-auto-start-chat-with-boss/runtime-file-utils.mjs'
import { formatResumeJsonToMarkdown } from '../../../common/utils/resume'
import { SINGLE_ITEM_DEFAULT_SERVE_WEIGHT } from '../../../common/constant'
import { LlmModelUsageRecord } from '@geekgeekrun/sqlite-plugin/dist/entity/LlmModelUsageRecord'
import gtag from '../../utils/gtag'

export const sendLookForwardReplyEmotion = async (page: Page) => {
  const emotionEntryButtonProxy = await page.$('.chat-conversation .message-controls .btn-emotion')
  await emotionEntryButtonProxy!.click()
  await sleepWithRandomDelay(1000)
  const duckEmotionTabEntryProxy = await page.$(
    '.chat-conversation .message-controls .emotion .emotion-tab .emotion-sort:nth-child(3)'
  )
  await duckEmotionTabEntryProxy!.click()
  await sleepWithRandomDelay(1500)
  const lookForwardReplyEmojiProxy = await page.$(
    `.chat-conversation .message-controls .emotion .emotion-box img[title=盼回复]`
  )
  await lookForwardReplyEmojiProxy!.click()
}

const pickLlmConfigFromList = (llmConfigList, blockModelSet) => {
  if (llmConfigList.length === 1) {
    llmConfigList[0].enabled = true
    llmConfigList[0].serveWeight = SINGLE_ITEM_DEFAULT_SERVE_WEIGHT
  }
  llmConfigList = llmConfigList.filter((it) => it.enabled && !blockModelSet.has(it.id))
  if (!llmConfigList.length) {
    return null
  }
  llmConfigList.forEach((conf) => {
    if (!Number(conf.serveWeight) || conf.serveWeight < 1) {
      conf.serveWeight = 1
    }
    if (conf.serveWeight > 100) {
      conf.serveWeight = 100
    }
  })
  const pool: number[] = []
  for (let i = 0; i < llmConfigList.length; i++) {
    for (let j = 0; j < Math.floor(llmConfigList[i].serveWeight); j++) {
      pool.push(llmConfigList[i].id)
    }
  }
  if (!pool.length) {
    return null
  }
  const index = Math.floor(pool.length * Math.random())
  return llmConfigList.find((it) => it.id === pool[index]) ?? null
}

// let _index = 0

const RESUME_PLACEHOLDER = `__REPLACE_REAL_RESUME_HERE__`
export const JOB_JD_PLACEHOLDER = `__REPLACE_REAL_JOB_JD_HERE__`
const JOB_JD_UNAVAILABLE_TEXT = '（当前会话没有获取到岗位JD）'
const JOB_JD_MAX_CHARS = 5000

function normalizeJobJdForPrompt(jobJd?: string) {
  const trimmed = typeof jobJd === 'string' ? jobJd.trim() : ''
  if (!trimmed) {
    return JOB_JD_UNAVAILABLE_TEXT
  }
  return trimmed.slice(0, JOB_JD_MAX_CHARS)
}

function replacePromptVariables(template: string, values: { resumeContent: string, jobJd: string }) {
  return template
    .split(RESUME_PLACEHOLDER).join(values.resumeContent)
    .split(JOB_JD_PLACEHOLDER).join(values.jobJd)
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) {
    return err.message
  }
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message?: unknown }).message ?? '')
  }
  return String(err ?? '')
}

export const defaultPromptMap = {
  rechat: {
    fileName: 'auto-reminder-resume-system-message-template.md',
    content: `**核心指令：**
你是一个智能求职助手，需要根据用户简历生成30字左右的提醒消息，满足以下要求：
1. 每次生成需满足：
   - √ 包含1个核心技能 + 1个成果量化
   - √ 使用不同句式模板（至少准备5种）
   - √ 谦虚一些，头衔、工作年限等在历史记录信息中出现一次就好
   - ✗ 严禁与最近发送的几条相似或雷同
   - ✗ 严禁出现简历之外的词语
   - ✗ 严禁包含最近8条已经发过的内容（包括但不限于职位名称）

**简历分析层：**
请从以下简历内容中提取关键要素：\n\`\`\`markdown\n${RESUME_PLACEHOLDER}\n\`\`\`\n

**岗位JD分析层：**
如果以下岗位JD不是“当前会话没有获取到岗位JD”，请优先提取岗位要求，并把开场白或提醒消息写成与岗位高相关的内容：\n\`\`\`markdown\n${JOB_JD_PLACEHOLDER}\n\`\`\`\n

---
要求提取：
1. 硬技能：编程语言/技术栈/工具证书等（至少提取5项）
2. 项目经历与成果：业绩、带量化数据的结果（至少3条）
3. 软技能：沟通/管理等（至少2项）
4. 特殊成就：奖项/专利等（可选）
5. 岗位匹配点：从JD中提取2-4个核心要求，并优先选择简历中能对应这些要求的经历或技能

**消息生成层：**
根据上述要素和岗位JD随机组合生成消息，优先表达“我的经历与这个岗位要求的匹配点”

**质量控制层：**
每次生成前执行：
1. 检查历史记录
2. 确保技能/成果组合未重复
3. 确保所生成的新消息不包含最近8条已经发过的内容（包括但不限于职位名称）
4. 字数严格控制在10-40字
5. 避免感叹号等激进符号
6. 减少头衔“资深”、“高级”出现的频率，严禁出现“专家”、“老兵”；减少工作年限“x年”出现的频率

**输出格式：**
请确保仅回复一句话，以JSON响应，不要包含其他解释或内容；数据结构参考：\`{"response": "这里是将会发送给招聘者的内容"}\``
  },
  open: {
    fileName: 'auto-reminder-open-message-template.md',
    content:
      `请根据我的简历和岗位JD，帮我写一句谦逊有礼貌、与岗位要求高相关的开场白。\n\n岗位JD：\n\`\`\`markdown\n${JOB_JD_PLACEHOLDER}\n\`\`\`\n\n要求：开头包含“您好”等类似敬语，结尾包含“期待回复”等类似话术；优先选择简历中与岗位JD最匹配的1个技能、项目或成果，不要堆砌关键词。请确保仅响应一句话，以JSON响应；数据结构参考：\`{"response": "这里是将会发送给招聘者的内容"}\``
  }
}

export const getValidTemplate = async ({ type }) => {
  let template = await readStorageFile(defaultPromptMap[type].fileName, { isJson: false })
  if (!template) {
    await writeDefaultAutoRemindPrompt({ type })
    template = defaultPromptMap[type].content
  }
  if (type === 'rechat' && !template.includes(RESUME_PLACEHOLDER)) {
    const e = new Error(`简历内容占位符字符串不存在。占位字符串是 ${RESUME_PLACEHOLDER}`)
    e.name = `RESUME_PLACEHOLDER_NOT_EXIST`
    throw e
  }
  return template
}

export const writeDefaultAutoRemindPrompt = async ({ type }) => {
  switch (type) {
    case 'rechat':
      await writeStorageFile(defaultPromptMap[type].fileName, defaultPromptMap[type].content, {
        isJson: false
      })
      break
    case 'open':
      await writeStorageFile(defaultPromptMap[type].fileName, defaultPromptMap[type].content, {
        isJson: false
      })
      break
  }
}

export const requestNewMessageContent = async (
  chatRecords,
  {
    requestScene,
    llmConfigIdForPick,
    jobJd
  }: {
    requestScene?: RequestSceneEnum
    llmConfigIdForPick?: string[] | null
    jobJd?: string
  } = {}
) => {
  const systemMessageTemplate = await getValidTemplate({ type: 'rechat' })
  const resumeObject = (await readConfigFile('resumes.json'))?.[0]
  const resumeContent = formatResumeJsonToMarkdown(resumeObject)
  const normalizedJobJd = normalizeJobJdForPrompt(jobJd)
  const promptValues = {
    resumeContent,
    jobJd: normalizedJobJd
  }
  const chatList = [
    {
      role: 'system',
      content: replacePromptVariables(systemMessageTemplate, promptValues)
    }
  ]
  const openMessageTemplate = await getValidTemplate({ type: 'open' })
  if (
    normalizedJobJd !== JOB_JD_UNAVAILABLE_TEXT &&
    !systemMessageTemplate.includes(JOB_JD_PLACEHOLDER) &&
    !openMessageTemplate.includes(JOB_JD_PLACEHOLDER)
  ) {
    chatList.push({
      role: 'system',
      content: `当前会话对应岗位JD：\n\`\`\`markdown\n${normalizedJobJd}\n\`\`\``
    })
  }
  chatList.push({
    role: 'user',
    content: replacePromptVariables(openMessageTemplate, promptValues)
  })
  // chatRecords = chatRecords.slice(chatRecords.length - _index)
  for (const record of chatRecords) {
    const assistantJsonContent = JSON.stringify({
      response: record.text
    })
    chatList.push({
      role: 'assistant',
      content: `\`\`\`json\n${assistantJsonContent}\n\`\`\``
    })
    chatList.push({
      role: 'user',
      content:
        '围绕我简历中关于自我介绍、技术栈、工作经历、项目描述、项目业绩等内容，并结合当前岗位JD的核心要求，写一句高相关的自我介绍。开头不必包含“您好”、结尾不必包含“期待回复”；务必确保本次所回复的内容不能与之前所回复的内容雷同或相似。请确保仅回复一句话，以JSON响应，不要包含其他解释或内容；数据结构参考：`{"response": "这里是将会发送给招聘者的内容"}`'
    })
  }
  console.log(chatList)
  let res, llmConfig
  const llmRequestRecord: Partial<Omit<LlmModelUsageRecord, 'id'>> = {}
  const blockModelSet = new Set()
  while (!res) {
    let llmConfigList = await readConfigFile('llm.json')
    if (llmConfigIdForPick?.length) {
      llmConfigList = llmConfigList.filter((it) => {
        return llmConfigIdForPick.includes(it.id)
      })
    }
    llmConfig = pickLlmConfigFromList(llmConfigList, blockModelSet)
    if (!llmConfig) {
      throw new Error(`CANNOT_FIND_A_USABLE_MODEL`)
    }
    console.log(llmConfig.providerCompleteApiUrl)
    Object.assign(llmRequestRecord, {
      providerCompleteApiUrl: llmConfig.providerCompleteApiUrl,
      model: llmConfig.model,
      providerApiSecret: llmConfig.providerApiSecret,
      requestStartTime: new Date(),
      hasError: false,
      errorMessage: '',
      requestScene
    })
    try {
      const completion = await completes(
        {
          baseURL: llmConfig.providerCompleteApiUrl,
          apiKey: llmConfig.providerApiSecret,
          model: llmConfig.model
        },
        chatList
      )
      res = completion?.choices?.[0] ?? null
      Object.assign(llmRequestRecord, {
        completionTokens: completion.usage?.completion_tokens ?? null,
        promptCacheHitTokens: completion.usage?.prompt_cache_hit_tokens ?? null,
        promptCacheMissTokens: completion.usage?.prompt_cache_miss_tokens ?? null,
        promptTokens: completion.usage?.prompt_tokens ?? null,
        totalTokens: completion.usage?.total_tokens ?? null
      } as LlmModelUsageRecord)
    } catch (err) {
      console.log('request failed', err)
      blockModelSet.add(llmConfig.id)
      Object.assign(llmRequestRecord, {
        hasError: true,
        errorMessage: getErrorMessage(err)
      })
    } finally {
      llmRequestRecord.requestEndTime = new Date()
      try {
        await recordGptCompletionRequest(llmRequestRecord)
      } catch (err) {
        console.log('CANNOT_SAVE_LLM_COMPLETION_LOG', err)
      }
    }
  }
  console.log(res)
  // _index++
  let textToSend
  try {
    const rawMarkdownText = res?.message?.content
    try {
      textToSend = JSON.parse(
        rawMarkdownText.replace(/^```json/m, '').replace(/```$/m, '')
      )?.response
    } catch (err) {
      gtag('encounter_error_when_parse_llm_text', {
        err,
        model: llmConfig?.model,
        providerCompleteApiUrl: llmConfig?.providerCompleteApiUrl
      })
      throw err
    }
    textToSend = textToSend?.replace(/。$/, '')
    if (!textToSend) {
      gtag('llm_respond_text_is_empty', {
        model: llmConfig?.model,
        providerCompleteApiUrl: llmConfig?.providerCompleteApiUrl
      })
      throw new Error(`empty content. ${res?.message?.content ?? ''}`)
    }
  } catch (err) {
    throw new Error(`fail to parse response. ${getErrorMessage(err)} ${res?.message?.content}`)
  }
  return {
    responseText: textToSend,
    usedLlmConfig: llmConfig,
    recordInfo: llmRequestRecord
  }
}

export async function getGptContent(chatRecords, { jobJd }: { jobJd?: string } = {}) {
  const textToSend = (
    await requestNewMessageContent(chatRecords, {
      requestScene: RequestSceneEnum.readNoReplyAutoReminder,
      jobJd
    })
  ).responseText
  return textToSend
}

export async function sendMessage(page: Page, textToSend: string) {
  const chatInputSelector = `.chat-conversation .message-controls .chat-input`
  const chatInputHandle = (await page.$(chatInputSelector))!
  await chatInputHandle.click()
  await sleep(500)
  await chatInputHandle.click()
  await chatInputHandle.type(textToSend, {
    delay: 50
  })
  await sleep(1000)
  const sendButtonSelector = `.chat-conversation .message-controls .chat-op .btn-send:not(.disabled)`
  await page.click(sendButtonSelector)
}
