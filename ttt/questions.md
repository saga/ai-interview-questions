-----


-----


-----


-----


-----


-----


-----


-----


-----


-----


-----


-----


-----


-----


-----

* **question**:
一家跨国保险公司部署了一款生成式人工智能助手，帮助代理人审核理赔、解释保单条款并撰写客户沟通文稿。在预生产测试期间，安全团队发现用户有时可以就超出授权业务范围的主题提出回复。合规团队也担心，生成的回复可能会无意中泄露敏感信息或包含违反公司沟通标准的措辞。公司领导层希望找到一种解决方案，在回复到达用户之前就防止这些问题的发生，同时在多个人工智能应用中保持一致的治理框架。公司应该采取哪些措施？（请选择以下三个选项）
* **answer options**:
1. 实施提示模板，指示模型不要讨论禁止的话题，并依靠提示工程作为主要的执行机制。
2. 利用历史客户服务对话对基础模型进行微调，并要求业务部门在治理要求发生变化时重新训练模型。
3. 实施响应验证工作流程，在将生成的输出返回给用户之前对其进行检查，并在检测到违反策略时执行编辑或拒绝。
4. 实施 Amazon Bedrock Guardrails，在应用程序中一致应用拒绝主题策略、内容过滤器和敏感信息保护。
5. 实施监控和审计工作流程，跟踪护栏干预措施、政策违规行为以及安全相关指标随时间的变化。


* **正确答案**：
**选项 3**、**选项 4** 和 **选项 5**
* **为什么**：
1. **核心防护机制（选项 4）**：Amazon Bedrock Guardrails 提供集中式的治理框架，原生支持在多应用间一致配置“拒绝主题（Denied Topics）”、“内容过滤器（Content Filters）”以及“敏感信息/PII 保护（Sensitive Information Protection）”，从源头上满足多应用统一安全标准的要求。
2. **上线前拦截与验证（选项 3）**：通过建立响应验证工作流（Response Validation Workflow），在 LLM 生成内容返回给终端用户前进行二次检查，一旦发现违规即执行内容遮蔽（Redact）或拒绝返回（Block），直接响应了题目中“在回复到达用户之前防止问题发生”的需求。
3. **合规审计与持续监控（选项 5）**：健全的 AI 治理框架不仅需要事前事中拦截，还需要事后追溯。监控与审计工作流能够跟踪护栏触发率和违规行为，为合规团队提供可量的证据和安全分析数据。
4. **错误选项排除**：
* **选项 1**：提示工程（Prompt Engineering）属于“软约束”，无法作为安全和合规拦截的硬性保证机制，极易被 Prompt 注入等技术绕过。
* **选项 2**：仅为了合规规则变更就频繁重新微调（Fine-tuning）基础模型，不仅成本极高、周期长，且无法彻底杜绝随机性的敏感信息泄露。

-----

* **question**:
一家金融服务公司开发了多个定制化的基础模型，用于支持欺诈检测、监管分析、风险评估和客户服务自动化。该公司希望建立一套部署策略，以支持对模型版本进行可控的推广、对生产环境发布进行管控、在检测到质量问题时快速回滚，以及追溯特定时间点部署的模型版本。该组织预计多个团队将贡献模型，并希望在所有人工智能项目中实现部署生命周期管理的标准化。该公司应该采取哪些措施？（请选择三个选项）
* **answer options**:
1. 使用提示管理作为模型工件生命周期管理和生产发布治理的主要机制。
2. 在 SageMaker 模型注册表中注册模型工件和版本，并使用已批准的升级工作流程将模型从测试环境迁移到生产环境。
3. 实施部署管道，以支持受控的推广策略和回滚程序，以便在检测到质量退化或操作问题时进行恢复。
4. 将模型工件存储在 Amazon S3 中，并要求开发团队通过操作文档和发布管理电子表格手动跟踪部署版本。
5. 在生产环境部署之前，实施审批控制和治理检查点。


* **正确答案**：
**选项 2**、**选项 3** 和 **选项 5**
* **为什么**：
1. **版本追溯与模型标准化（选项 2）**：Amazon SageMaker Model Registry（模型注册表）是 AWS 标准的 MLOps 治理工具，用于集中化管理模型工件、版本历史、元数据以及批准状态，能为多团队协作提供统一的追溯和上线晋升工作流。
2. **受控推广与快速回滚（选项 3）**：通过自动化 CI/CD 部署管道（如蓝绿部署或金丝雀发布），能够在检测到模型质量下降或系统故障时实现自动或快速回滚，确保生产稳定性。
3. **生产发布管控（选项 5）**：在部署管道中嵌入审批机制和治理检查点（Governance checkpoints），符合金融行业对生产环境变更严格审查的要求，防止未经授权的模型直接进入生产环境。
4. **错误选项排除**：
* **选项 1**：提示词管理（Prompt Management）仅针对 Prompt 的版本与组织，无法替代复杂的模型工件（Model Artifacts）生命周期与权重文件的发布治理。
* **选项 4**：通过电子表格和手动文档跟踪容易发生人为失误，无法实现全链路自动追溯和跨团队的标准自动化 MLOps。

-----

* **question**:
A legal technology company is building a document-analysis platform that processes lengthy contracts, regulatory filings, and litigation records. Some requests complete in seconds, while others require extensive retrieval operations and complex reasoning that can take several minutes. Users do not need immediate results but want reliable notification when processing is complete. The platform must support large processing volumes, tolerate temporary failures gracefully, and avoid maintaining long-lived client connections for extended operations. Which solution best meets these requirements?
* **answer options**:
1. Configure API Gateway WebSocket APIs and maintain bidirectional communication channels for every request, streaming intermediate progress updates continuously until processing completes.
2. Implement an asynchronous processing architecture that accepts requests through API Gateway, stores work items in Amazon SQS, processes requests through Lambda functions or containerized workers, and publishes completion notifications through EventBridge so clients can retrieve results when processing finishes.
3. Implement synchronous InvokeModel requests and configure clients to poll the service periodically for status updates until processing completes, and increase API Gateway throttling limits to support larger numbers of concurrent polling requests.
4. Use InvokeModelWithResponseStream for all requests and require client applications to maintain persistent connections until processing completes, with automatic reconnection on network interruptions.


* **正确答案**：
**选项 2**（`Implement an asynchronous processing architecture that accepts requests through API Gateway, stores work items in Amazon SQS, processes requests through Lambda functions or containerized workers, and publishes completion notifications through EventBridge so clients can retrieve results when processing finishes.`）
* **为什么**：
1. **完美契合长耗时与异步解耦（Asynchronous Architecture）**：题目指出某些复杂的推理与检索任务需要耗时数分钟，且明确要求“避免维护长连接（avoid maintaining long-lived client connections）”。通过 API Gateway 接收请求、进入 Amazon SQS 缓冲，由 Lambda/Worker 异步消费处理，并在完成后由 EventBridge 发送通知，是标准的无状态长任务解耦架构。
2. **容错与抗压能力（Tolerate temporary failures & Large processing volumes）**：Amazon SQS 可以对突发流量进行缓冲和削峰，并提供重试机制（Retry / DLQ），能优雅地应对临时性故障。
3. **其他选项排除**：
* **选项 1**：使用 WebSockets 会在客户端和服务端建立长连接，直接违背了“避免长连接（avoid long-lived client connections）”的要求。
* **选项 3**：同步调用（Synchronous InvokeModel）受 API Gateway 的 29 秒超时限制，且频繁轮询（Polling）会带来不必要的性能消耗与限流风险。
* **选项 4**：使用流式响应（ResponseStream）并保持持久连接同样违背了避免长连接的原则，且在网络中断时容易导致不稳定的体验。

-----

* **question**:
A multinational consulting company wants to provide employees with a conversational assistant that can answer questions using information stored across SharePoint repositories, Confluence workspaces, internal document-management systems, and several third-party business applications. The organization wants to minimize custom development, preserve existing access controls, support natural-language search experiences, and accelerate time to value. Leadership is not interested in building a custom retrieval architecture unless there is a compelling business justification. Which solution best meets these requirements?
* **answer options**:
1. Implement Amazon Q Business and configure connectors for supported enterprise repositories, leveraging existing permissions, enterprise search capabilities, and conversational experiences while minimizing custom development and operational overhead.
2. Create separate Bedrock Knowledge Bases for each content source, require users to select the appropriate repository before submitting questions, and configure Prompt Flows to coordinate retrieval across repositories whenever multiple data sources are required.
3. Build a custom retrieval platform using Amazon Bedrock Knowledge Bases, OpenSearch, custom ingestion pipelines, and application-specific authentication integrations, and configure development teams to maintain connector implementations and retrieval logic for each enterprise content source.
4. Implement a centralized GenAI gateway and require all enterprise repositories to export content into a shared S3-based data lake, then build a custom conversational interface that performs retrieval against the consolidated repository.


* **正确答案**：
**选项 1**（`Implement Amazon Q Business and configure connectors for supported enterprise repositories, leveraging existing permissions, enterprise search capabilities, and conversational experiences while minimizing custom development and operational overhead.`）
* **为什么**：
1. **全托管开箱即用（Minimize Custom Development）**：Amazon Q Business 是 AWS 专为企业设计的生成式 AI 对话助手，内置了对 SharePoint、Confluence 等主流应用的原生数据连接器（Connectors），能够实现零/极低代码接入，完全满足“最小化自定义开发”和“快速实现价值”的要求。
2. **原生继承访问控制（Preserve Access Controls）**：Amazon Q Business 在检索和回答时能够自动同步并应用源数据系统的用户权限（ACL），确保员工只能搜索和查看其本身有权限访问的内容。
3. **其他选项排除**：
* **选项 2**：要求用户提交问题前手动选择存储库，交互体验差，且 Prompt Flows 增加了非必要的配置复杂度。
* **选项 3**：从零构建自定义检索平台（包含 OpenSearch 和自定义 Ingestion 管道），直接违反了题目中“领导层无意构建自定义检索架构”的明确限定。
* **选项 4**：要求所有系统将数据导出至 S3 数据湖并开发自定义界面，不仅开发与运维成本极高，还会破坏各源系统的原生权限映射。

-----

* **question**:
A healthcare technology provider is evaluating a generative AI solution that assists clinicians with treatment recommendations. Executive leadership is concerned that recommendations could perform differently across patient populations and demographic groups. The organization wants to identify potential disparities before deployment and continuously evaluate whether model performance remains equitable as usage expands. Governance teams require measurable evidence that fairness assessments were performed and documented as part of the deployment process. Which action should the company take BEFORE approving the solution for production deployment?
* **answer options**:
1. Implement monitoring workflows that track inference latency, throughput, and operational reliability, document service-level objectives, record compliance metrics, and review operational performance during governance meetings.
2. Implement retrieval workflows that increase source-document diversity, expand retrieval depth across clinical repositories, document retrieval statistics, and review source coverage whenever fairness concerns are reported.
3. Implement evaluation workflows that use representative datasets across demographic groups, calculate fairness-related metrics, document assessment results within governance artifacts, and repeat evaluations periodically as models and datasets evolve.
4. Implement deployment workflows that require clinical experts to review model outputs, document subjective observations about recommendation quality, record approval decisions within governance systems, and repeat reviews whenever model versions change.


* **正确答案**：
**选项 3**（`Implement evaluation workflows that use representative datasets across demographic groups, calculate fairness-related metrics, document assessment results within governance artifacts, and repeat evaluations periodically as models and datasets evolve.`）
* **为什么**：
1. **精确对齐人口统计与公平性问题**：题目核心考点是防止模型在不同人群（demographic groups）间产生偏见。选项 3 明确提出使用具有跨人口统计特征代表性的数据集，并计算公平性指标（fairness-related metrics）。
2. **满足治理所需的量化证据**：治理团队需要“可测量的证据（measurable evidence）”，选项 3 提出的计算量化指标并将评估结果记录在治理文档（governance artifacts）中完全符合此要求。
3. **兼顾上线前与持续评估**：符合题目要求的“上线前评估（BEFORE approving）”以及“后续随模型/数据演化定期重复评估（repeat evaluations periodically）”。
4. **其他选项排除**：
* **选项 1**：侧重系统运维性能（延迟、吞吐量、SLA），无法解决模型偏见与公平性问题。
* **选项 2**：仅针对 RAG 检索层，且属于“收到反馈后才审查”的被动响应，缺乏上线前的定性与定量评估。
* **选项 4**：依靠专家“主观观察（subjective observations）”，无法向治理团队提供符合要求的标准化、可测量数据。

-----

* **question**:
A financial services organization has deployed a Retrieval-Augmented Generation (RAG) assistant for internal policies and compliance queries. During security testing, security analysts successfully executed an indirect prompt-injection attack by embedding malicious instructions within documents stored in approved knowledge repositories. Security teams are concerned that adversarial techniques evolve quickly and that a single defensive control is insufficient. Leadership requests a scalable, multi-layered architecture that mitigates prompt-injection and jailbreak risks, maintains access to enterprise knowledge, and enables continuous validation of defensive controls. Which two actions should the company implement?
* **answer options**:
1. Implement input-sanitization and suspicious-content detection before inference, use adversarial-content classifiers to evaluate prompts and retrieved content, establish automated red-team testing workflows that continuously evaluate defensive controls, and monitor security findings to identify emerging prompt-injection techniques.
2. Implement Amazon Bedrock Guardrails as the primary protection mechanism, configure denied-topic and content-filtering policies, restrict ingestion of documents containing embedded instructions, establish governance reviews for knowledge sources, and monitor guardrail intervention metrics for security analysis.
3. Implement retrieval strategies that expand the number of retrieved documents, increase the amount of contextual information supplied to the model, diversify retrieval results across multiple repositories, and reduce the relative influence of any single retrieved document during generation.
4. Implement a model-customization strategy that fine-tunes the foundation model using historical examples of prompt-injection attacks, periodically retrain the model as new attack patterns emerge, establish evaluation datasets for known adversarial scenarios, and monitor model behavior for evidence of improved resilience.
5. Implement retrieval-time content validation that evaluates retrieved documents before prompt construction, identify suspicious instructions embedded within retrieved content, quarantine or suppress potentially adversarial material, and apply policy-based controls before information is supplied to the model.


* **正确答案**：
**选项 1** 和 **选项 5**（本题为多选题，需选择两个选项）
* **为什么**：
1. **针对间接提示注入（Indirect Prompt Injection）精确防御**：题目核心威胁是攻击者将恶意指令植入了知识库文档中。**选项 5** 在检索完成后、构建 Prompt 之前对检索到的文档进行内容校验与风险隔离，能在恶意信息传入模型前阻断攻击。
2. **深度防御与持续验证（Defense-in-Depth & Continuous Validation）**：**选项 1** 在推理前实施输入清洗，并结合对抗分类器同时检测用户 Prompt 和检索到的上下文；更重要的是，它建立了自动化红队测试（Automated Red-Team Testing）流程，直接满足了题目中“持续验证防御机制有效性”的特定要求。
3. **错误选项排除**：
* **选项 2**：过于依赖单一防护工具，且简单粗暴地限制文档摄入会损害用户对企业知识库的正常访问。
* **选项 3**：单纯增加检索文档数量或上下文长度无法识别恶意指令，反而可能扩大受攻击面积。
* **选项 4**：对基础模型进行微调（Fine-tuning）无法从根本上防御不断演变的提示词注入与 Jailbreak 攻击，且频繁重训成本高昂昂且滞后。