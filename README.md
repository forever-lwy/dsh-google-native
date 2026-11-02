# Google 原生供应商插件

`dsh-google-native` 为 DeepSeek Harness 提供 Google AI Studio（Gemini Developer API）和 Vertex AI 两套原生后端，使用官方 `@google/genai` SDK。待安装版本 `0.1.10` 针对 dsh `0.2.1-rc.5`，SDK 固定为 `2.32.0`，Node.js 要求 22 或以上。

`0.1.10` 修复工具返回图片的兼容性：截图等工具产生的真实图片和媒体使用普通用户媒体输入通道，保留对应工具的结果与调用标识，不再依赖上游对多模态工具结果的支持。同一批工具返回的相同截图只附加一次；模型主动附加工作区图片、PTC 下一步输入和历史恢复继续保留原始字节与来源校验。

手动上传图片后，成功发送的文字和附件不再被恢复到输入框。聊天选项记录不会将正常消息误标成取消；真正发送失败时仍保留草稿，等待发送期间新输入的内容也不会被清除。

`0.1.9` 在原生文件输入旁保留 dsh 的本地只读路径与操作提示。模型可直接理解文件，同时用本地工具读取、处理或复制到工作区；普通上传、模型主动附加和 PTC 均保留这个入口。路径沿用当前执行环境的真实映射，不使用 Google 临时文件地址替代。

`0.1.8` 修正模型页的重复编辑入口：两张 Google 原生供应商卡片只保留可用的 **配置 Google 提供商**，隐藏宿主无法编辑本插件的 **编辑** 按钮及其 YAML 提示表单。其他供应商的编辑入口保留。该兼容调整针对 dsh `0.2.1-rc.5`；升级宿主时需重新核对卡片结构。

模型可调用 `google_native_attach_file` 工具，将工作区文件的原始字节加入当前会话，由同一个 Google 主模型在下一次请求中直接读取。支持普通函数调用和 PTC `run_code`，不使用解析器或额外模型。模型页的元数据自动填写、逐模型高级设置，以及聊天中的原生工具选项继续保留。

## 能力范围

普通 dsh 对话通过 Gemini `generateContentStream`，支持流式文本、思考摘要与强度配置、函数调用，以及模型原生接受的图片、视频、音频、PDF 等文件输入。上传文件的原始数据直接交给 Google；插件不先做 OCR、转录、视频拆帧或 PDF 文本提取。

原生生成参数可配置，例如结构化 JSON 输出、采样、停止序列、缓存引用、安全配置、媒体分辨率、音频/图片响应设置。原生工具包括 Google Search、URL Context、Code Execution、Google Maps，以及后端支持的 File Search / Vertex 检索。具体模型、地区、权限、工具组合和请求大小限制由 Google API 判断；启用某项能力不代表所有模型均支持。

`nativeGoogle` 服务提供官方 SDK 客户端供其他服务端插件调用。Live 实时音视频、Veo 视频生成、Imagen、Embeddings、Batches、缓存与文件管理等拥有各自 API；它们可通过该程序化入口使用，不会自动变成 dsh 聊天界面里的录音、播放、批任务或视频生成按钮。两套 Google API 也并非每项功能完全对等。

dsh 单条回复使用一个候选结果，因此普通对话要求 `candidateCount: 1`，函数参数必须以完整 JSON 接收。多候选、增量函数参数以及其他无法用通用 dsh chunk 表示的行为，使用下面的原生 SDK 服务入口。

## 安装与发布

本项目是独立源码目录。构建、修改源码和 Git 提交不会切换运行实例中的插件。

```sh
npm ci
npm run check
npm run build
npm test
npm pack --pack-destination ../releases
```

在 dsh 的“插件 → 添加插件”中输入下面的**容器路径**，由用户确认安装和启用：

```text
/plugins/releases/dsh-google-native-0.1.10.tgz
```

不要使用 `link:` 将源码连接到日常 `web` profile。下一次测试应提升版本并生成新文件名。现有 HMR 可以应用用户主动安装的版本；只有界面明确提示 `restart-required` 才需要安排重启。dsh `0.2.1-rc.5` 普通“已安装”页面没有第三方插件通用更新按钮，不能将较新上游界面的行为视为已具备。

Git 来源发布需要固定完整 commit SHA，市场记录也应引用该 SHA。本项目提供 `prepare` 构建；安装时如果 pnpm 请求构建许可，应按具体插件提示确认。仓库不包含市场部署，也不会自动创建 GitHub 仓库、推送、发布索引或安装到运行实例。

## 配置

插件注册两个供应商路由：`google-ai-studio`、`google-vertex-native`。两套配置分别位于 `aiStudio` 和 `vertex`，可同时启用。默认模型目录包含 Gemini 2.5 Flash / Pro、Gemini 3.8 Flash 和 Gemini 4 Argon；该目录是配置候选，不是针对当前账号或地区的可用性探测。可在模型页的对应提供商卡片中获取上游模型并选择要加入的项目，也可手动填写模型 ID。保存后，在聊天模型选择器选择对应供应商和模型。

在 **设置 → 模型** 中找到 **Google AI Studio（原生）** 或 **Google Vertex AI（原生）** 提供商，点击其卡片内的 **配置 Google 提供商**，即可直接保存该提供商的连接和模型目录，并展开每个模型的高级设置。页面通过 dsh `0.2.1-rc.5` 的公开提供商卡片插槽接入；无需进入插件详情页。完整的原生生成参数和自定义工具能力声明仍可使用原生配置编辑器或下列 YAML 示例。安装的 bundle 创建 ID 为 `dsh-google-native` 的插件条目；示例以 `- id: dsh-google-native` 覆盖该条目的配置，可合并到相应 profile 的 `cordis.patch.yml`，不要覆盖整个文件，也不要改成仅有 `name` 的新条目。

配置后，模型选择器可以选择本插件公布的模型。当前宿主的 Models 页可能将未使用 API key 的 Vertex ADC 显示为缺少凭据；该就绪提示不阻止模型选择或实际调用。

| 配置示例 | 认证与用途 |
| --- | --- |
| [AI Studio](examples/ai-studio.yaml) | `GOOGLE_API_KEY` 凭据引用，启用原生搜索 |
| [Vertex ADC](examples/vertex-adc.yaml) | project/location 加 ADC 或服务账号文件 |
| [Vertex Express](examples/vertex-express.yaml) | `GOOGLE_VERTEX_API_KEY`；不设置 project/location/keyFile |
| [自定义连接地址](examples/ui-connection.yaml) | Base URL、API 版本和两种后端的配置字段；常用连接设置也可直接在 UI 编辑 |
| [逐模型高级设置](examples/model-settings.yaml) | 上下文、最大输出 tokens、输入类型、原生响应类型、思考档位与模型级超时 |
| [原生参数与思考档位](examples/native-parameters.yaml) | 模型目录、thinkingLevel、搜索和 URL Context |
| [聊天能力声明](examples/chat-capabilities.yaml) | 为自定义模型声明可显示的原生选项，或隐藏个别选项 |

AI Studio 使用 API key；标准 Vertex 使用 project/location 和 Application Default Credentials（ADC）或服务账号，Vertex Express 使用其专用 API key。`apiKeyEnv` 字段保存凭据引用名，不填真实 key；UI 的“新的 API Key”输入框负责写入凭据存储。未配置某个后端时可关闭“启用此供应商”。服务账号使用 `keyFile`；省略时由 Google SDK 读取 ADC。

密钥应通过 dsh 凭据管理或运行容器的环境变量提供。服务账号文件路径必须是**容器可读路径**；例如宿主机 `data/google/service-account.json` 在现有持久挂载下对应 `/home/node/google/service-account.json`。路径示例不表示已创建该文件或配置凭据。不要将密钥、服务账号 JSON、部署 `.env` 或 dsh 数据加入插件仓库或版本包。

Docker 进程只能读取传入容器的环境变量。宿主机 shell 中 `export` 的变量不会自动出现在已经运行的容器中。使用现有挂载中的服务账号文件或界面凭据时，不必为了开发插件修改部署。

### 在 UI 配置连接和模型

在 **设置 → 模型** 中展开对应提供商卡片内的 **配置 Google 提供商** 后，按下面的流程操作：

1. 当前卡片只配置对应的 **AI Studio** 或 **Vertex AI**。两套连接分别保存；Vertex 可以选择 ADC 或 Express API Key。ADC 填写项目、区域，以及可选的容器内服务账号文件路径。
2. 填写 **Base URL**、可选的 **API 版本**及 **模型请求超时（秒）**。Base URL 留空使用 Google 官方地址。超时填 `600` 表示一次聊天模型请求最多等待 10 分钟，填 `0` 表示不额外设置本地总时限。API Key 模式可以填写已有的凭据引用，或在“新的 API Key”中输入新密钥；该输入框不会回显已保存的密钥，留空表示保留现有凭据。
3. 点击 **获取上游模型**。请求使用当前页面尚未保存的连接地址、认证方式和新输入的密钥；它只读取模型元数据，不保存连接、不自动加入模型，也不进行模型生成。明确返回的容量和输入/输出类型会带入高级设置，缺失的字段可手动填写。
4. 筛选模型后勾选要加入聊天选择器的项目，可使用“全选当前结果”或“取消当前结果”。如果上游未提供原生列表、权限不足或列表为空，可在下方手动添加模型 ID。展开某个模型的高级设置可以调整该模型的参数。
5. 点击 **保存供应商设置**，才会更新当前供应商连接、选中的模型目录及模型参数。只保留选中的模型；未勾选项目会在保存时从该目录移除。未编辑的高级参数和自定义能力声明会保留；新增的内置已知模型采用对应预设。

获取上游列表不会抹掉已经选择或保存、但未被本次列表返回的模型。收起卡片会保留当前页面内的草稿；只有保存才会应用该提供商的修改。离开模型页前请完成需要保留的保存操作。若另一张卡片或窗口先保存了配置，过期草稿会提示冲突，保留输入并读取新的修订号，由用户再次保存。

API Key 由 dsh 凭据存储保存，插件配置只记录引用名称。UI 仅显示是否已配置，不读取密钥明文。凭据存储不可写时，可以使用已有引用或 ADC；若保存结果提示“连接与模型已保存，但 API Key 保存失败”，需要重新读取配置并再次输入、保存密钥。

### 上游元数据自动填写

获取上游模型后，展开 **高级设置** 可以核对自动填写的上下文长度、最大输出 tokens 和支持的输入/输出类型。当前草稿中手动修改、明确留空或恢复默认的字段会保留；再次获取列表会更新尚未手动修改的候选字段。已保存的模型参数优先，未设置的字段可以补入上游返回值。只有点击 **保存供应商设置** 才会持久化。

插件只采用明确返回且格式有效的元数据，不按模型名称推断缺失能力。Google [AI Studio 模型资源](https://ai.google.dev/api/models#Model)公开了 `inputTokenLimit` 和 `outputTokenLimit`，其标准模型列表没有输入/输出类型数组；[Vertex PublisherModel](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1beta1/publishers.models#PublisherModel) 的标准资源也没有这些容量和模态字段。兼容网关如果返回明确的附加元数据，插件会读取对应字段；没有返回时仍需手动核对和配置。

**支持的输出类型**保存为模型的 `outputTypes` 能力声明；**请求的原生输出类型**保存为 `generationConfig.responseModalities`。获取列表不会自动要求模型同时输出全部支持的类型，已有的原生响应配置也会保留。能力声明不会提高上游权限、配额或模型本身的能力。

上游的输入与输出 token 上限可能分别计算；dsh 的本地容量声明要求最大输出 tokens 小于上下文长度。返回的数值会原样展示，如果不符合这个关系，页面会要求先核对和调整，不会自动扩大窗口或改写上游上限。

### 每个模型的高级设置

在模型列表内展开对应模型后，可编辑以下项目。修改只应用于当前供应商和当前模型；保存后新请求采用新配置，已准备或执行中的请求保持原配置。

| 项目 | 实际作用 |
| --- | --- |
| 显示名称 | 修改聊天模型选择器中的名称，模型 ID 保持不变 |
| 上下文长度 | 写入 `models[].contextWindow`，供宿主计量、压缩和请求准备使用；不会扩大上游真实窗口 |
| 最大输出 tokens | 写入 `models[].maxTokens`，作为未显式指定输出上限时的默认请求值；仍受真实模型上限约束 |
| 输入类型 | 写入 `models[].inputTypes`；可限制图片、音频、视频、PDF。聊天所需文本保留。默认不增加输入限制 |
| 支持的输出类型 | 写入 `models[].outputTypes`，记录模型支持的文本、图片、音频输出；可由上游明确返回的元数据填入 |
| 原生输出类型 | 写入 `models[].generationConfig.responseModalities`；TEXT、IMAGE、AUDIO 会成为实际 Google 请求参数 |
| 思考档位与默认档位 | 写入 `models[].reasoning`、`defaultReasoning`，配置 token 预算或 level，并在聊天模型选择器中提供相应档位 |
| 思考摘要 | 写入模型的 `thinkingConfig.includeThoughts`；每个思考档位可单独覆盖摘要设置。控制是否请求 Google 提供的摘要，不等同于启用或关闭思考 |
| 模型请求超时 | 写入模型的 `generationConfig.httpOptions.timeout`；留空沿用供应商值，`0` 表示此模型不额外设置本地总时限 |

容量字段留空表示清除该模型自己的声明。输入、输出及思考设置的“默认”恢复相应字段的继承或上游默认行为，不会自动探测模型能力。默认输出模式通常由上游模型决定；选择图片或音频输出仍要求当前模型与 API 支持该类型和组合。服务端专用的 Imagen、Veo 等独立 API 不会因此变成普通聊天的生成模式。

思考使用 Google 原生的预算或 level 格式，不套用其他供应商的 `thinkingFormat`。预算的 `-1` 表示动态预算，`0` 只在模型支持时关闭思考；level 使用模型支持的值。仅移除思考档位声明表示不向宿主公布可选档位，不保证关闭模型的默认思考。改变或删除档位后，旧会话保存的档位可能不再有效，此时需在聊天模型选择器重新选择。

界面只读取并修改这些明确的参数，不返回完整 `generationConfig`，因此私有请求头和其他未显示的原生配置不会随表单回传。旧客户端省略逐模型高级设置时，保留现有模型配置。上下文、输出 tokens 及时间参数会在保存前校验。

### 模型请求超时

模型页的 **模型请求超时（秒）** 控制该提供商聊天生成请求的本地总时限，包括等待响应和读取生成流。保存后对新请求生效，正在执行的请求继续使用启动时的设置。AI Studio 和 Vertex 独立配置。允许 `0` 至 `2147483.647` 秒，最多三位小数；输入空值、负数或超过上限的值时不能保存或获取模型。

此项保存为供应商级 `generationConfig.httpOptions.timeout`，配置文件中单位为毫秒。例如：

```yaml
- id: dsh-google-native
  config:
    aiStudio:
      generationConfig:
        httpOptions:
          timeout: 600000  # UI 显示 600 秒
```

已有的高级配置保持兼容。模型自身的 `models[].generationConfig.httpOptions.timeout` 优先于供应商默认值；如果配置过模型级超时，应同时核对该覆盖值。保存连接不会删除其他原生生成参数或模型级参数。未设置超时时，页面显示 `0`；旧客户端省略该字段时不会改写已有值。

传输层通过每次请求的 dispatcher 关闭 Undici 默认的响应头等待及数据空闲计时，不修改进程的全局 dispatcher，也保留原有代理和连接选择。配置的 SDK 总时限与手动取消仍然有效。`0` 只关闭这个本地总时限，Google、中转服务及反向代理仍可中止请求。

获取上游模型仍有独立的 **30 秒**限时，上传后等待文件处理仍由 `files.processingTimeoutMs` 控制，默认 **5 分钟**；它们不受此生成超时选项影响。请求超时会报告 `TIMEOUT`，用户取消报告 `ABORTED`。

### Base URL 的格式

Base URL 应指向 **Google 原生 Gemini / Vertex API**，不能使用仅提供 OpenAI Chat Completions 协议的地址。地址可以带网关路径前缀，也可带 `v1beta`、`v1` 等版本后缀；插件会分离这个后缀，避免重复拼接版本路径。明确填写的“API 版本”优先于地址中的后缀。

| Base URL | API 版本 | AI Studio 模型列表请求示例 |
| --- | --- | --- |
| 留空 | 留空 | Google 官方默认模型列表 |
| `https://gateway.example/google` | `v1beta` | `https://gateway.example/google/v1beta/models` |
| `https://gateway.example/google/v1beta` | 留空 | `https://gateway.example/google/v1beta/models` |
| `https://gateway.example/google/v1beta` | `v1` | `https://gateway.example/google/v1/models` |

上述地址是格式示例，不是已配置的服务。Vertex 使用对应的原生 publisher 模型列表和生成路径；Base URL、API 版本与认证配置同时用于模型发现和实际聊天请求。不要把完整的 `:generateContent`、`:streamGenerateContent` 操作地址填作 Base URL。

模型列表反映上游返回的目录，不保证每个模型都已对当前账号、区域或计费项目开放。AI Studio 返回动作元数据时，列表会排除只支持嵌入或实时 API 的模型；Vertex 及部分网关不返回这些字段，插件保留能力未知的候选供选择，不推断上下文、输出上限或原生工具支持。模型目录过大、分页异常或读取超时会明确结束获取，可以改用手动 ID。模型是否支持某项原生聊天功能，仍由精确能力声明和实际 API 决定。

### 聊天中的原生能力选项

安装并启用本版本后，选择本插件的 Google 供应商和支持的模型，文件上传按钮旁会出现“原生能力”。切换到其他供应商或未声明这些能力的模型时，菜单立即隐藏；同一菜单中也只显示当前模型支持的选项。

- **新上传文件使用模型原生能力**：打开时，新发送的 PDF、音频、视频等附件以 Google 原生文件输入发送，同时保留本地只读路径提示；关闭时，按 dsh 通常的文件路径方式交给模型及本地工具处理。此前已经发送的附件保留当时记录的方式，不会因修改开关而重新上传或改为另一种输入。
- **Google 搜索、URL 上下文、代码执行、Google 地图**：按需启用 Google 在服务端执行的工具。开关关闭时会移除该工具，即使供应商、模型参数或 `httpOptions.extraBody.tools` 中配置过它。

这些选项按**会话、供应商与模型**分别保存。刷新页面会读取已保存的选择；切换回原模型会恢复该模型的设置。发送消息时会记录选项快照，所以排队消息、后续工具调用和会话回放使用对应消息的选择，不会被之后的开关修改。保存选项时暂时禁止发送，收到服务端确认后才恢复；正在回复或已有提交尚未完成时，选项不可修改。

原生文件输入默认打开，延续 `0.1.0` 的行为。各原生工具初次使用时遵循供应商及模型的已有配置，不会默认全部启用。选择会覆盖对应工具的静态配置；其他原生生成参数继续生效。

内置模型采用经过核对的能力表。对自定义模型 ID，默认不显示原生选项；在 `models[].capabilities` 明确声明后显示相应选项。声明包括 `nativeFiles`、`search`、`urlContext`、`codeExecution`、`maps`，并可用 `false` 隐藏某一项。逐模型输入类型包含音频、视频或 PDF 时，也会显示原生文件选项；其他原生工具仍需各自的能力声明。参考[聊天能力示例](examples/chat-capabilities.yaml)。这些声明不提高 Google 模型本身的能力、权限或配额。

`functionCallingWithNativeTools` 表示该连接是否支持在一次请求中同时使用上述原生工具和 dsh 本地函数工具，它本身不是聊天复选框。未声明支持混用的连接在启用原生工具时，会省略同一请求的本地函数声明，并在菜单中提示。AI Studio 的已核对新模型可按能力表混用；Vertex 和其他模型采用保守默认值。需要覆盖时，应先确认具体模型及连接支持该组合。

聊天菜单只处理文件输入与这些常用原生工具。Live 实时音视频等独立 API 仍通过下文的原生 SDK 服务使用。

### 让模型自己读取工作区原生文件

本插件提供 `google_native_attach_file`，参数为 `{ "path": "reports/example.pdf" }`。支持原生文件输入的本插件 Google 模型会看到这个工具；明确声明支持图片输入的模型也可用它读取截图。切换到其他供应商或未声明支持的模型时，工具会从模型可见的声明和 PTC SDK 中移除，直接猜测工具名也不能读取文件。

可以这样要求模型：

> 用 google_native_attach_file 将 reports/example.pdf 加入当前会话，然后由你直接读取文件并回答问题。

工具通过 dsh 文件系统读取原始字节，保存为不可变附件。普通函数调用会在工具完成后把附件作为原生用户媒体传给同一主模型；PTC 模式下，可以在 `run_code` 中调用 `tools.google_native_attach_file({path: ...})`，外层程序成功完成后，原始附件会进入同一会话的下一步上下文。PDF、图片、音频、视频等均走原有 Google 原生 `inlineData` / `fileData` 通道。图片保留原始文件字节，不调用图片归一化；工具不会进行 OCR、转录、视频拆帧、文档解析、摘要或额外模型调用。

普通调用与 PTC 附加的原生文件均保留 dsh 给出的附件副本只读路径，供本地工具读取或复制。该路径指向保存后的附件副本，原始工作区文件仍按原位置保留；需要修改附件时，先复制到工作区的可写路径。

相对路径以当前会话工作目录解析，文件必须位于会话原始工作区内；没有原始目录时使用当前工作目录。目录、特殊文件、外部 URL 以及指向工作区外的符号链接均不能上传。文件在读取时改变、超出本后端文件大小限制，或模型未声明对应输入类型时，工具会报告错误。一次调用附加一个完整文件；需要拆分时，应先生成格式有效的独立文件，再分别附加。

此工具是模型明确选择的原生附件操作，独立于“新上传文件使用模型原生能力”这个用户上传开关。现有用户附件仍保持原来的处理方式。文件与产生它的会话、供应商、模型和工具调用绑定，并保存来源记录；切换到其他模型后需要重新调用。取消、工具失败、策略阻止，以及策略移除最终附件的情况均不会把该文件作为原生输入发送。PTC 外层失败或取消也不会发布待附加文件。

上传限制沿用供应商 `files` 配置和逐模型输入类型。标准 Vertex 的本地附件默认最高 16 MiB，AI Studio 大文件仍由下一次请求中的 Files API 上传；工具成功表示本地原始附件已准备好，实际 Google 上传或模型请求仍可能失败。工具需要正常挂载 dsh 的 tools、fs、workingDirectory、systemPrompt 和 sessionQuery 服务，遵循现有工具执行策略。原生搜索等工具与本地函数工具不能混用的模型，仍受前述 Google 工具组合限制。

### 思考

思考摘要通过 `thinkingConfig.includeThoughts` 控制，是 Google 提供的摘要。Gemini 2.5 使用 `thinkingBudget`，`-1` 表示动态预算；支持关闭的模型使用 `0`。Gemini 3 及以后使用 `thinkingLevel`。各模型允许的档位不同，例如 2.5 Pro 不支持关闭思考；`minimal` 也不等于保证完全关闭。不要同时配置预算和档位。

Gemini 3.8 Flash 和 Gemini 4 Argon 的预设档位均为 `LOW` / `MEDIUM` / `HIGH`，默认 `MEDIUM`，不提供 `MINIMAL` 或预算模式。Google 文档已列出这两个模型的 AI Studio 和 Vertex 原生 API；实际权限与地区仍由相应账号决定。Gemini 4 Argon 的长输出 continuation 等专用流程，可通过原生 SDK 服务使用；普通聊天保持一次生成流的行为。

插件保留 Google 返回的 `thoughtSignature` 及原始 Part 位置，以支持工具调用后的继续推理。签名是不可解释的协议数据，不是可展示的思考文本。不要手工删除、合并或替换原生回放信息。

### 原生参数与工具

`generationConfig` 使用官方 JavaScript SDK 的 `GenerateContentConfig` 字段名，例如 `thinkingConfig`、`responseMimeType`、`responseJsonSchema`、`mediaResolution`、`cachedContent`、`safetySettings` 和 `tools`。这与 REST 请求中把采样等参数嵌套在 `generationConfig` 的层级不同。

原生搜索工具的 SDK 形态如下：

```yaml
generationConfig:
  tools:
    - googleSearch: {}
    - urlContext: {}
```

`httpOptions.extraBody` 使用对应 Google **REST 后端**的请求体形态，供 SDK 尚未建模的字段使用；它不是放置任意 SDK 配置的容器。其内容可能覆盖构造出的请求，需要了解具体 API 语义。逐模型界面明确配置的输出类型、输出 tokens 和思考字段会优先于对应的原始请求体别名；其他原生字段继续保留。Google 仍会校验未知或不支持的字段，不应依靠它绕过模型限制。

参数优先级为：本次 dsh 调用的采样、输出上限、停止序列和思考选项 > `models[].generationConfig` > 供应商级 `generationConfig`。模型级参数与供应商参数按字段覆盖，`thinkingConfig`、`httpOptions` 单独合并；不要假设所有任意嵌套 JSON 都会递归合并。dsh 的函数声明会追加到原生工具列表中。请求取消信号和必要归因头由插件设置。

常用工具：

| SDK 工具字段 | 用途 / 范围 |
| --- | --- |
| `googleSearch` | Google 原生搜索与 grounding |
| `urlContext` | 读取指定公开 URL；不代替音视频文件输入 |
| `codeExecution` | Google 沙箱代码执行 |
| `googleMaps` | 地图 grounding；依模型、地区与语言支持 |
| `fileSearch` | AI Studio 的 File Search；需先准备相应存储 |
| `retrieval`、`enterpriseWebSearch` | Vertex 的检索能力；需对应资源和权限 |

这些工具由 Google 在服务端运行，与 dsh 自身的函数工具不同。不要将所有工具默认一并开启。Google 对不同模型的工具组合支持会变化，API 返回的错误应作为实际限制判断依据。

### 搜索来源与显示

Google 原生搜索返回 `groundingMetadata`，包括来源、支持片段、搜索词，以及可能的 `searchEntryPoint.renderedContent`。这些字段不能被当作普通模型文字随意丢弃。Google 的搜索建议与归因展示要求需要由使用原生服务的前端正确处理；dsh 通用聊天界面没有因此自动增加一个完整 Google 搜索建议组件。不要把保留原始 metadata 等同于已经完成所有专用 UI 展示。

### 文件与多模态限制

在普通聊天界面上传附件即可，插件在请求构建期间读取原有持久附件引用，恢复原始文件输入，不依赖聊天文本中的文件路径或特殊标记。文件会以 `inlineData` 或 `fileData` 发送。AI Studio 默认超过 8 MiB 时使用 Files API，并等待文件处理到 `ACTIVE`；`FAILED`、等待超时或取消会明确结束请求。上传句柄缓存仅在其有效期内复用；Google 临时文件按远端有效期过期，插件不主动删除远端文件。

原生模式仍沿用 dsh 的本地附件存储，不会自动把上传文件复制进项目目录。对于普通文件附件以及工具附加的原始图片等文件，模型请求同时保留 dsh 生成的文件名、大小、本地只读路径及“先复制到可写位置再修改”的提示，因此同一模型可以直接理解原生内容，也可以让本地工具读取或复制附件。路径使用 dsh 对当前执行环境的映射；若环境没有提供可读路径，会保留对应的不可访问提示，并说明该限制只影响本地工具，模型仍可读取原生内容。插件不编造宿主机路径，不改变文件原始字节，不增加解析器或额外模型请求。

插件对 Vertex 本地附件默认采用最高 16 MiB 的保守 inline 限制，更大文件需要通过程序化原生 SDK 请求传入具有读取权限的 Cloud Storage `gs://` URI。通用聊天附件不会自动上传到用户的 Cloud Storage。AI Studio Files API 的句柄不能直接视为 Vertex 通用文件句柄。

`files` 可调整 `inlineThresholdBytes`、`inlineMaxBytes`、`maxFileBytes`、`pollIntervalMs`、`processingTimeoutMs`。这些设置控制插件传输策略；提高插件上限不会提高 Google 或 dsh 本身的限制。默认单文件上限为 300 MiB。

当前 Google GenerateContent 文件指南给出的典型限制为：inline 请求总 payload 100 MB、PDF 50 MB / 1000 页、Files API 单文件 2 GB（保存 48 小时）、外部 HTTPS 文件每项 15 MB。限制随后端、模型和输入方式变化，dsh 上传限制也可能更低。PDF/音视频在原生 API 可用并不保证某个模型接受所有 MIME 类型或大小。

原生响应中的图片保存为图片附件，其他媒体保存为文件附件。Gemini 流式 `audio/L16;codec=pcm;rate=24000` 是 16 位小端 PCM，插件将其加上 WAV 文件头，生成可下载播放的 `.wav`；原始 PCM Part 仍保留用于协议回放。常见 WAV、MP3、OGG、FLAC、AAC、MP4、WebM、PDF、JSON 和文本保留原始数据及相应扩展名。未知格式保存为 `.bin`，无法保证通用界面预览或跨模型重新输入；专门的播放器及 Live 实时音频界面需要使用原生服务另行实现。

## 原生 SDK 服务

服务端插件声明 `inject: ['nativeGoogle']` 后可取得当前供应商配置和认证对应的 SDK 客户端。该对象是可信服务端代码使用的完整 SDK，不应直接暴露给浏览器或不可信请求。

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from 'dsh-google-native'

export const inject = ['nativeGoogle']

export function apply(ctx: Context) {
  // 在插件的实际请求处理函数中调用；不要在启动时自动产生计费请求。
  async function summarizeCloudPdf(uri: string, signal: AbortSignal) {
    return ctx.nativeGoogle.generate('google-vertex-native', {
      model: 'gemini-2.5-flash',
      contents: [{
        role: 'user',
        parts: [
          { text: '总结此 PDF 的主要结论。' },
          { fileData: { fileUri: uri, mimeType: 'application/pdf' } },
        ],
      }],
      config: { abortSignal: signal },
    })
  }

  // 将 summarizeCloudPdf 注册到自己的工具或应用接口。
}
```

`ctx.nativeGoogle.generate(provider, parameters)` 与 `stream(provider, parameters)` 分别直通官方 `models.generateContent` / `generateContentStream`，保留原始返回值。`await ctx.nativeGoogle.client(provider)` 可调用完整 SDK，例如 `client.live`、`client.batches`、`client.models.embedContent`、`generateImages`、`generateVideos`、`client.files` 与 `client.caches`。调用方负责各 API 的请求参数、取消、操作轮询、权限及 UI。

**原生服务不会自动合并聊天用的 `generationConfig`、`nativeTools`、模型思考档位或 dsh 会话历史。** 它复用供应商连接与认证，调用参数由调用方完整提供；这样不会改变原生 API 语义。这些直接调用也不会自动写入 dsh 聊天记录，调用方应按自己的功能明确记录可重建的输入与结果。

## 验证与使用边界

本地检查、构建和测试验证适配、请求与流式回放行为；没有使用用户的 Google 凭据进行真实计费请求。正式使用前，在界面安装准备好的版本，再用自己的账号分别验证文本、思考、原生文件和搜索。账号权限、地区可用性、实际配额及远端响应仍需真实环境确认。

## 官方参考

- [Google Gen AI JavaScript SDK](https://github.com/googleapis/js-genai)
- [Gemini 模型列表与动作元数据](https://ai.google.dev/api/models)
- [GenerateContent 思考配置](https://ai.google.dev/gemini-api/docs/generate-content/thinking)
- [Gemini 3.8 Flash 模型](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- [Gemini 4 Argon 模型](https://ai.google.dev/gemini-api/docs/models/gemini-4-argon)
- [Vertex Gemini 3.8 Flash](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/3-8-flash)
- [Vertex Gemini 4 Argon](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/4-argon)
- [思考签名与函数调用回放](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)
- [原生 Google Search](https://ai.google.dev/gemini-api/docs/generate-content/google-search)
- [原生文件输入方式](https://ai.google.dev/gemini-api/docs/generate-content/file-input-methods)
- [语音生成与 PCM 格式](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation)
- [Vertex AI 文档](https://cloud.google.com/vertex-ai/generative-ai/docs/overview)
