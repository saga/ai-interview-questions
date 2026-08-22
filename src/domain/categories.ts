// 类目 slug → 中文展示名。题库里 category 存 slug（机器可读），UI 用此映射显示。
// 新增类目时在此登记即可，无需改组件。

export const CATEGORY_LABELS: Record<string, string> = {
  'machine-learning': '机器学习基础',
  'deep-learning': '深度学习',
  nlp: '自然语言处理',
  llm: '大语言模型',
  'computer-vision': '计算机视觉',
  statistics: '统计与数学',
  mlops: 'MLOps 与部署',
  'safety-ethics': '安全与伦理',
  'agentic-ai': 'Agentic AI',
};

export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug;
}
