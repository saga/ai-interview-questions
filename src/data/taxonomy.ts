// 规范 taxonomy：6 大能力域 → topic 的骨架（ADR-038）。
// 这是"以面试能力域组织"的单一真理来源：Domain → Topic → Concept(KnowledgeNode) → Subtopic(Question) → Angle。
// Concept 层由 src/data/knowledge/*.json 的知识点填充，运行时按 domain/topic 分组（见 groupNodesBy*）。
//
// 为何单独成文件（而非塞进知识节点）：
// - 知识节点是"有哪些概念"，taxonomy 是"我们打算覆盖哪些能力域与主题"——前者是内容，后者是路线图与归类权威。
// - 即使某 topic 当前还没有任何知识点（如 cnn / mcp / planning），taxonomy 也先占位，驱动 roadmap 与覆盖率报告。

import type { KnowledgeArea, QuestionAngle } from '../schemas/common';
import type { KnowledgeNode } from '../schemas/knowledge';

export interface TaxonomyTopic {
  id: string;
  label: string;
  /** 该 topic 下建议覆盖的概念/角度提示（可选，供蓝图与 roadmap） */
  description?: string;
}

export interface TaxonomyDomain {
  id: KnowledgeArea;
  label: string;
  topics: TaxonomyTopic[];
}

/**
 * 6 大能力域及其主题骨架。
 * 主题取自面试能力域提案：每个域下的二级分类即 topic；Concept 由知识点填充。
 */
export const TAXONOMY: TaxonomyDomain[] = [
  {
    id: 'ai-engineering',
    label: 'AI Engineering（基础能力）',
    topics: [
      {
        id: 'ml-foundations',
        label: '机器学习基础',
        description: '监督学习/损失函数/概率统计/优化/泛化/偏差方差/数据划分/模型评估',
      },
      {
        id: 'deep-learning',
        label: '深度学习基础',
        description: '反向传播/梯度/初始化/归一化/正则化/优化器/训练稳定性',
      },
      {
        id: 'model-architecture',
        label: '模型架构',
        description: 'CNN/RNN/LSTM/Attention/Transformer/MoE/SSM/稀疏与高效架构',
      },
      {
        id: 'representation-learning',
        label: '表示学习',
        description: 'Embedding/特征表示/对比学习/预训练/迁移学习/语义空间',
      },
      {
        id: 'generative-models',
        label: '生成模型',
        description: '自回归/VAE/GAN/扩散模型/采样/生成过程',
      },
    ],
  },

  {
    id: 'llm',
    label: 'LLM 核心',
    topics: [
      {
        id: 'llm-fundamentals',
        label: 'LLM 基础',
        description: 'Tokenization/Embedding/logits/采样/上下文窗口/预训练/SFT/RLHF/推理/幻觉',
      },
      {
        id: 'training',
        label: '训练与后训练',
        description: '预训练/SFT/LoRA/QLoRA/PEFT/梯度累积/混合精度/分布式训练/检查点',
      },
      {
        id: 'inference',
        label: '推理与服务',
        description: 'KV Cache/批处理/连续批处理/PagedAttention/前缀缓存/投机解码/量化/并行/延迟与吞吐',
      },
      {
        id: 'llm-architecture',
        label: 'LLM 架构',
        description: 'MoE/Mamba/SSM/混合架构/稀疏化/位置编码/长上下文/高效架构',
      },
      {
        id: 'multimodal',
        label: '多模态',
        description: '视觉语言模型/图像嵌入/OCR/文档理解/多模态RAG/音频/视频',
      },
    ],
  },

  {
    id: 'llm-applications',
    label: 'LLM 应用',
    topics: [
      {
        id: 'rag',
        label: 'RAG',
        description: '文档摄入/切分/嵌入/向量检索/混合检索/元数据过滤/重排/上下文构建/引用/检索失败/评估',
      },
      {
        id: 'embeddings',
        label: '嵌入与语义检索',
        description: '语义相似度/向量空间/维度/余弦/归一化/嵌入模型/多语言/ANN/HNSW/检索质量',
      },
      {
        id: 'ai-search',
        label: 'AI 搜索',
        description: '倒排/BM25/稠密向量/混合检索/Late Interaction/排序重排/Agentic Search/ANN索引/检索质量与基础设施',
      },
      {
        id: 'context-engineering',
        label: '上下文工程',
        description: '指令层级/few-shot/结构化输出/上下文选择/压缩/长上下文/注入/隔离/动态上下文/Token预算',
      },
    ],
  },

  {
    id: 'agent-engineering',
    label: 'Agent 工程',
    topics: [
      {
        id: 'agent-fundamentals',
        label: 'Agent 基础与执行循环',
        description: 'workflow vs agent/agent loop/规划/行动/观察/反馈/失败恢复/Agent边界',
      },
      {
        id: 'tool-calling',
        label: '工具调用',
        description: '函数Schema/工具选择/参数生成/校验/错误处理/重试/幂等/权限',
      },
      {
        id: 'mcp',
        label: 'MCP',
        description: '协议/Tools/Resources/Prompts/上下文供给/生命周期/安全',
      },
      {
        id: 'planning',
        label: '规划与执行',
        description: '任务分解/计划生成/计划执行/动态调整/反思/恢复',
      },
      {
        id: 'memory',
        label: '记忆与状态',
        description: '工作记忆/长期记忆/状态管理/记忆检索/写入/更新/压缩',
      },
      {
        id: 'multi-agent',
        label: '多智能体',
        description: '角色分工/通信/共享状态/协作/编排/人机协同',
      },
      {
        id: 'human-in-the-loop',
        label: '人机协同',
        description: '人工审批/确认机制/接管/异常升级/高风险操作/可恢复交互',
      },
      {
        id: 'agent-runtime',
        label: 'Agent 运行时',
        description: '运行时/进程模型/会话与状态持久化/并发与隔离/生命周期与热更新/故障重启',
      },
    ],
  },

  {
    id: 'ai-systems',
    label: 'AI 系统',
    topics: [
      {
        id: 'ai-architecture',
        label: 'AI 系统架构',
        description: 'AI 应用整体架构/模型与应用边界/Agent架构/RAG架构/数据流/控制流/状态管理/模块化/可扩展性/架构权衡',
      },
      {
        id: 'ai-integration',
        label: 'AI 基础设施与集成',
        description: '模型网关/Provider抽象/API/流式/结构化输出/缓存/限流/队列/会话/持久化/异步任务',
      },
      {
        id: 'deployment-platform',
        label: '部署与平台',
        description: '模型部署/服务编排/容器/CI-CD/IaC/环境管理/版本发布/灰度/扩缩容',
      },
      {
        id: 'evaluation',
        label: 'AI 评估',
        description: '离线/在线/黄金集/LLM-as-Judge/Rubric/成对比较/RAG评估/Agent评估/回归测试',
      },
      {
        id: 'observability',
        label: '可观测性',
        description: 'Trace/日志/指标/Agent轨迹/质量抽检/Token统计/成本监控',
      },
      {
        id: 'cost-performance',
        label: '成本与性能',
        description: 'Token经济/模型路由/缓存命中/批调度/延迟/吞吐/SLO/成本优化',
      },
      {
        id: 'model-performance',
        label: '模型性能优化',
        description: 'CUDA/View元数据/GEMM/Epilogue/算子融合/torch.compile/Triton/Profiler/Kernel优化',
      },
      {
        id: 'reliability',
        label: '可靠性',
        description: '超时/限流/重试/幂等/熔断/降级/故障恢复/一致性',
      },
    ],
  },

  {
    id: 'ai-security',
    label: 'AI 安全',
    topics: [
      {
        id: 'prompt-injection',
        label: '提示注入',
        description: '直接注入/间接注入/跨模态注入/指令劫持/检测与隔离',
      },
      {
        id: 'data-security',
        label: '数据安全与隐私',
        description: '敏感数据/PII/上下文泄露/训练数据泄露/日志泄露/数据隔离/隐私保护',
      },
      {
        id: 'output-security',
        label: '输出与内容安全',
        description: '不可信输出/结构化输出校验/代码执行/内容过滤/越权结果/下游注入',
      },
      {
        id: 'tool-security',
        label: '工具与执行安全',
        description: '工具滥用/权限边界/Sandbox/代码执行/资源隔离/批准机制',
      },
      {
        id: 'agent-security',
        label: 'Agent 安全',
        description: '过度代理/权限分级/人机确认/工具授权/行为审计/安全边界',
      },
      {
        id: 'model-data-security',
        label: '模型与数据供应链',
        description: '模型来源/依赖/第三方模型/训练数据/模型投毒/后门/模型篡改',
      },
      {
        id: 'ai-security-operations',
        label: 'AI 安全治理',
        description: '审计/监控/红队/攻击检测/事件响应/风险评估/安全测试/治理与合规',
      },
    ],
  },
];

/** 域 id 有序列表。 */
export const DOMAINS: KnowledgeArea[] = TAXONOMY.map((d) => d.id);

/** 域 id → 中文标签。 */
export const DOMAIN_LABELS: Record<KnowledgeArea, string> = TAXONOMY.reduce(
  (acc, d) => {
    acc[d.id] = d.label;
    return acc;
  },
  {} as Record<KnowledgeArea, string>,
);

/** topic id → 中文标签。 */
export const TOPIC_LABELS: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const d of TAXONOMY) for (const t of d.topics) m[t.id] = t.label;
  return m;
})();

const TOPIC_DOMAIN = new Map<string, KnowledgeArea>();
for (const d of TAXONOMY) for (const t of d.topics) TOPIC_DOMAIN.set(t.id, d.id);

/** 查询 topic 所属域；taxonomy 之外的 topic 返回 undefined。 */
export function domainOfTopic(topic: string): KnowledgeArea | undefined {
  return TOPIC_DOMAIN.get(topic);
}

export function domainLabel(domain: KnowledgeArea): string {
  return DOMAIN_LABELS[domain] ?? domain;
}

export function topicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic;
}

/** 按域把知识点分组：域 → 节点列表（保留域顺序，空域也给出空数组）。 */
export function groupNodesByDomain(nodes: KnowledgeNode[]): Map<KnowledgeArea, KnowledgeNode[]> {
  const m = new Map<KnowledgeArea, KnowledgeNode[]>();
  for (const d of DOMAINS) m.set(d, []);
  for (const n of nodes) {
    const list = m.get(n.area) ?? [];
    list.push(n);
    m.set(n.area, list);
  }
  return m;
}

/** 按 topic 把知识点分组：topic id → 节点列表。 */
export function groupNodesByTopic(nodes: KnowledgeNode[]): Map<string, KnowledgeNode[]> {
  const m = new Map<string, KnowledgeNode[]>();
  for (const n of nodes) {
    const list = m.get(n.topic) ?? [];
    list.push(n);
    m.set(n.topic, list);
  }
  return m;
}

/**
 * 与 topic 绑定的角度白名单（ADR-038 延伸）：每个 topic 默认适合考察的角度子集。
 * 用途：当某个 Concept（知识节点）未显式声明 `angles` 时，覆盖矩阵用其所属 topic 的白名单
 * 作为"期望角度"的兜底，让"按能力域组织"的题库自动获得合理的角度覆盖目标；节点显式声明
 * `angles` 时优先用节点自身（更精确）。白名单也可用于出题蓝图的角度候选过滤与校验提示。
 *
 * 设计原则（呼应面试能力域提案）：基础设施/机制类 topic 偏 mechanism/tradeoff/calculation/
 * debugging，应用/架构类 topic 偏 scenario/design/comparison；安全类偏 mechanism/debugging。
 */
export const ANGLE_WHITELIST: Record<string, QuestionAngle[]> = {
  // AI Engineering（基础能力）
  'ml-foundations': ['definition', 'fundamental', 'mechanism', 'comparison', 'calculation'],
  'deep-learning': ['definition', 'fundamental', 'mechanism', 'comparison', 'calculation'],
  'model-architecture': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design'],
  'representation-learning': ['definition', 'mechanism', 'comparison', 'scenario'],
  'generative-models': ['definition', 'mechanism', 'comparison', 'scenario'],

  // LLM 核心
  'llm-fundamentals': ['definition', 'fundamental', 'mechanism', 'comparison', 'scenario', 'debugging'],
  training: ['definition', 'mechanism', 'comparison', 'tradeoff', 'calculation', 'scenario'],
  inference: ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging', 'calculation'],
  'llm-architecture': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design'],
  multimodal: ['definition', 'mechanism', 'comparison', 'scenario'],

  // LLM 应用
  rag: ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging'],
  embeddings: ['definition', 'mechanism', 'comparison', 'calculation', 'scenario'],
  'ai-search': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging'],
  'context-engineering': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design'],

  // Agent 工程
  'agent-fundamentals': ['definition', 'fundamental', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging', 'design'],
  'tool-calling': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging', 'design'],
  mcp: ['definition', 'mechanism', 'comparison', 'scenario', 'design'],
  planning: ['definition', 'mechanism', 'comparison', 'scenario', 'design'],
  memory: ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario'],
  'multi-agent': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design'],
  'human-in-the-loop': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design'],
  'agent-runtime': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design', 'debugging'],

  // AI 系统
  'ai-architecture': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design', 'system-design'],
  'ai-integration': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design'],
  'deployment-platform': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design', 'debugging'],
  evaluation: ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design'],
  observability: ['definition', 'mechanism', 'scenario', 'debugging'],
  'cost-performance': ['definition', 'mechanism', 'tradeoff', 'calculation', 'scenario'],
  'model-performance': ['definition', 'fundamental', 'mechanism', 'tradeoff', 'scenario', 'debugging', 'design'],
  reliability: ['definition', 'mechanism', 'tradeoff', 'scenario', 'debugging'],

  // AI 安全
  'prompt-injection': ['definition', 'mechanism', 'comparison', 'scenario', 'debugging'],
  'data-security': ['definition', 'mechanism', 'scenario', 'debugging'],
  'output-security': ['definition', 'mechanism', 'scenario', 'debugging'],
  'tool-security': ['definition', 'mechanism', 'tradeoff', 'scenario', 'debugging'],
  'agent-security': ['definition', 'mechanism', 'tradeoff', 'scenario', 'debugging'],
  'model-data-security': ['definition', 'mechanism', 'scenario', 'debugging'],
  'ai-security-operations': ['definition', 'mechanism', 'scenario', 'debugging'],
};

/** 全部 10 个角度（白名单兜底值，用于 taxonomy 中未登记的 topic）。 */
export const FALLBACK_ANGLES: QuestionAngle[] = [
  'definition',
  'fundamental',
  'mechanism',
  'comparison',
  'calculation',
  'tradeoff',
  'scenario',
  'debugging',
  'system-design',
  'design',
];

/** 查询某 topic 允许的角度集合；taxonomy 未登记时返回全部 10 角度。 */
export function allowedAnglesFor(topic: string): QuestionAngle[] {
  return ANGLE_WHITELIST[topic] ?? FALLBACK_ANGLES;
}
