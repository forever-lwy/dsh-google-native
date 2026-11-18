export const en = {
  'title': 'Native capabilities',
  'dialogLabel': 'Google native capabilities',
  'scope': 'Options for this conversation',
  'nativeFiles': 'Use native file input',
  'nativeFilesHint': 'Shared across models in this conversation. Supported files go directly to the model. Other files use local file tools. Turning this off also applies to files in the conversation history.',
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
  'scope': '当前会话的原生选项',
  'nativeFiles': '文件使用模型原生能力',
  'nativeFilesHint': '本会话切换模型时沿用此开关。支持的文件直接交给模型，其他文件交给本地文件工具。关闭后，历史文件也使用本地路径。',
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
