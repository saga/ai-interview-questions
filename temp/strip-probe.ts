import { questionSchema } from '../src/schemas/question.ts';

const q = {
  id: 'probe-1',
  category: 'ai',
  topic: 't',
  tags: [],
  difficulty: 'medium',
  angle: 'mechanism',
  question: 'Q?',
  explanation: 'E',
  cognitiveTask: 'explain',
  questionRole: 'variant',
  variantOf: 'probe-0',
  concepts: ['KV Cache'],
  formats: { choice: { type: 'single', options: ['a', 'b', 'c', 'd'], answer: [0] } },
} as any;

const r = questionSchema.safeParse(q);
console.log('success =', r.success);
if (r.success) {
  console.log('parsed keys =', Object.keys(r.data).join(', '));
  for (const k of ['cognitiveTask', 'questionRole', 'variantOf', 'concepts']) {
    const kept = Object.prototype.hasOwnProperty.call(r.data, k);
    console.log('  ' + k + ': ' + (kept ? 'KEPT' : 'STRIPPED'));
  }
} else {
  console.log(r.error.issues);
}
