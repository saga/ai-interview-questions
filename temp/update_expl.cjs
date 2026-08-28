const fs = require('fs');

const bankPath = 'src/data/questions/aws-genai-developer-pro.json';
const bank = JSON.parse(fs.readFileSync(bankPath, 'utf8'));

const ZH = {
  26: 'Amazon Titan Embeddings 生成的向量能捕捉摘要文本的语义。Aurora PostgreSQL Serverless 配合 pgvector 扩展可存储这些向量、执行向量相似度搜索并保留关联元数据用于过滤。使用 Bedrock 与 Aurora Serverless 避免了自管 SageMaker 模型端点，并降低了数据库容量管理开销；Aurora PostgreSQL 支持 pgvector 向量搜索。',
  27: 'Amazon Bedrock 预置吞吐为一致、高吞吐工作负载提供专用模型容量。Amazon SageMaker AI 端点支持实时推理，而 SageMaker Neo 可优化并将受支持模型部署到云实例与边缘设备，从而实现云/本地的混合模式。',
  28: 'AWS AppConfig 让应用使用与代码独立更新的集中配置。Lambda 函数可通过 AWS AppConfig Agent 获取当前路由配置，并为每个请求执行任意业务逻辑来选择并调用合适的 Bedrock 基础模型，从而在一个 API 端点后支持动态变化的阈值、区域规则与 A/B 路由逻辑。API Gateway 的转换与变量不适合复杂动态路由，Lambda authorizer 用于授权而非模型选择。',
  29: 'Amazon Bedrock Guardrails 的上下文接地检查通过评估生成内容是否事实性地基于所提供参考源（含摘要）来检测并过滤幻觉。Bedrock 提供 InputTokenCount/OutputTokenCount 等 CloudWatch 指标，CloudWatch 异常检测告警可识别指标模式的异常偏离，提前预警异常 token 成本。Bedrock 调用日志可将文本输入/输出保留在 S3。',
  30: 'Amazon Bedrock 跨区域推理将按需请求分散到多个区域的容量，在不购买持续计费的预置吞吐的情况下吸收突发流量、提升可用性。Bedrock 运行时指标含 Invocations/InputTokenCount/OutputTokenCount/InvocationThrottles，提供用量与限流可见性。',
  31: 'AWS Step Functions 可编排 Amazon Transcribe 并经其优化的 Bedrock 集成直接调用 Bedrock 模型；该集成接受模型专属 JSON 请求体，可让提示直接请求结构化摘要与情感输出，无需中间 Lambda。Amazon S3 可向 EventBridge 发送 Object Created 事件，EventBridge 规则以 Step Functions 状态机为目标，在每次新建录音时启动工作流。',
  32: 'API Gateway HTTP API 可直接集成 Lambda 并支持 OAuth 2.0/OIDC 授权。Cognito 为内部与第三方客户端发放 OAuth 令牌，API Gateway 在将 MCP Streamable HTTP 请求转发给 Lambda 前校验令牌。这保留 MCP 兼容传输的同时使用托管的令牌校验与基于 scope/claim 的访问控制，避免自定义传输与面向伙伴的直接 IAM 凭据管理。',
  33: 'Amazon Bedrock 知识库实现 RAG，检索相关专有目录数据并作为上下文加入模型，使推荐落地到可用商品目录并提升相关性。将性能配置 latency 设为 optimized 使用低延迟推理选项，降低受支持模型与推理配置的响应时间。',
  34: '在原始区域预处理后再送 Bedrock 可让处理停留在所需大洲内，区域级 S3 策略使存储数据受适用区域管控。S3 Object Lock 提供 WORM 留存保护存储记录，Macie 发现并分类 S3 中的敏感数据，CloudTrail 提供带日志完整性校验的可审计 API 活动。',
  35: 'Step Functions 标准工作流支持 Wait for a Callback 模式，使澄清流程可暂停等待响应。DynamoDB 提供持久、低延迟的对话存储，按需容量应对变动高并发，并支持静态服务端加密。',
  36: 'Bedrock Guardrails 可在单一配置中组合中等强度有害内容过滤器、带定义与样例短语的 denied topics、以及敏感信息过滤器。敏感信息策略可对输入/输出施加不同动作：响应中脱敏 PII，输入中拦截金融信息。Guardrails 同时评估提示与模型响应，中等过滤相比高强度有助于减少误杀。',
  37: 'Bedrock Prompt Management 支持可复用提示模板、版本化快照与提示变量，统一提示输入与配置。CloudTrail 记录含身份/动作/时间/请求参数的 AWS 活动，形成可审计的提示管理操作历史。IAM 策略可分离并限制创建/修改/版本化提示的权限，支撑受控审批流程。',
  38: 'Bedrock Guardrails 敏感信息过滤器可在模型响应中匿名化 PII。按认证 Cognito 用户组施加对应 guardrail，可使 PII 对外科医生保留、对工程师脱敏。S3 生命周期过期规则删除超 3 年报告，每日定时同步更新知识库以反映 S3 的增删改，使过期报告不再可被检索。',
  39: 'Amazon Q Business 让客户保留并管理自有企业数据索引，同时授予经验证的独立软件供应商受控的跨账号数据访问者权限。供应商可用 SearchRelevantContent API 检索相关内容用于提示富化，无需直接连接或索引每个客户数据源。Amazon Q 支持语义与混合检索并应用客户配置访问控制。',
  40: 'S3 上传可触发 Lambda，Step Functions 标准工作流可编排后续建模型过程。SageMaker Pipeline 可包含训练与模型部署步骤，上传后启动流水线即用更新数据集重训练并将模型重部署到应用。SageMaker Pipelines 支持部署步骤，AWS 文档化了 EventBridge/S3 驱动的流水线执行自动化。',
  41: 'Bedrock 知识库提供托管 RAG 工作流，使响应基于企业数据并附来源归因，降低幻觉风险。Guardrails 按配置安全策略评估输入与响应。将 prompt-响应对存于 OpenSearch 支撑可搜索的合规审计轨迹，QuickSight 可用收集数据做合规报告与行为趋势分析。该托管服务组合最小化快速部署所需的自定义代码与运维基础设施。',
  42: 'AWS Amplify AI Kit 支持 React 应用的流式 LLM 响应。其 Lambda 集成以流式请求调用 Bedrock，并经由 AppSync WebSocket 将响应块送往浏览器增量渲染，避免了同步 RequestResponse resolver 所需的等待整段长生成。',
  43: 'Bedrock 按模型强制 token 配额，故须在推理前用对应模型的分词规则预估 token 用量以识别接近上限。可扩展的 Lambda 层可做该请求前预估，发出模型与业务单元专属的 CloudWatch 自定义指标用于阈值告警，并将详细用量存 DynamoDB 供分摊计费。Guardrails 不实现 token 配额策略，死信队列在请求失败后才运作，API Gateway 使用计划施加的是请求配额而非模型专属 token 计算。',
  44: 'Bedrock 知识库在使用 RetrieveAndGenerate/RetrieveAndGenerateStream 时可通过检索重排配置应用托管重排器。重排器评估检索文本块与查询的相关性并重排序，替代默认排名，提升上下文相关性且免去了部署与集成独立排序/API/文档分析/图处理服务的运维负担。',
  45: 'Bedrock 多智能体协作支持 supervisor 智能体将请求路由到专精 collaborator 智能体。每个 collaborator 可配置为不同部门并使用自有知识库做 RAG，保留领域专精且可通过增删 collaborator 扩展能力。supervisor 路由模型旨在将请求发往合适 collaborator 并降低延迟。',
  46: '低延迟、实时优化的 Bedrock 模型适合交互式响应生成。预置吞吐为持续高并发提供专用、可预测的推理容量，自动伸缩策略应对变动需求并帮助管理容量与计算成本。批处理无法满足单条建议 <200ms 延迟目标。',
  47: 'Bedrock denied topics 可拦截提示与响应中的不良上下文主题，适合高风险投资建议模式。自定义词过滤器屏蔽精确词或短语（含竞品名），且可同时拦截输入与输出。上下文接地检查评估响应是否事实性基于所提供获批源材料；高阈值要求更强置信度才放行内容。',
  48: '每家酒店独立知识库（多账号）隔离各酒店数据与访问控制，同时可独立管理容量与性能。Bedrock 知识库直接摄入支持单次操作增删改文档而无需等待数据源同步，支撑近实时房间可用性更新；定时同步适合时效性较低的信息。',
  49: 'Textract 抽取文档数据，A2I 在与 Textract 集成时在置信度条件满足时创建人工复核环。Lambda 可在数据送推理前做特定应用 PII 脱敏，Bedrock Guardrails 可检测并掩码敏感信息并施加输出安全控制。Glue Data Quality 校验抽取的结构化数据，Step Functions 可编排工作流（含提示变换后调用 Bedrock）。这些托管无服务器服务在按所需区域配置时提供可扩展工作流处理并保留区域部署边界。',
  50: 'MemoryDB 的 FLAT 向量索引对每向量做暴力线性比对，在距离计算精度内返回精确最近邻结果。对小索引而言，这在不招致穷举搜索的大索引延迟劣势下保留最大检索准确度。HNSW 与 IVFFlat 是近似索引方法，以可能的召回损失换取速度。'
};

let updated = 0;
for (let n = 26; n <= 50; n++) {
  const id = 'aws-genai-developer-pro-' + String(n).padStart(2, '0');
  const q = bank.find(x => x.id === id);
  if (!q || !ZH[n]) continue;
  const letters = q.formats.choice.answer.map(i => String.fromCharCode(65 + i)).join('、');
  q.explanation = ZH[n];
  q.formats.open.referenceAnswer = '正确答案：' + letters + '。\n' + ZH[n];
  updated++;
}
fs.writeFileSync(bankPath, JSON.stringify(bank, null, 2) + '\n');
console.log('updated explanations for', updated, 'questions; bank total', bank.length);
