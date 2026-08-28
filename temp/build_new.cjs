const fs = require('fs');

const CAT = 'aws-genai-developer-pro';

// Chinese content keyed by question number (26-50)
const CN = {
  26: {
    subtopic: '语义检索（Titan Embeddings + Aurora Serverless pgvector）',
    tags: ['aws', 'bedrock', 'titan-embeddings', 'aurora', 'pgvector', 'semantic-search'],
    difficulty: 'medium',
    question: '某大学将档案、学术期刊与手稿数字化后存入 AWS Lake Formation 数据湖。大学要构建方案让用户用文本查询检索数字文件，需返回与查询语义相似的期刊摘要；用户既要按文本、也要按期刊摘要的元数据检索；元数据不含关键词；需按文本相似度匹配相似摘要；数据湖文件少于 100 万。哪种方案以最低运维开销满足？（单选）',
    options: [
      '用 Amazon Titan Embeddings（Bedrock）为数字文件生成向量，存入 Amazon OpenSearch Service 的 Neural Plugin。',
      '用 Amazon Comprehend 从数字文件抽取主题，将主题与文件元数据存入 Amazon Aurora PostgreSQL，按 Aurora 库中的摘要元数据查询。',
      '在 Amazon SageMaker AI 部署 sentence-transformer 模型生成向量，存入带 pgvector 扩展的 Amazon Aurora PostgreSQL。',
      '用 Amazon Titan Embeddings（Bedrock）为数字文件生成向量，存入带 pgvector 扩展的 Amazon Aurora PostgreSQL Serverless 数据库。'
    ],
    explanation: 'D 正确：Titan Embeddings 托管生成向量，Aurora Serverless + pgvector 是无服务器向量库，免运维且满足语义+元数据检索；相比自管 SageMaker 模型（C）或 OpenSearch 集群（A）运维最省，且 <100 万文件规模合适。B 用 Comprehend 主题而非向量，不支持语义相似度。',
    open: '正确答案：D。\n- Titan Embeddings 托管生成向量 + Aurora Serverless pgvector 无服务器向量库，运维最省。\n- A 需管 OpenSearch 集群；C 需自管 SageMaker 嵌入模型；B 不支持语义检索。'
  },
  27: {
    subtopic: '混合部署（Bedrock 预置吞吐 + SageMaker Neo 边缘）',
    tags: ['aws', 'bedrock', 'provisioned-throughput', 'sagemaker', 'neo', 'hybrid', 'data-residency'],
    difficulty: 'hard',
    question: '某公司用基础模型（FM）支撑多个 AI 工作负载：部分 FM 需按需实时调用，部分需高吞吐批处理；方案须支持混合部署模式，并跨云与本地基础设施运行以满足数据驻留与合规。哪两项组合满足？（请选择 2 个）',
    options: [
      '用 AWS Lambda 编排低延迟 FM 推理，调用托管在 Amazon SageMaker AI 异步端点的 FM。',
      '在 Amazon Bedrock 中配置预置吞吐（provisioned throughput），保证高吞吐量工作负载性能一致。',
      '将 FM 部署到支持边缘部署的 Amazon SageMaker AI 端点（用 SageMaker Neo），并用 AWS Lambda 编排以支持混合部署。',
      '用带自动伸缩的 Amazon Bedrock 应对不可预测的流量高峰。',
      '用 Amazon SageMaker JumpStart 托管并调用 FM。'
    ],
    explanation: 'B、C 正确：Bedrock 预置吞吐为高频批处理提供一致性能；SageMaker 端点 + Neo 边缘编译 + Lambda 编排实现云+本地混合部署以满足数据驻留。A 异步端点不满足实时低延迟；D 仅自动伸缩不涉本地/混合；E JumpStart 不解决混合与驻留。',
    open: '正确答案：B、C。\n- Bedrock 预置吞吐保高吞吐稳定；SageMaker 端点+Neo 边缘部署+Lambda 编排实现混合（云+本地）部署满足驻留。\n- A 异步端点非实时；D/E 无混合/本地。'
  },
  28: {
    subtopic: '动态模型路由（AppConfig + Lambda 业务逻辑）',
    tags: ['aws', 'bedrock', 'appconfig', 'lambda', 'api-gateway', 'routing', 'a-b-testing'],
    difficulty: 'hard',
    question: '某电商全球推荐系统须按法规、成本、性能在多个 Bedrock FM 间切换；须按专有业务逻辑强制控制（动态成本阈值、区域合规规则、跨 FM 实时 A/B）；切换 FM 不得重新部署代码；按用户层级/交易额/监管区/每小时变化的实时成本指标路由，且须即时传播到数千并发请求。哪种方案满足？（单选）',
    options: [
      '部署 AWS Lambda，用环境变量存储路由规则与 Bedrock FM ID；业务变化时在 Lambda 控制台更新环境变量；用 API Gateway REST 读取请求参数做路由。',
      '用 API Gateway REST 请求转换模板按请求属性实现路由，Bedrock FM 端点存为阶段变量，切换模型时更新变量。',
      '配置 AWS Lambda 在每个请求时从 AWS AppConfig Agent 拉取路由配置，在 Lambda 内运行业务逻辑为每个请求选 FM，通过单一 API Gateway REST 端点暴露。',
      '用 API Gateway REST 的 Lambda authorizer 评估存于 AppConfig 的路由规则，返回基于业务逻辑的授权上下文，将请求路由到各 FM 专属 Lambda。'
    ],
    explanation: 'C 正确：AppConfig 支持动态配置（成本阈值/合规规则）按请求实时拉取，Lambda 执行业务逻辑选模型，单 API GW 暴露，无需改代码即可切换，满足数千并发即时传播。A 依赖环境变量需重新部署且无法实时传播；B 映射模板难以表达小时级复杂指标；D 用 authorizer 做路由语义不符。',
    open: '正确答案：C。\n- AppConfig 按请求实时拉取动态配置 + Lambda 业务逻辑选模型 + 单 API GW，无需部署即可切换。\n- A 环境变量需重新部署；B 模板难表达复杂指标；D authorizer 非路由用途。'
  },
  29: {
    subtopic: '近实时幻觉与成本监控（调用日志 + Guardrails 接地 + CloudWatch 异常检测）',
    tags: ['aws', 'bedrock', 'guardrails', 'contextual-grounding', 'cloudwatch', 'anomaly-detection', 'monitoring'],
    difficulty: 'medium',
    question: '某医疗公司用 Bedrock 生成临床文档摘要，响应质量不稳定且偶发事实幻觉，月度成本比预期高 40%。需近实时监控方案检测幻觉、识别异常 token 消耗、对成本异常预警，且自定义开发最少。哪种方案满足？（单选）',
    options: [
      '配置 CloudWatch 告警监控 InputTokenCount/OutputTokenCount 检测异常，调用日志存 S3，用 Glue+Athena 识别潜在幻觉。',
      '运行 Bedrock 评估作业（LLM 评判）检测幻觉，用 CloudWatch 跟踪 token 用量，Lambda 处理指标并通知。',
      '配置 Bedrock 将调用日志存 S3 并开启文本输出日志；启用 Guardrails 上下文接地检查检测幻觉；对 token 用量指标建 CloudWatch 异常检测告警。',
      '用 CloudTrail 记录所有 Bedrock API 调用，QuickSight 自建仪表盘可视化 token，用 SageMaker Model Monitor 检测质量漂移。'
    ],
    explanation: 'C 正确：调用日志落地 S3 并开文本输出日志，Guardrails 上下文接地检查可实时检测幻觉，CloudWatch 异常检测对 token 指标告警，自定义开发最少。A 用 Athena 非近实时；B 评估作业为离线批处理；D 需自建大量组件。',
    open: '正确答案：C。\n- Bedrock 调用日志(S3)+文本输出日志；Guardrails 上下文接地实时检幻觉；CloudWatch 异常检测监控 token。\n- A Athena 非实时；B 评估作业离线；D 自建重。'
  },
  30: {
    subtopic: '限流治理（调用日志 + 跨区域推理端点）',
    tags: ['aws', 'bedrock', 'cross-region-inference', 'throttling', 'cloudwatch', 'serverless'],
    difficulty: 'medium',
    question: '某公司用 Lambda 帮助学生全球总结笔记，调用 Bedrock 的 Claude。流量集中在各时区晚间，高峰期用户报限流错误。须在持续运行前提下解决限流，且低峰不得产生固定小时费用。哪种方案满足？（单选）',
    options: [
      '建自定义 CloudWatch 指标监控模型错误，将预置吞吐设得高于观测峰值。',
      '建自定义 CloudWatch 指标监控错误，错误超阈值时故障转移到备份区域。',
      '开启 Bedrock 调用日志，监控 Invocations/InputTokenCount/OutputTokenCount/Invocation Throttles，将流量分散到跨区域推理端点。',
      '开启 Bedrock 调用日志，监控 InvocationLatency/ClientErrors/ServerErrors，将流量分散到同一模型的多个版本。'
    ],
    explanation: 'C 正确：开启调用日志并监控限流指标，将流量分散到跨区域推理端点缓解限流；按需计费无低峰固定成本。A 预置吞吐有固定小时费违反；B 仅故障转移未治本；D 跨模型版本而非区域，未解决区域限流。',
    open: '正确答案：C。\n- 调用日志 + 监控 Throttles，跨区域推理端点分散流量，按需无低峰固定费。\n- A 预置吞吐有固定费；B 仅转移；D 跨版本非区域。'
  },
  31: {
    subtopic: '通话录音分析（EventBridge + Step Functions + Transcribe + Bedrock）',
    tags: ['aws', 'bedrock', 'step-functions', 'eventbridge', 'transcribe', 's3', 'sentiment'],
    difficulty: 'medium',
    question: '某金融公司用 Bedrock FM 分析呼叫中心录音：通话结束存为 S3 的 MP3，须在新建文件后尽快生成结构化摘要与情感分析；录音平均 20MB。哪两项组合满足？（请选择 2 个）',
    options: [
      '用 Step Functions 编排：调 Transcribe 转写、校验完成、再调 Lambda 用 Bedrock 生成结构化分析。',
      '用 Step Functions 编排：调 Transcribe 转写、校验完成、直接调 Bedrock 生成 JSON 格式摘要与情感分析。',
      '用 Step Functions 编排：调 Transcribe 转写、校验完成、调 Lambda 构造 prompt 再调 Bedrock 生成结构化分析。',
      '配置源 S3 桶向 EventBridge 发事件，建 EventBridge 规则在桶中新建对象时触发 Step Functions 工作流。',
      '配置源 S3 桶在新建对象时直接向 Step Functions 工作流发通知。'
    ],
    explanation: 'B、D 正确：EventBridge 在 S3 新建对象时触发 Step Functions；工作流用 Transcribe 转写、校验后直接调 Bedrock 生成 JSON 结构化摘要与情感分析，无需额外 Lambda。A/C 引入多余 Lambda；E S3 不能直接触发 Step Functions（需 EventBridge/SQS）。',
    open: '正确答案：B、D。\n- EventBridge 在 S3 新建对象时触发 Step Functions；Transcribe 转写后直接调 Bedrock 出 JSON 结构化结果。\n- A/C 多余 Lambda；E S3 不能直接触发 Step Functions。'
  },
  32: {
    subtopic: 'MCP 服务器对外暴露（API Gateway HTTP + Cognito OAuth）',
    tags: ['aws', 'mcp', 'api-gateway', 'cognito', 'oauth', 'lambda', 'security'],
    difficulty: 'medium',
    question: '某公司把本地无状态 MCP 服务器部署为 Lambda 以支撑生产应用；须能被内部应用与授权第三方伙伴访问，并强制严格认证授权。哪种附加步骤以最低运维开销满足？（单选）',
    options: [
      '用 Lambda Invoke API 自建传输，IAM 认证并授权 InvokeFunction 权限。',
      '经 API Gateway REST 暴露 Lambda，用 API key 认证，应用改用标准 HTTP 而非 MCP 协议。',
      '建 Lambda Function URL 并启用自定义 Streamable HTTP 传输 + SigV4，IAM 认证并授权 InvokeFunctionUrl。',
      '经 API Gateway HTTP API 暴露 Lambda（Streamable HTTP 传输），用 Cognito 实现 OAuth 认证，API Gateway 校验 OAuth 令牌。'
    ],
    explanation: 'D 正确：API Gateway HTTP API 以 Streamable HTTP 暴露 MCP Lambda，Cognito OAuth 2.0 校验令牌，兼顾内部与第三方授权且运维最省。A 自定义传输复杂；B API key 鉴权弱；C SigV4 对第三方不友好。',
    open: '正确答案：D。\n- HTTP API + Streamable HTTP 暴露 MCP Lambda，Cognito OAuth 校验令牌，内部与第三方兼顾、运维最省。\n- A 自定义传输复杂；B API key 弱；C SigV4 第三方不友好。'
  },
  33: {
    subtopic: '推荐落地产品目录（Bedrock 知识库 + RAG）',
    tags: ['aws', 'bedrock', 'knowledge-base', 'rag', 'performance-config', 'recommendation'],
    difficulty: 'medium',
    question: '某电商用 Bedrock+Claude 做商品推荐，用户反映部分推荐商品网站无售或不相关，且部分推荐生成慢；确认推荐了不在商品目录中的商品。须解决该问题。哪种方案满足？（单选）',
    options: [
      '提高 Bedrock Guardrails 接地程度，启用 Automated Reasoning 检查，设预置吞吐。',
      '用提示工程将模型响应限制在相关商品，用 InvokeModelWithResponseStream 流式降低感知延迟。',
      '建 Bedrock 知识库，实施 RAG，将 PerformanceConfigLatency 设为 optimized。',
      '将商品目录存 OpenSearch，校验模型推荐是否命中目录，用 DynamoDB 做响应缓存。'
    ],
    explanation: 'C 正确：建 Bedrock 知识库并采用 RAG，使推荐基于真实商品目录（不再推荐目录外商品），PerformanceConfigLatency=optimized 降低延迟。A 不解决目录外；B 仅提示工程无法保证落地目录；D 需自建检索管线。',
    open: '正确答案：C。\n- 知识库+RAG 使推荐基于真实目录（不再推荐目录外），PerformanceConfigLatency=optimized 降延迟。\n- A 不解决目录外；B 提示工程不保证；D 自建重。'
  },
  34: {
    subtopic: '数据驻留与分类（S3 Object Lock + Macie + CloudTrail）',
    tags: ['aws', 'bedrock', 's3-object-lock', 'macie', 'cloudtrail', 'data-residency', 'compliance'],
    difficulty: 'hard',
    question: '某公司用 Bedrock 分析数据中的模式与关系，每日跨欧洲/北美/亚洲区域处理数百万新数据点后存 S3；须符合当地数据保护与存储法规，数据驻留与处理须在同一大洲，并保留决策审计轨迹与数据分类能力。哪种方案满足？（单选）',
    options: [
      '在每个区域部署应用并配本地 IAM 策略，用 Bedrock 跨区域推理分发负载，CloudWatch 记录决策，手动跟踪各区域合规认证。',
      '用 AWS Organizations 的 SCP 管理区域权限，CloudTrail 不可变日志审计决策，导入自定义模型到 Bedrock 并部署到各区域。',
      '用 S3 Object Lock + 区域级桶策略；按地理来源在区域内预处理后再送 Bedrock；用 Macie 分类数据；CloudTrail 不可变日志审计决策。',
      '为每个区域建独立账号与各自合规框架，用 SageMaker AI 自定义监控跟踪驻留合规，向各监管机构手工报告。'
    ],
    explanation: 'C 正确：按地理来源在对应区域预处理后再送 Bedrock，S3 Object Lock 与区域桶策略保障驻留，Macie 做数据分类，CloudTrail 不可变日志留审计。A 跨区域推理破坏驻留；B/D 运维更重且部分手动。',
    open: '正确答案：C。\n- 区域内预处理 + S3 Object Lock/区域桶策略保障驻留，Macie 分类，CloudTrail 不可变日志审计。\n- A 跨区域推理破坏驻留；B/D 运维重。'
  },
  35: {
    subtopic: '多轮对话与澄清（Step Functions 标准 + Wait for Callback + DynamoDB）',
    tags: ['aws', 'bedrock', 'step-functions', 'dynamodb', 'conversation', 'clarification'],
    difficulty: 'medium',
    question: '某客服应用用 Bedrock+Claude 推荐商品，须跨多次交互保留对话上下文、对歧义查询跑澄清工作流、加密留存每轮对话用于个性化，并支撑数千并发且响应快。哪种方案满足？（单选）',
    options: [
      '用 Step Functions Express 工作流编排对话，Lambda 跑澄清逻辑，对话历史存 RDS 以 session ID 为主键。',
      '用 Step Functions 标准工作流编排澄清工作流，含 Wait for a Callback 模式管理流程，对话历史存 DynamoDB 按需容量并启用服务端加密。',
      '用 API Gateway REST 路由到 Lambda 更新/获取上下文，对话历史存 S3 并服务端加密，每次交互存为独立 JSON。',
      '用 Lambda 调 Bedrock 推理，SQS 队列编排澄清步骤，对话历史存 ElastiCache(Redis) 并加密。'
    ],
    explanation: 'B 正确：标准工作流支持 Wait for a Callback 等人环澄清模式，DynamoDB 按需容量支撑高并发低延迟检索，服务端加密满足加密留存。A Express 最长 5 分钟且不适合长时等待；C 用 S3 存对话历史检索慢；D SQS 增加延迟。',
    open: '正确答案：B。\n- 标准工作流 + Wait for Callback 支持澄清人环；DynamoDB 按需+加密满足高并发留存。\n- A Express 限时；C S3 检索慢；D SQS 增延迟。'
  },
  36: {
    subtopic: 'Guardrails 精细策略（denied topics + 敏感信息掩码/拦截 + 双向评估）',
    tags: ['aws', 'bedrock', 'guardrails', 'denied-topics', 'pii', 'content-filter', 'governance'],
    difficulty: 'hard',
    question: '某金融客服助手须不提供投资建议、拦截有害内容、掩码 PII、保留审计轨迹；须对用户输入与模型响应都按敏感度做内容过滤；需以最少误杀生效，且支持多种敏感内容的多种处理策略。哪种方案满足？（单选）',
    options: [
      '配单个 guardrail，所有类别内容过滤器设 high，denied topics 设投资建议并加样例短语，敏感信息过滤器对所有 PII 实体 block，应用到所有推理调用。',
      '配多个分级 guardrail：一个 high 过滤并对公开交互 block PII，一个 medium 并对内部 mask PII，多个主题 guardrail 拦截投资建议并加接地检查。',
      '配 guardrail 对有害内容过滤器设 medium；denied topics 设投资建议并配清晰定义与样例短语；敏感信息过滤器对响应 mask PII、对输入 block 金融信息；启用输入/输出双向评估并自定义拦截消息供审计。',
      '为每个用例建独立 guardrail：一个有害内容过滤、一个主题过滤投资建议、一个敏感信息过滤 block PII；用 Step Functions 顺序串联并按分类条件路由。'
    ],
    explanation: 'C 正确：有害内容过滤器设 medium 降低误杀；denied topics 配清晰定义与样例短语拦截投资建议；敏感信息过滤器对输出掩码 PII、对输入拦截金融信息；启用输入/输出双向评估并自定义拦截消息便于审计。A 全 high 误杀多；B/D 运维重。',
    open: '正确答案：C。\n- medium 过滤器降误杀；denied topics 含定义+样例拦截建议；敏感信息对输出掩码/输入拦截；输入+输出双向评估+自定义消息审计。\n- A 全 high 误杀；B/D 重。'
  },
  37: {
    subtopic: '提示治理（Bedrock Prompt Management + CloudTrail + IAM）',
    tags: ['aws', 'bedrock', 'prompt-management', 'cloudtrail', 'iam', 'versioning', 'governance'],
    difficulty: 'medium',
    question: '某媒体公司须用 Bedrock 建立 AI 内容治理：管理数百个提示模板，多团队多区域使用；须版本控制 + 含待审通知的审批工作流 + 详细审计轨迹 + 一致参数化以保质量。哪种方案满足？（单选）',
    options: [
      '用 Bedrock Studio 提示模板，CloudWatch 仪表盘展示用量，DynamoDB 存审批状态，Lambda 强制审批。',
      '用 Bedrock Prompt Management 做版本控制，配 CloudTrail 审计日志，IAM 策略控制审批权限，用变量建参数化模板。',
      '用 Step Functions 建审批工作流，提示存 S3 并用标签做版本控制，EventBridge 发通知。',
      '部署 SageMaker Canvas 存 S3 的提示模板，CloudFormation 做版本控制，AWS Config 强制审批策略。'
    ],
    explanation: 'B 正确：Bedrock Prompt Management 提供模板版本控制与审批权限（IAM），CloudTrail 记录提示活动审计，参数化模板保证一致性与质量。A/C/D 非针对提示治理的托管方案。',
    open: '正确答案：B。\n- Prompt Management 版本控制+审批(IAM)，CloudTrail 审计，参数化模板保一致性。\n- A/C/D 非提示治理托管方案。'
  },
  38: {
    subtopic: '角色化 PII 脱敏（S3 生命周期 + ApplyGuardrail + Cognito 组）',
    tags: ['aws', 'bedrock', 'knowledge-base', 'guardrails', 'cognito', 'pii', 's3-lifecycle'],
    difficulty: 'medium',
    question: '某医疗设备公司 AI 助手引用手术报告：对患者隐私 PII 仅对外科医生展示，对工程师须脱敏；只引用 3 年内报告；报告存 S3 且已建 Bedrock 知识库，用 Cognito 认证。哪种方案满足？（单选）',
    options: [
      '对 S3 启用 Macie PII 检测，S3 触发器调 Lambda 脱敏并删除过期文档、触发知识库同步。',
      '新报告上传时调 Lambda 同步 S3 与知识库；第二 Lambda 调 Comprehend 对工程师组用户脱敏；S3 生命周期删除超 3 年报告。',
      '对桶设 S3 生命周期删除超 3 年报告；每日调度 Lambda 同步桶与知识库；用户交互时按 Cognito 用户组调用 ApplyGuardrail 在响应中适当脱敏。',
      '建第二个知识库；S3 生命周期删除超 3 年报告；新报告上传调 Lambda 同步原知识库，用 Comprehend 同步前脱敏再同步到第二知识库；按 Cognito 组重定向到对应知识库。'
    ],
    explanation: 'C 正确：S3 生命周期删除超 3 年报告保证仅引用近期；每日 Lambda 同步知识库；按 Cognito 用户组调用 ApplyGuardrail 在响应侧对工程师脱敏、对外科医生保留 PII。A/B/D 或未做角色区分或架构更重。',
    open: '正确答案：C。\n- S3 生命周期删>3年；每日 Lambda 同步；按 Cognito 组 ApplyGuardrail 响应侧脱敏。\n- A/B/D 角色区分弱或架构重。'
  },
  39: {
    subtopic: '客户数据主权（Amazon Q Business 索引 + 安全 API 富化）',
    tags: ['aws', 'amazon-q-business', 'data-governance', 'cross-account', 'prompt-enrichment'],
    difficulty: 'hard',
    question: 'Example Corp 的视频生成服务被数百万企业客户使用，客户提交提示给自有 GenAI 模型；为提升相关性想用客户专属上下文（产品偏好/属性/历史）富化提示。客户有严格数据治理要求、须保留数据所有权与控制权，不需实时但语义准确度要高、检索延迟低；希望最小化集成复杂度，除非必要不在客户环境部署服务。哪种方案满足？（单选）',
    options: [
      '让每客户建含其内部数据的 Amazon Q Business 索引，并指定 Example Corp 为数据访问者，使 Example Corp 经安全 API 在运行时取回相关内容富化提示。',
      '用 MCP 为每个客户部署实时 MCP 服务器做联邦检索，提示生成时实时取数。',
      '让每客户配置 Bedrock 知识库，允许跨账号查询供 Example Corp 取结构化数据做提示增强。',
      '配置 Amazon Kendra 爬取客户数据源，跨账号共享索引供 Example Corp 查询增强。'
    ],
    explanation: 'A 正确：各客户自建 Amazon Q Business 索引并掌控数据，授予 Example Corp 数据访问者权限，运行时经安全 API 取回相关内容富化提示；客户保留所有权，Example Corp 无需在每个客户环境部署服务。B/C/D 需在客户侧部署或管理更多基础设施。',
    open: '正确答案：A。\n- 客户自建 Q Business 索引掌控数据，授予访问者权限，运行时安全 API 富化提示，Example Corp 无需客户侧部署。\n- B/C/D 需客户侧部署/管理更多设施。'
  },
  40: {
    subtopic: '持续重训练（Step Functions 标准 + SageMaker Pipelines）',
    tags: ['aws', 'sagemaker', 'step-functions', 'pipelines', 'retraining', 's3', 'lambda'],
    difficulty: 'medium',
    question: '某保险公司用既有 SageMaker 基础设施做保费预测 Web 应用，训练数据存 S3 且增长快；需持续重训练方案：员工上传新客户数据文件到 S3 时须自动重训练并将模型重部署到应用。哪种方案满足？（单选）',
    options: [
      '用 Glue 对每个上传文件跑 ETL，经 SDK 调 SageMaker 端点，实时推理在更新数据集重训练后重部署。',
      '建 Lambda + webhook 在上传时生成事件，SageMaker Pipelines 重训练后重部署，EventBridge 事件总线以 Lambda 为源、Pipelines 为目标。',
      '建 Step Functions Express 工作流用 SDK 集成取 S3 数据，Data Wrangler 导出到 Autopilot，Autopilot 重训练后重部署。',
      '建 Step Functions 标准工作流：首状态调 Lambda 响应员工上传新文件，用 SageMaker Pipelines 在更新数据集重训练后重部署，下一状态在工作流收到响应时运行该流水线。'
    ],
    explanation: 'D 正确：标准工作流在上传时由 Lambda 触发，调用 SageMaker Pipelines 重新训练并重部署模型，状态机可靠编排。A 未真正重训练流水线；B 缺状态机编排；C Express 不适合长时训练。',
    open: '正确答案：D。\n- 标准 Step Functions：Lambda 响应上传，SageMaker Pipelines 重训练+重部署，状态机编排。\n- A 未重训练；B 缺编排；C Express 限时不适用。'
  },
  41: {
    subtopic: '负责任 AI 治理（Agents+KB 接地 + Guardrails + OpenSearch/QuickSight）',
    tags: ['aws', 'bedrock', 'agents', 'knowledge-base', 'guardrails', 'opensearch', 'quicksight', 'governance'],
    difficulty: 'hard',
    question: '某金融公司上线用 Bedrock 帮客服代表做个性化投资建议的 GenAI 应用，须负责任的 AI 治理并满足监管：检测并防止推荐幻觉、对客户交互加安全控制、实时监控模型行为漂移、保留所有 prompt-响应对审计。须 60 天内上线、集成既有合规仪表盘、响应 <200ms。哪种方案以最低运维开销满足？（单选）',
    options: [
      '配 Bedrock Guardrails 自定义内容过滤与毒性检测，用 Model Evaluation 检幻觉，prompt-响应对存 DynamoDB 加 TTL，CloudWatch 自定义指标接合规仪表盘。',
      '用 PrivateLink 安全访问 Bedrock，Lambda 做自定义提示校验，prompt-响应对存 S3 配生命周期，自建 CloudWatch 仪表盘监控。',
      '用 Bedrock Agents + Knowledge Bases 接地响应，Guardrails 保内容安全，OpenSearch 存储索引 prompt-响应对，集成 QuickSight 生成合规报告并检测行为漂移。',
      '用 SageMaker Model Monitor 检漂移，WAF 过滤内容，交互存加密 RDS，API Gateway 建自定义 HTTP API 接合规仪表盘。'
    ],
    explanation: 'C 正确：Agents+知识库做接地降低幻觉，Guardrails 保安全，OpenSearch 索引 prompt-响应对供 QuickSight 生成合规报告并检测行为漂移，托管方案运维最省且满足 <200ms。A 模型评估为离线非实时；B/D 自建多。',
    open: '正确答案：C。\n- Agents+KB 接地降幻觉；Guardrails 安全；OpenSearch 索引 prompt-响应 + QuickSight 合规/漂移检测，托管省运维且达延迟。\n- A 评估离线；B/D 自建重。'
  },
  42: {
    subtopic: '前端流式优化（Amplify AI Kit + GraphQL 流式）',
    tags: ['aws', 'amplify', 'appsync', 'bedrock', 'knowledge-base', 'streaming', 'performance'],
    difficulty: 'medium',
    question: '某公司把 AI 助手做成 React 应用，用 AWS Amplify + AppSync GraphQL + Bedrock 知识库；GraphQL 调 RetrieveAndGenerate，配 Lambda resolver（RequestResponse）。用户报复杂问题常超时变慢。哪种方案解决性能问题？（单选）',
    options: [
      '用 AWS Amplify AI Kit 从 GraphQL API 实现流式响应并优化客户端渲染。',
      '增大 Lambda resolver 超时并加指数退避重试。',
      '让应用向 SQS 队列发请求，AppSync resolver 轮询处理队列。',
      '改 RetrieveAndGenerate 为 InvokeModelWithResponseStream，应用改用 API Gateway WebSocket API 支持流式。'
    ],
    explanation: 'A 正确：Amplify AI Kit 从 GraphQL API 流式返回并优化客户端渲染，直接消除长处理导致的超时与慢响应。B 仅加大超时；C 引入轮询延迟；D 改动大。',
    open: '正确答案：A。\n- Amplify AI Kit 流式响应+客户端渲染优化，消除超时/慢响应。\n- B 仅加超时；C 轮询增延迟；D 改动大。'
  },
  43: {
    subtopic: 'Token 用量管理（Lambda 分词器预估 + CloudWatch 告警 + DynamoDB）',
    tags: ['aws', 'bedrock', 'lambda', 'tokenizer', 'cloudwatch', 'dynamodb', 'cost-allocation'],
    difficulty: 'hard',
    question: '某金融公司经 Bedrock 用多个 FM，新法规要求对敏感金融数据做 token 管理：须在接近模型专属 token 上限时主动告警，支撑 >5000 请求/分钟，并留存 token 用量指标供业务单元分摊成本。哪种方案满足？（单选）',
    options: [
      '在 Lambda 开发模型专属分词器，发请求前预估 token 用量，发布 CloudWatch 指标并在接近阈值时告警，详细用量存 DynamoDB 供成本报告。',
      '用 Bedrock Guardrails 的 token 配额策略，捕获被拒请求指标，EventBridge 规则触发通知，CloudWatch 仪表盘看趋势。',
      '部署 SQS 死信队列处理失败请求，Lambda 分析 token 相关失败，CloudWatch Logs Insights 基于错误日志生成报告。',
      '用 API Gateway 为所有 Bedrock 调用建代理，按预定义配额做请求限流，超限额直接拒绝。'
    ],
    explanation: 'A 正确：Lambda 内用模型专属分词器预估 token 用量，发布 CloudWatch 指标并在接近阈值告警，DynamoDB 留存用量供成本分摊，可支撑 >5000 rpm。B/C/D 不提供主动 token 预估与告警。',
    open: '正确答案：A。\n- Lambda 分词器预估 token + CloudWatch 告警 + DynamoDB 留存供分摊，支撑高并发。\n- B/C/D 无主动预估告警。'
  },
  44: {
    subtopic: 'RAG 相关性提升（Bedrock 知识库内置重排器）',
    tags: ['aws', 'bedrock', 'knowledge-base', 'rerank', 'rag', 'retrieval'],
    difficulty: 'medium',
    question: '某 RAG 应用用 Bedrock 知识库做合规查询，调 RetrieveAndGenerateStream，知识库含 5 万+ 监管文档；因初始检索常返回语义相似但上下文无关文档，导致幻觉与错误指引。须以最低运维开销提升相关性。哪种方案满足？（单选）',
    options: [
      '部署 SageMaker 端点跑微调排序模型，API Gateway REST 路由重排结果。',
      '用 Comprehend 分类文档打相关分，集成 Textract 文档分析，Neptune 做图相关计算。',
      '用 Knowledge Bases Retrieve API 初检，调 Bedrock Rerank API 重排，再 InvokeModelWithResponseStream 生成。',
      '在 Bedrock 知识库的重排配置中启用最新 reranker 模型，按上下文评估重排结果提升相关性。'
    ],
    explanation: 'D 正确：在 Bedrock 知识库内启用最新重排模型，按上下文相关性重排检索结果，直接提升相关性且运维最省。A/B 需自管模型与管线；C 手动调用 Rerank API 仍多于内置配置。',
    open: '正确答案：D。\n- 知识库内置 reranker 配置按上下文重排，运维最省。\n- A/B 自管重；C 手动 Rerank API 多于内置。'
  },
  45: {
    subtopic: '多智能体架构（supervisor 路由 + 各部门知识库隔离）',
    tags: ['aws', 'bedrock', 'agents', 'multi-agent', 'knowledge-base', 'iam', 'supervisor'],
    difficulty: 'medium',
    question: '某医疗公司用 Bedrock 建实时患者护理助手，回应临床/保险核验/预约/理赔等部门；欲用多智能体架构，须可扩展、能接入新功能、支撑数千并行交互，并确保领域专属响应。哪种方案满足？（单选）',
    options: [
      '每智能体用独立知识库隔离数据，IAM 过滤控访问；部署 supervisor 智能体做意图分类，将查询路由到专精 collaborator 智能体，各以本部门知识库做 RAG。',
      '每部门建独立 supervisor，各 collaborator 做意图分类，仅接本部门知识库，supervisor 间手工交接。',
      '每部门数据隔离在独立知识库，IAM 过滤；部署单一通用智能体，内部多 action group 做部门功能，规则路由。',
      '多独立 supervisor 并行回应各部门，各配 collaborator，所有智能体共用同一知识库，外部路由合并响应。'
    ],
    explanation: 'A 正确：每部门独立知识库 + IAM 过滤做数据隔离，supervisor 做意图分类并路由到专精 collaborator，各以本部门知识库做 RAG，可水平扩展支撑高并发与领域响应。B 手工交接不 scalable；C 非多智能体；D 无数据隔离。',
    open: '正确答案：A。\n- 独立知识库+IAM 隔离；supervisor 意图分类路由 collaborator，各部门 RAG，可扩展。\n- B 手工交接不 scalable；C 非多智能体；D 无隔离。'
  },
  46: {
    subtopic: '实时低延迟模型（Bedrock 预置吞吐 + 自动伸缩）',
    tags: ['aws', 'bedrock', 'provisioned-throughput', 'auto-scaling', 'real-time', 'latency'],
    difficulty: 'medium',
    question: '某应用实时分析客服通话并为人工坐席生成建议，峰值 50 万并发呼叫、每条建议端到端 <200ms；已有转写架构，须控制在月度计算预算内并保持自动伸缩。哪种方案满足？（单选）',
    options: [
      '在 Bedrock 部署大型推理模型，购预置吞吐并优化批处理。',
      '在 Bedrock 部署低延迟实时优化模型，购预置吞吐并设自动伸缩策略。',
      '在 SageMaker AI 实时端点部署 LLM（专用 GPU 实例）。',
      '在 SageMaker AI serverless 端点部署中型 LLM 并优化批处理。'
    ],
    explanation: 'B 正确：部署低延迟实时优化模型并购预置吞吐 + 自动伸缩，满足 <200ms 与 50 万并发且在预算内弹性扩缩。A 推理模型不适实时；C 自管 GPU 重；D 批处理不满足实时。',
    open: '正确答案：B。\n- 低延迟实时模型 + 预置吞吐 + 自动伸缩，满足 <200ms 与高并发且弹性。\n- A 不适实时；C 自管重；D 批处理非实时。'
  },
  47: {
    subtopic: 'Guardrails 高风险管控（denied topics + 竞品词过滤 + 高接地阈值）',
    tags: ['aws', 'bedrock', 'guardrails', 'denied-topics', 'word-filter', 'grounding', 'compliance'],
    difficulty: 'hard',
    question: '某金融公司建 AI 助手帮客户做投资规划，识别高风险对话模式（如具体股票推荐、保证收益）以免违规。须确保助手不提供不适当投资建议、不产出竞品内容、不编造无获批指引支撑的断言；用 Bedrock Guardrails。哪三项组合满足？（请选择 3 个）',
    options: [
      '将高风险对话模式加入 denied topics guardrail。',
      '配置内容过滤器 guardrail 过滤含高风险模式的提示。',
      '配置内容过滤器 guardrail 过滤含竞品名称的提示。',
      '将竞品名称加入自定义词过滤器，输入与输出动作均设为 block。',
      '设较低的接地分数阈值。',
      '设较高的接地分数阈值。'
    ],
    explanation: 'A、D、F 正确：denied topics 拦截不适当投资建议；自定义词过滤器屏蔽竞品名称（输入/输出均 block）；高接地分数阈值确保回答基于获批金融指引、不编造。B/C 用词过滤器/内容过滤器处理主题不准确（主题用 denied topics）；E 低阈值反而放宽。',
    open: '正确答案：A、D、F。\n- denied topics 拦截不适当建议；自定义词过滤器屏蔽竞品（输入输出均 block）；高接地阈值确保基于获批指引。\n- B/C 用词/内容过滤器处理主题不准；E 低阈值放宽。'
  },
  48: {
    subtopic: '分酒店知识库隔离（每酒店独立 KB + 多账号）',
    tags: ['aws', 'bedrock', 'knowledge-base', 'multi-account', 'access-control', 'pms', 'real-time'],
    difficulty: 'medium',
    question: '某酒店公司想给遗留 Java PMS 加 AI 能力，用 Bedrock 知识库给员工房间可用性与酒店详情；须每家酒店独立访问控制、近实时房间可用性、峰值性能稳定。哪种方案满足？（单选）',
    options: [
      '建单一知识库存所有酒店合并数据，Lambda 经 API 同步各 PMS，CloudTrail 按酒店过滤审计。',
      '每酒店建 EventBridge 规则由 PMS 变更触发，发到管理账号集中知识库，资源策略做按酒店访问控制。',
      '多账号结构下每家酒店一个知识库，直接摄入提供实时房间可用性，非关键信息定时同步。',
      '建集中 Bedrock 智能体用多个知识库，IAM Identity Center 按酒店权限集控员工访问。'
    ],
    explanation: 'C 正确：每家酒店独立知识库（多账号）实现访问隔离，直接摄入保障房间可用性近实时，非关键信息定时同步；满足分酒店管控与峰值性能。A/B/D 集中式不利于按酒店隔离。',
    open: '正确答案：C。\n- 每酒店独立知识库(多账号)做隔离，直接摄入保近实时，定时同步非关键。\n- A/B/D 集中式不利按酒店隔离。'
  },
  49: {
    subtopic: '贷款文档处理（Textract+A2I + Lambda 脱敏 + Glue Data Quality）',
    tags: ['aws', 'bedrock', 'textract', 'a2i', 'guardrails', 'glue', 'data-residency', 'pii'],
    difficulty: 'hard',
    question: '某银行用 Bedrock 评估扫描财务文档的贷款申请：须抽取结构化数据、推理前脱敏 PII、用 FM 生成审批、将低置信度抽取结果路由到同区域的真人复核；须满足严格区域数据驻留与可审计，日处理 2.5 万申请、99.9% 可用。哪三项组合满足？（请选择 3 个）',
    options: [
      '在同区域部署 Textract 与 Augmented AI(A2I) 抽取数据，低置信度页路由到真人复核。',
      '用 Lambda 在推理前检测并脱敏 PII，用 Guardrails 防止模型输出不当内容，配区域级 IAM 角色强制驻留并控访问。',
      '用 Kendra 与 OpenSearch 从上传文档语义抽取字段级值。',
      '上传文档存 S3 加对象元数据，IAM 策略使原文档与申请人同区域，启用对象标签供未来审计。',
      '用 Glue Data Quality 校验结构化数据，Step Functions 编排含提示工程步骤的审核工作流后再调 Bedrock 评估。',
      '用 SageMaker Clarify 基于 Bedrock 评分生成公平与偏差报告。'
    ],
    explanation: 'A、B、E 正确：Textract+A2I 同区域抽取并让低置信度转人工；Lambda 推理前脱敏 + Guardrails + 区域 IAM 满足驻留与审计；Glue Data Quality 校验 + Step Functions 编排含提示工程。C/D/F 不满足扫描件结构化抽取或驻留要点。',
    open: '正确答案：A、B、E。\n- Textract+A2I 同区域抽取+人工复核；Lambda 脱敏+Guardrails+区域 IAM 驻留；Glue Data Quality+Step Functions 编排。\n- C/D/F 不满足扫描件抽取或驻留。'
  },
  50: {
    subtopic: '小规模向量库选型（MemoryDB + Flat 精确索引）',
    tags: ['aws', 'memorydb', 'vector', 'flat', 'rag', 'similarity-search', 'performance'],
    difficulty: 'medium',
    question: '某金融 RAG 应用用 Bedrock 生成市场活动摘要，依赖存小规模专有数据集、索引量少的向量库；须做相似度搜索且模型响应最大化准确度并保持高性能。须配置向量库并集成。哪种方案满足？（单选）',
    options: [
      '启 Amazon MemoryDB 集群，用 Flat 算法建索引，按性能指标配水平伸缩策略。',
      '启 Amazon MemoryDB 集群，用 HNSW 算法建索引，按性能指标配垂直伸缩策略。',
      '启 Amazon Aurora PostgreSQL 集群，用 IVFFlat 算法建索引，负载升高时升实例规格。',
      '启 Amazon DocumentDB 集群（IVFFlat 索引、高 probe 值），以副本集连接并将读分发到副本。'
    ],
    explanation: 'A 正确：数据集小、索引量少，MemoryDB 内存向量库用 Flat（精确）算法最大化准确度且高性能，水平扩缩应对负载。B HNSW 为近似牺牲准确度；C/D 精度或性能不及内存方案。',
    open: '正确答案：A。\n- 小数据集+低索引量，MemoryDB 内存向量库用 Flat 精确算法最大化准确度且高性能，水平扩缩。\n- B HNSW 近似牺牲准确度；C/D 精度/性能不及。'
  }
};

const raw = JSON.parse(fs.readFileSync('temp/examcademy-raw.json', 'utf8'));

const newQuestions = [];
for (let n = 26; n <= 50; n++) {
  const r = raw.find(x => x.num === String(n));
  const c = CN[n];
  if (!r || !c) { console.error('missing', n); continue; }
  const isMultiple = r.correctLetters.length > 1;
  const answer = r.options
    .map((o, i) => (o.correct ? i : -1))
    .filter(i => i >= 0);
  const obj = {
    id: `${CAT}-${String(n).padStart(2, '0')}`,
    category: CAT,
    topic: CAT,
    subtopic: c.subtopic,
    tags: c.tags,
    difficulty: c.difficulty,
    angle: 'scenario',
    question: c.question,
    explanation: c.explanation,
    formats: {
      choice: {
        type: isMultiple ? 'multiple' : 'single',
        options: c.options,
        answer
      },
      open: {
        referenceAnswer: c.open
      }
    }
  };
  newQuestions.push(obj);
}

const bankPath = 'src/data/questions/aws-genai-developer-pro.json';
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));
const existingIds = new Set(bank.map(q => q.id));
const toAdd = newQuestions.filter(q => !existingIds.has(q.id));
bank.push(...toAdd);
fs.writeFileSync(bankPath, JSON.stringify(bank, null, 2) + '\n');
console.log('added', toAdd.length, 'questions; bank now', bank.length);
