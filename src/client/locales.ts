export const en = {
  'title': 'Native capabilities',
  'dialogLabel': 'Google native capabilities',
  'scope': 'Applies to this conversation and model',
  'nativeFiles': 'Use native input for new files',
  'nativeFilesHint': 'Send new PDF, audio and video attachments directly to the model. Turn off to use file paths and local tools. Earlier files keep their original mode.',
  'search': 'Google Search',
  'urlContext': 'URL context',
  'codeExecution': 'Code execution',
  'maps': 'Google Maps',
  'tools': 'Native tools',
  'toolsHint': 'Availability and charges depend on the selected model.',
  'localToolsHint': 'This connection does not call local tools in the same request while native tools are enabled.',
  'saving': 'Saving native options…',
  'error': 'Could not load or save native options.',
  'retry': 'Retry',
  'busy': 'Available after the current submission finishes',
  'readOnly': 'View only',
  'close': 'Close',
} as const

export const zh: Record<keyof typeof en, string> = {
  'title': '原生能力',
  'dialogLabel': 'Google 原生能力',
  'scope': '适用于当前会话与模型',
  'nativeFiles': '新上传文件使用模型原生能力',
  'nativeFilesHint': '新发送的 PDF、音频和视频直接交给模型读取；关闭后通过文件路径和本地工具处理。此前的文件保留原来的输入方式。',
  'search': 'Google 搜索',
  'urlContext': 'URL 上下文',
  'codeExecution': '代码执行',
  'maps': 'Google 地图',
  'tools': '原生工具',
  'toolsHint': '实际可用性与费用取决于所选模型。',
  'localToolsHint': '此连接启用原生工具时，不同时调用本地工具。',
  'saving': '正在保存原生选项…',
  'error': '原生选项加载或保存失败。',
  'retry': '重试',
  'busy': '本次提交结束后可修改',
  'readOnly': '仅可查看',
  'close': '关闭',
}

export type NativeLocaleKey = keyof typeof en

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { googleNative: NativeLocaleKey }
}
