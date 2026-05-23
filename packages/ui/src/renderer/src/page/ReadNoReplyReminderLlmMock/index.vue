<template>
  <div class="h100vh flex flex-col">
    <div class="mock-context-bar">
      <el-select
        v-model="selectedJobId"
        filterable
        :loading="isJobLoading"
        placeholder="随机采集用于模拟的岗位JD"
        class="mock-job-select"
      >
        <el-option
          v-for="item in jobOptionList"
          :key="item.encryptJobId"
          :value="item.encryptJobId"
          :label="formatJobOptionLabel(item)"
        >
          <div>{{ formatJobOptionLabel(item) }}</div>
          <div class="mock-job-option-subtitle">{{ item.positionName || item.companyName }}</div>
        </el-option>
      </el-select>
      <el-button size="small" :loading="isJobLoading" @click="fetchRandomJobForMock">
        随机采集JD
      </el-button>
      <el-button size="small" :disabled="!selectedJobInfo" @click="jobJdDialogVisible = true">
        查看当前JD
      </el-button>
      <el-button
        size="small"
        :disabled="!lastRequestMessages.length"
        @click="promptDialogVisible = true"
      >
        查看最后Prompt
      </el-button>
      <el-button size="small" @click="openDebugLog">打开Prompt日志</el-button>
    </div>
    <div
      ref="scrollElRef"
      :style="{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        overflow: `auto`,
        margin: `0 auto`,
        alignItems: `flex-end`,
        width: '100%'
      }"
    >
      <div
        v-if="messageList.length"
        :style="{
          width: '480px',
          margin: '0 auto'
        }"
      >
        <div class="pb20px"></div>
        <div v-for="(item, index) in messageList" :key="index" flex flex-col flex-items-end>
          <div class="message-item-wrap flex flex-col">
            <template v-if="item.type === 'text'">
              <div
                class="message-item"
                :class="{
                  'will-enter-context': getIsEnterContent(index)
                }"
              >
                {{ item.text }}
              </div>
            </template>
            <template v-else>
              <div
                class="message-item image-message-item"
                :class="{
                  'will-enter-context': getIsEnterContent(index)
                }"
              >
                <img :src="item.imageUrl" alt="" />
              </div>
            </template>
            <!-- eslint-disable-next-line prettier/prettier -->
            <template v-if="(typeof item.usedLlmConfig !== 'string')">
              <div
                :style="{
                  width: 'fit-content',
                  alignSelf: 'flex-end'
                }"
                font-size-10px
              >
                {{ item.usedLlmConfig.model }}
              </div>
              <div
                v-if="item?.usedLlmConfig?.providerCompleteApiUrl?.trim()"
                :style="{
                  width: 'fit-content',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  alignSelf: 'flex-end',
                  color: '#bbb'
                }"
                font-size-10px
                w-fit-content
                max-w-20em
              >
                {{ item.usedLlmConfig.providerCompleteApiUrl }}
              </div>
            </template>
            <template v-else>
              <div
                :style="{
                  width: 'fit-content',
                  alignSelf: 'flex-end'
                }"
                font-size-10px
              >
                {{ item.usedLlmConfig }}
              </div>
            </template>
          </div>
        </div>
        <div class="pb20px"></div>
      </div>
      <div v-else w-full h-full flex flex-item-center justify-center>
        <el-empty>
          <template #description>
            <template v-if="!isLoading">
              点击下方 “<el-button
                font-size-16px
                h-fit-content
                align-baseline
                p0
                type="text"
                @click.prevent="sendLlmGeneratedContent"
                >发送开场白</el-button
              >” 以开始模拟聊天
            </template>
            <template v-else>请稍候，第一条消息正在回复的路上~</template>
          </template>
        </el-empty>
      </div>
    </div>
    <div
      :style="{
        display: 'grid',
        gridTemplateColumns: 'min-content 1fr min-content',
        height: `fit-content`,
        paddingTop: `10px`,
        paddingBottom: `10px`,
        backgroundColor: `#f0f0f0`
      }"
    >
      <el-select v-model="selectedLlmConfig" ml10px w160px placeholder="随机使用一个模型">
        <el-option
          v-for="(it, index) in llmConfigListForRender"
          :key="index"
          :value="it.id"
          :label="it.model"
          :disabled="!it.enabled"
          :style="{
            paddingTop: '10px',
            paddingBottom: '10px',
            height: 'auto',
            lineHeight: '1.25em'
          }"
        >
          <div
            :style="{
              display: 'flex',
              justifyContent: 'space-between'
            }"
          >
            <div>{{ it.model }}</div>
            <div class="font-size-12px color-#bbb">
              {{ formatApiSecret(it.providerApiSecret) || '' }}
            </div>
          </div>
          <div
            v-if="it?.providerCompleteApiUrl?.trim?.()"
            :style="{
              color: '#bbb',
              width: '35em',
              fontSize: '12px',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }"
          >
            {{ it.providerCompleteApiUrl }}
          </div>
        </el-option>
      </el-select>
      <el-button
        :loading="isLoading"
        width-fit-content
        type="primary"
        @click="sendLlmGeneratedContent"
      >
        <template v-if="isLoading">正在生成消息，请稍候...</template>
        <template v-else-if="!messageList.length">发送开场白</template>
        <template v-else>发送下一句提醒内容</template>
      </el-button>
      <el-button mr10px type="text" @click="closeWindow">关闭对话框</el-button>
    </div>
    <el-dialog v-model="jobJdDialogVisible" title="当前模拟使用的岗位JD" width="90%">
      <div v-if="selectedJobInfo" class="mock-dialog-title">
        {{ formatJobOptionLabel(selectedJobInfo) }}
      </div>
      <pre class="mock-debug-pre">{{ selectedJobJd || '当前没有可用岗位JD' }}</pre>
    </el-dialog>
    <el-dialog v-model="promptDialogVisible" title="最后一次发给AI的Prompt" width="90%">
      <div v-if="lastPromptJobInfo" class="mock-dialog-title">
        JD来源：{{ formatJobOptionLabel(lastPromptJobInfo) }}
      </div>
      <div v-for="(item, index) in lastRequestMessages" :key="index" class="mock-prompt-item">
        <div class="mock-prompt-role">{{ item.role }}</div>
        <pre class="mock-debug-pre">{{ item.content }}</pre>
      </div>
    </el-dialog>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import { sleep } from '@geekgeekrun/utils/sleep.mjs'
import { ElMessage } from 'element-plus'
import { gtagRenderer } from '@renderer/utils/gtag'
import {
  OPEN_CONTENT_SOURCE,
  RECHAT_CONTENT_SOURCE
} from '../../../../common/enums/auto-start-chat'
import { DEFAULT_CONSTANT_OPEN_CONTENT_SEGS } from '../../../../common/constant'
import lookForwardReplyEmotion from '../MainLayout/resources/look-forward-reply-emotion.gif'

type MessageItem = {
  text: string
  usedLlmConfig: string
  type: 'text'
  // recordInfo: any
}
type ImageMessageItem = MessageItem & {
  type: 'image'
  imageUrl: string
}
type PromptMessage = {
  role: string
  content: string
}
type JobOption = {
  encryptJobId: string
  jobName?: string
  positionName?: string
  companyName?: string
  bossName?: string
  description?: string
}
const messageList = ref<(MessageItem | ImageMessageItem)[]>([])
const searchParams = Object.fromEntries(new URL(location.href).searchParams)

const recentMessageQuantityForLlm = Number(searchParams.recentMessageQuantityForLlm) || 8
function getIsEnterContent(index) {
  return messageList.value.length - index - 1 < recentMessageQuantityForLlm
}

const llmConfigList = ref([])
const llmConfigListForRender = computed(() => {
  return [
    {
      id: null,
      model: '随机使用一个模型',
      providerCompleteApiUrl: null,
      enabled: true
    },
    ...(llmConfigList.value ?? [])
  ]
})
async function getLlmConfigList() {
  llmConfigList.value = await electron.ipcRenderer.invoke('get-llm-config-for-test')
}
getLlmConfigList().catch(() => {})
const selectedLlmConfig = ref(null)
const selectedLlmConfigForRender = computed(() => {
  return llmConfigListForRender.value.find((it) => it.id === selectedLlmConfig.value) ?? null
})
watch(
  () => selectedLlmConfig.value,
  () => {
    gtagRenderer('change_mock_chat_llm_model', {
      model: selectedLlmConfigForRender.value?.model ?? ''
    })
  }
)

const jobOptionList = ref<JobOption[]>([])
const selectedJobId = ref('')
const isJobLoading = ref(false)
const jobJdDialogVisible = ref(false)
const promptDialogVisible = ref(false)
const lastRequestMessages = ref<PromptMessage[]>([])
const lastPromptJobInfo = ref<JobOption | null>(null)
const selectedJobInfo = computed(() => {
  return jobOptionList.value.find((it) => it.encryptJobId === selectedJobId.value) ?? null
})
const selectedJobJd = computed(() => selectedJobInfo.value?.description?.trim?.() ?? '')

function formatJobOptionLabel(jobInfo?: JobOption | null) {
  if (!jobInfo) {
    return ''
  }
  return [jobInfo.companyName, jobInfo.jobName || jobInfo.positionName].filter(Boolean).join(' - ')
}

async function fetchRandomJobForMock() {
  isJobLoading.value = true
  try {
    const jobInfo = (await electron.ipcRenderer.invoke(
      'fetch-random-recommend-job-for-test'
    )) as JobOption
    if (!jobInfo?.description?.trim?.()) {
      ElMessage.warning('本次没有采集到可用于模拟的JD，请稍后重试')
      return
    }
    jobOptionList.value = [jobInfo, ...jobOptionList.value].filter(
      (it, index, arr) => arr.findIndex((item) => item.encryptJobId === it.encryptJobId) === index
    )
    selectedJobId.value = jobInfo.encryptJobId
    ElMessage.success('已随机采集一条推荐职位JD')
  } catch (err) {
    console.log(err)
    ElMessage.error('随机采集推荐职位JD失败，请确认已登录且推荐职位页可访问')
  } finally {
    isJobLoading.value = false
  }
}
fetchRandomJobForMock().catch(() => {})

const scrollElRef = ref(null)
const isLoading = ref(false)
const openContentSource = Number(searchParams.openContentSource)
const constantOpenContent = (() => {
  if (searchParams.constantOpenContent?.trim()) {
    return searchParams.constantOpenContent.trim()
  }
  if (Number(searchParams.rechatContentSource) === RECHAT_CONTENT_SOURCE.GEMINI_WITH_CHAT_CONTEXT) {
    return DEFAULT_CONSTANT_OPEN_CONTENT_SEGS.join(`；`)
  } else {
    return DEFAULT_CONSTANT_OPEN_CONTENT_SEGS[0]
  }
})()
const rechatContentSource = Number(searchParams.rechatContentSource)

function buildLlmRequestPayload(messageListForRequest) {
  if (!selectedJobJd.value) {
    ElMessage.error('当前没有选中的岗位JD，无法模拟AI生成')
    return null
  }
  return {
    messageList: messageListForRequest,
    llmConfigIdForPick: selectedLlmConfig.value ? [selectedLlmConfig.value] : null,
    jobJd: selectedJobJd.value,
    jobInfo: selectedJobInfo.value
      ? {
          encryptJobId: selectedJobInfo.value.encryptJobId,
          jobName: selectedJobInfo.value.jobName,
          positionName: selectedJobInfo.value.positionName,
          companyName: selectedJobInfo.value.companyName,
          bossName: selectedJobInfo.value.bossName
        }
      : null
  }
}

function handleLlmResponse(response) {
  lastRequestMessages.value = response.requestMessages ?? []
  lastPromptJobInfo.value = selectedJobInfo.value
  messageList.value.push({
    type: 'text',
    text: response.responseText,
    usedLlmConfig: response.usedLlmConfig
  })
}

async function sendLlmGeneratedContent() {
  gtagRenderer('click_mock_chat_send')
  if (!(messageList.value ?? []).length) {
    // send open content
    if (openContentSource === OPEN_CONTENT_SOURCE.GEMINI_WITH_CHAT_CONTEXT) {
      isLoading.value = true
      try {
        const requestPayload = buildLlmRequestPayload([])
        if (!requestPayload) {
          return
        }
        const response = await electron.ipcRenderer.invoke('request-llm-for-test', requestPayload)
        console.log(response)
        handleLlmResponse(response)
        await sleep(50)
        ;(scrollElRef.value as any as HTMLDivElement)?.scrollTo({
          top: scrollElRef.value?.scrollHeight,
          behavior: 'smooth'
        })
      } catch (err) {
        ElMessage.error({
          dangerouslyUseHTMLString: true,
          grouping: true,
          message: `<div>本次测试所使用的模型不可用</div><div style="margin-top: 10px; white-space: nowrap;">建议在大语言模型配置中关闭相关模型</div>`
        })
      } finally {
        isLoading.value = false
      }
    } else {
      messageList.value.push({
        type: 'text',
        text: constantOpenContent,
        usedLlmConfig: '未使用大模型'
      })
    }
  } else {
    if (rechatContentSource === RECHAT_CONTENT_SOURCE.GEMINI_WITH_CHAT_CONTEXT) {
      isLoading.value = true
      try {
        const requestPayload = buildLlmRequestPayload(
          JSON.parse(JSON.stringify((messageList.value ?? []).slice(-recentMessageQuantityForLlm)))
        )
        if (!requestPayload) {
          return
        }
        const response = await electron.ipcRenderer.invoke('request-llm-for-test', requestPayload)
        console.log(response)
        handleLlmResponse(response)
        await sleep(50)
        ;(scrollElRef.value as any as HTMLDivElement)?.scrollTo({
          top: scrollElRef.value?.scrollHeight,
          behavior: 'smooth'
        })
      } catch (err) {
        ElMessage.error({
          dangerouslyUseHTMLString: true,
          grouping: true,
          message: `<div>本次测试所使用的模型不可用</div><div style="margin-top: 10px; white-space: nowrap;">建议在大语言模型配置中关闭相关模型</div>`
        })
      } finally {
        isLoading.value = false
      }
    } else {
      messageList.value.push({
        type: 'image',
        text: `[盼回复] 表情`,
        imageUrl: lookForwardReplyEmotion,
        usedLlmConfig: '未使用大模型'
      })
    }
  }
}

async function openDebugLog() {
  await electron.ipcRenderer.invoke('open-read-no-reply-llm-debug-log')
}

function closeWindow() {
  electron.ipcRenderer.send(`close-read-no-reply-reminder-llm-mock-window`)
}

function formatApiSecret(text) {
  if (typeof text !== 'string' || !text?.trim()) {
    return ''
  }
  if (text === 'ollama') {
    return text
  }
  if (text.length >= 8) {
    return `${text.slice(0, 4)}***${text.slice(-4)}`
  }
  return `***`
}

gtagRenderer('enter_mock_chat_page')
</script>

<style lang="scss" scoped>
.mock-context-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  align-items: center;
  padding: 8px 10px;
  border-bottom: 1px solid #e6e6e6;
  background: #fafafa;
}
.mock-job-select {
  width: 100%;
  grid-column: 1 / -1;
}
.mock-context-bar :deep(.el-button) {
  width: 100%;
  margin-left: 0;
}
.mock-job-option-subtitle {
  color: #999;
  font-size: 12px;
  line-height: 1.2;
}
.mock-dialog-title {
  margin-bottom: 8px;
  font-weight: 600;
}
.mock-debug-pre {
  max-height: 55vh;
  overflow: auto;
  margin: 0;
  padding: 10px;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid #e6e6e6;
  border-radius: 4px;
  background: #f8f8f8;
  font-size: 12px;
  line-height: 1.5;
}
.mock-prompt-item + .mock-prompt-item {
  margin-top: 12px;
}
.mock-prompt-role {
  margin-bottom: 4px;
  color: #666;
  font-size: 12px;
  font-weight: 600;
}
.message-item-wrap {
  max-width: 420px;
  margin-top: 20px;
  .message-item {
    line-height: 1.25em;
    font-size: 14px;
    background-color: #d1f0ef;
    color: #333;
    padding: 10px;
    border-radius: 8px 8px 0 0;
    &.will-enter-context {
      position: relative;
      &::before {
        content: '聊天上下文';
        display: flex;
        font-size: 10px;
        position: absolute;
        top: 100%;
        left: 0;
        background-color: #10c7c3;
        color: #fff;
        line-height: 1;
        padding: 2px 4px;
      }
    }
  }
  .message-item.image-message-item {
    background-color: transparent;
    width: 128px;
    img {
      width: 100%;
    }
  }
}
</style>
