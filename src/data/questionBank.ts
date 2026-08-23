// 题库加载：按类目拆分的静态 JSON（content source），启动时经 import.meta.glob 合并。
// 刻意保持简单——不建数据库/Repository/索引层；题库规模到达需要按需加载时，
// 再引入动态 import + 构建期 question-index.json（决策记录见 docs/CHANGELOG.md）。

import type { Question, QuestionBank } from '../types';

const modules = import.meta.glob('./questions/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, Question[]>;

const byCategory = new Map<string, Question[]>();
for (const file of Object.keys(modules).sort()) {
  const slug = file.replace('./questions/', '').replace('.json', '');
  byCategory.set(slug, modules[file]);
}

export const questionBank: QuestionBank = {
  categories: [...byCategory.keys()],
  questions: [...byCategory.values()].flat(),
};
