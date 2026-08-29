// 题库加载：按类目拆分的静态 JSON（content source），启动时经 import.meta.glob 合并。
// 刻意保持简单——不建数据库/Repository/索引层；题库规模到达需要按需加载时，
// 再引入动态 import + 构建期 question-index.json（决策记录见 docs/CHANGELOG.md）。
// 运行时边界校验：Zod 负责形状合法性，domain 负责跨字段业务不变量（见 schemas/question.ts）。

import type { QuestionBank } from '../types';
import type { Question } from '../schemas/question';
import { questionSchema } from '../schemas/question';
import { formatSchemaErrorMessage } from '../schemas/errors';

const modules = import.meta.glob('./questions/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown[]>;

const byCategory = new Map<string, Question[]>();
for (const file of Object.keys(modules).sort()) {
  const slug = file.replace('./questions/', '').replace('.json', '');
  const rawQuestions = modules[file];
  const validated: Question[] = [];
  for (let i = 0; i < rawQuestions.length; i++) {
    const result = questionSchema.safeParse(rawQuestions[i]);
    if (!result.success) {
      throw new Error(
        formatSchemaErrorMessage(result.error, `题库校验失败 ${file}[${i}] (id=${(rawQuestions[i] as Record<string, unknown>)?.id ?? 'unknown'})`),
      );
    }
    validated.push(result.data as Question);
  }
  byCategory.set(slug, validated);
}

export const questionBank: QuestionBank = {
  categories: [...byCategory.keys()],
  questions: [...byCategory.values()].flat(),
};
