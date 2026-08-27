// 规范 taxonomy：6 大能力域 → topic 的骨架（ADR-038）。
// 这是"以面试能力域组织"的单一真理来源：Domain → Topic → Concept(KnowledgeNode) → Subtopic(Question) → Angle。
// Concept 层由 src/data/knowledge/*.json 的知识点填充，运行时按 domain/topic 分组（见 groupNodesBy*）。
//
// 为何单独成文件（而非塞进知识节点）：
// - 知识节点是"有哪些概念"，taxonomy 是"我们打算覆盖哪些能力域与主题"——前者是内容，后者是路线图与归类权威。
// - 即使某 topic 当前还没有任何知识点（如 cnn / mcp / planning），taxonomy 也先占位，驱动 roadmap 与覆盖率报告。

import type { KnowledgeArea, KnowledgeNode, QuestionAngle } from '../types';

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
      { id: 'deep-learning', label: '深度学习基础', description: '反向传播/优化器/归一化/正则/过拟合' },
      { id: 'cnn', label: '计算机视觉（CNN）', description: '卷积/池化/感受野/检测分割/视觉Transformer' },
      { id: 'sequence-models', label: '序列模型', description: 'RNN/LSTM/GRU/梯度消失/注意力前传' },
      { id: 'transformer', label: 'Transformer 架构', description: '自注意力/多头/残差/FlashAttention/分词' },
    ],
  },
  {
    id: 'llm',
    label: 'LLM 核心',
    topics: [
      { id: 'llm-fundamentals', label: 'LLM 基础', description: '分词/嵌入/logits/温度采样/上下文窗口/预训练/SFT/RLHF/推理/幻觉' },
      { id: 'training', label: '训练与后训练', description: '预训练/SFT/LoRA/QLoRA/PEFT/梯度累积/混合精度/分布式/检查点' },
      { id: 'inference', label: '推理与服务', description: 'KV Cache/批处理/连续批处理/PagedAttention/前缀缓存/投机解码/量化/并行/延迟与吞吐' },
      { id: 'model-architecture', label: '模型架构', description: 'MoE/Mamba/SSM/混合架构/稀疏/高效架构/位置编码' },
      { id: 'multimodal', label: '多模态', description: '视觉语言模型/图像嵌入/OCR/文档理解/多模态RAG/音频/视频' },
      { id: 'google-genai-leader', label: 'Google Generative AI Leader', description: '生成式 AI 与 Agent 定义/ML 范式区分/Gemini 适用边界/幻觉/扩散模型/负责任 AI 与数据安全' },
    ],
  },
  {
    id: 'llm-applications',
    label: 'LLM 应用',
    topics: [
      { id: 'rag', label: 'RAG 检索增强生成', description: '文档摄入/切分/嵌入/向量检索/混合检索/元数据过滤/重排/上下文构建/引用/检索失败/评估' },
      { id: 'embeddings', label: '嵌入与语义检索', description: '语义相似度/维度/余弦/归一化/分块嵌入/多语言/嵌入模型/ANN/HNSW/检索质量' },
      { id: 'search', label: '向量检索', description: 'HNSW/IVF/ANN/过滤/混合检索/索引/召回与延迟/扩展' },
      { id: 'context-engineering', label: '上下文工程', description: '指令层级/few-shot/结构化输出/上下文选择/压缩/长上下文/注入/隔离/动态/预算' },
    ],
  },
  {
    id: 'agent-engineering',
    label: 'Agent 工程',
    topics: [
      { id: 'agent-fundamentals', label: 'Agent 基础与执行循环', description: 'workflow vs agent/agent loop/规划/反思/失败恢复/评估' },
      { id: 'tool-calling', label: '工具调用', description: '函数schema/工具选择/参数生成/校验/错误/重试/幂等/权限' },
      { id: 'mcp', label: 'MCP 协议', description: 'MCP/resources/工具安全/上下文供给' },
      { id: 'planning', label: '规划', description: '任务分解/计划执行/动态调整/反思' },
      { id: 'memory', label: '记忆', description: '工作记忆/长期记忆/状态/检索/压缩' },
      { id: 'multi-agent', label: '多智能体', description: '分工/通信/共享状态/编排/人环' },
      { id: 'anthropic-cca', label: 'Anthropic CCA（Claude API 实战）', description: '协调器/子代理编排/上下文传递与源归因/状态恢复/工具选择/不确定性/提示缓存/评估' },
    ],
  },
  {
    id: 'ai-systems',
    label: 'AI 系统',
    topics: [
      { id: 'ai-architecture', label: 'AI 系统设计', description: '模型网关/provider抽象/流式/结构化输出/重试/降级/缓存/限流/会话状态/持久化' },
      { id: 'evaluation', label: '评估', description: '离线/在线/黄金集/LLM-as-Judge/rubric/成对/RAG评估/Agent评估/回归/可观测' },
      { id: 'observability', label: '可观测性', description: 'trace/指标/质量抽检/成本监控' },
      { id: 'cost-performance', label: '成本与性能', description: 'token经济/量化取舍/缓存命中/路由/批调度/延迟SLO' },
      { id: 'model-performance', label: '模型性能优化（CUDA / Kernel）', description: 'View 元数据/GEMM Epilogue/算子融合/torch.compile 边界/手写 Triton 内核权衡/Profiler 内核命名' },
      { id: 'reliability', label: '可靠性', description: '超时/限流/重试/幂等/熔断/降级' },
      { id: 'aws-ai-practitioner', label: 'AWS Certified AI Practitioner', description: 'SageMaker 推理选型/Bedrock 权限/可解释性/迁移学习/边缘 SLM/human-in-the-loop/提示工程对齐' },
    ],
  },
  {
    id: 'ai-security',
    label: 'AI 安全',
    topics: [
      { id: 'prompt-injection', label: '提示注入', description: '直接/间接注入/防护/检测' },
      { id: 'data-leakage', label: '数据泄露', description: '训练数据/上下文/日志泄露防护' },
      { id: 'tool-security', label: '工具安全', description: '工具滥用/权限边界/sandboxing' },
      { id: 'agent-safety', label: '智能体安全', description: '过度代理/权限分级/审计/对齐落地' },
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
  'deep-learning': ['definition', 'fundamental', 'mechanism', 'comparison', 'calculation'],
  cnn: ['definition', 'mechanism', 'comparison', 'scenario', 'debugging'],
  'sequence-models': ['definition', 'mechanism', 'comparison', 'scenario'],
  transformer: ['definition', 'mechanism', 'comparison', 'calculation', 'scenario', 'design'],

  // LLM 核心
  'llm-fundamentals': ['definition', 'fundamental', 'mechanism', 'comparison', 'scenario', 'debugging'],
  training: ['definition', 'mechanism', 'comparison', 'tradeoff', 'calculation', 'scenario'],
  inference: ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging', 'calculation'],
  'model-architecture': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design'],
  multimodal: ['definition', 'mechanism', 'comparison', 'scenario'],
  'google-genai-leader': ['definition', 'fundamental', 'mechanism', 'comparison', 'scenario', 'tradeoff'],

  // LLM 应用
  rag: ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging'],
  embeddings: ['definition', 'mechanism', 'comparison', 'calculation', 'scenario'],
  search: ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario'],
  'context-engineering': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design'],

  // Agent 工程
  'agent-fundamentals': ['definition', 'fundamental', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging', 'design'],
  'tool-calling': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging', 'design'],
  mcp: ['definition', 'mechanism', 'comparison', 'scenario', 'design'],
  planning: ['definition', 'mechanism', 'comparison', 'scenario', 'design'],
  memory: ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario'],
  'multi-agent': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design'],
  'anthropic-cca': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'debugging', 'design'],

  // AI 系统
  'ai-architecture': ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design', 'system-design'],
  evaluation: ['definition', 'mechanism', 'comparison', 'tradeoff', 'scenario', 'design'],
  observability: ['definition', 'mechanism', 'scenario', 'debugging'],
  'cost-performance': ['definition', 'mechanism', 'tradeoff', 'calculation', 'scenario'],
  'model-performance': ['definition', 'fundamental', 'mechanism', 'tradeoff', 'scenario', 'debugging', 'design'],
  reliability: ['definition', 'mechanism', 'tradeoff', 'scenario', 'debugging'],
  'aws-ai-practitioner': ['definition', 'scenario', 'mechanism', 'comparison', 'tradeoff'],

  // AI 安全
  'prompt-injection': ['definition', 'mechanism', 'comparison', 'scenario', 'debugging'],
  'data-leakage': ['definition', 'mechanism', 'scenario', 'debugging'],
  'tool-security': ['definition', 'mechanism', 'tradeoff', 'scenario', 'debugging'],
  'agent-safety': ['definition', 'mechanism', 'tradeoff', 'scenario', 'debugging'],
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
