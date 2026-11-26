import { describe, expect, it } from 'vitest';
import { LEARNING_TRACKS, SAP_IT_SERVICE_COURSE_TOPICS, SAP_COURSERA_COURSE_TOPICS, SAP_JUNIOR_PRACTICE_TOPICS } from './learningTracks';
import { knowledgeNodes } from './knowledgeMap';
import { questionBank } from './questionBank';
import { questionSchema } from '../schemas/question';
import { knowledgeNodeSchema } from '../schemas/knowledge';
import { knowledgeForTrack, questionBankForTrack } from '../domain/learningTracks';

describe('SAP IT Service Consultant course', () => {
  const courseId = 'sap-it-service-consultant';
  const nodes = knowledgeNodes.filter((node) => node.courseId === courseId);
  const questions = questionBank.questions.filter((question) => question.courseId === courseId);

  it('registers as an independent learning track', () => {
    const track = LEARNING_TRACKS.find((item) => item.id === courseId);
    expect(track?.topicCount).toBe(SAP_IT_SERVICE_COURSE_TOPICS.length + SAP_COURSERA_COURSE_TOPICS.length + SAP_JUNIOR_PRACTICE_TOPICS.length);
    expect(SAP_IT_SERVICE_COURSE_TOPICS).toHaveLength(39);
    expect(SAP_COURSERA_COURSE_TOPICS).toHaveLength(10);
    expect(SAP_JUNIOR_PRACTICE_TOPICS).toHaveLength(10);
    expect(new Set(SAP_IT_SERVICE_COURSE_TOPICS.map((topic) => topic.id)).size).toBe(39);
    expect(knowledgeForTrack(knowledgeNodes, courseId)).toHaveLength(59);
    expect(questionBankForTrack(questionBank, courseId, knowledgeNodes).questions).toHaveLength(920);
  });

  it('has valid source-linked knowledge nodes and questions for every topic', () => {
    expect(nodes).toHaveLength(59);
    expect(questions).toHaveLength(920);
    expect(nodes.every((node) => knowledgeNodeSchema.safeParse(node).success && node.area === 'sap-consulting')).toBe(true);
    expect(questions.every((question) => questionSchema.safeParse(question).success)).toBe(true);
    for (const node of nodes) {
      const nodeQuestions = questions.filter((question) => question.topic === node.id);
      expect(nodeQuestions.length).toBeGreaterThanOrEqual(10);
      expect(nodeQuestions.every((question) => question.knowledgeId === node.id && ['sap-official-learning-and-product-documentation', 'coursera-sap-technology-consultant-professional-certificate', 'sap-apac-junior-consultant-practice-cases', 'sap-business-ai-official-documentation', 'sap-tsm-graduate-role-and-sap-technical-operations-learning', 'sap-tsm-graduate-role-and-sap-cloud-lifecycle-learning', 'sap-tsm-graduate-role-and-sap-cloud-alm-learning', 'sap-tsm-graduate-role-and-technical-operations-deepening'].includes(question.source?.materialId ?? ''))).toBe(true);
    }
    expect(new Set(questions.map((question) => question.id)).size).toBe(920);
    const juniorPractice = questions.filter((question) => Number(question.id.slice(-3)) >= 601 && Number(question.id.slice(-3)) <= 800);
    expect(juniorPractice).toHaveLength(200);
    expect(juniorPractice.filter((question) => question.difficulty === 'easy')).toHaveLength(80);
    expect(juniorPractice.filter((question) => question.difficulty === 'medium')).toHaveLength(120);
    expect(juniorPractice.every((question) => question.source?.materialId === 'sap-apac-junior-consultant-practice-cases')).toBe(true);
    const supplemental = questions.filter((question) => question.id.startsWith('sap-itc-') && Number(question.id.slice(-3)) >= 201 && Number(question.id.slice(-3)) <= 400);
    expect(supplemental).toHaveLength(200);
    expect(supplemental.every((question) => ['easy', 'medium'].includes(question.difficulty))).toBe(true);
    const businessAi = questions.filter((question) => Number(question.id.slice(-3)) >= 801 && Number(question.id.slice(-3)) <= 840);
    expect(businessAi).toHaveLength(40);
    expect(businessAi.filter((question) => question.difficulty === 'easy')).toHaveLength(20);
    expect(businessAi.filter((question) => question.difficulty === 'medium')).toHaveLength(20);
    expect(new Set(businessAi.map((question) => question.formats.choice?.answer?.[0])).size).toBe(4);
    expect(businessAi.every((question) => question.source?.materialId === 'sap-business-ai-official-documentation')).toBe(true);
    const tsmQuestions = questions.filter((question) => question.id.startsWith('sap-tsm-'));
    expect(tsmQuestions).toHaveLength(280);
    expect(tsmQuestions.filter((question) => question.formats.choice?.type === 'multiple')).toHaveLength(200);
    expect(tsmQuestions.filter((question) => question.formats.choice?.type === 'single')).toHaveLength(80);
    const newTsmQuestions = tsmQuestions.filter((question) => {
      const sequence = Number(question.id.slice(-3));
      return sequence >= 81 && sequence <= 280;
    });
    expect(newTsmQuestions).toHaveLength(200);
    expect(newTsmQuestions.filter((question) => question.difficulty === 'easy')).toHaveLength(80);
    expect(newTsmQuestions.filter((question) => question.difficulty === 'medium')).toHaveLength(120);
    expect(newTsmQuestions.filter((question) => question.formats.choice?.type === 'single')).toHaveLength(60);
    expect(newTsmQuestions.filter((question) => question.formats.choice?.type === 'multiple')).toHaveLength(140);
    const newTsmTopics = [
      'sap-tsm-linux-operations',
      'sap-tsm-network-connectivity',
      'sap-tsm-abap-runtime',
      'sap-tsm-backup-recovery',
      'sap-tsm-migration-tools',
      'sap-tsm-integration-operations',
      'sap-tsm-identity-security',
      'sap-tsm-cloud-infrastructure',
      'sap-tsm-itsm-service-management',
      'sap-tsm-capacity-performance',
    ];
    expect(nodes.filter((node) => newTsmTopics.includes(node.id))).toHaveLength(10);
    for (const topic of newTsmTopics) {
      expect(newTsmQuestions.filter((question) => question.topic === topic)).toHaveLength(20);
      expect(newTsmQuestions.filter((question) => question.topic === topic).every((question) => question.knowledgeId === topic)).toBe(true);
    }
    expect(newTsmQuestions.every((question) => question.source?.materialId === 'sap-tsm-graduate-role-and-technical-operations-deepening')).toBe(true);

    const reportingPilot = questions.filter((question) => /^sap-itc-17[1-9]$|^sap-itc-180$/.test(question.id));
    expect(reportingPilot).toHaveLength(10);
    expect(reportingPilot.filter((question) => question.formats.choice?.type === 'multiple')).toHaveLength(7);
    expect(reportingPilot.filter((question) => question.formats.choice?.type === 'single')).toHaveLength(3);
    expect(questions.filter((question) => !question.id.startsWith('sap-tsm-') && !reportingPilot.includes(question)).every((question) => question.formats.choice?.type === 'single')).toBe(true);
    expect(questions.every((question) => !/(你是刚加入|作为实习生|Junior Consultant)/.test(question.question))).toBe(true);
    // 所有 SAP 题干必须包含独立的业务/流程背景句，不再只有一句抽象提问。
    expect(questions.every((question) => (question.question.match(/[。！？]/g) ?? []).length >= 2)).toBe(true);
    expect(questions.every((question) => !/(流程流程|业务能力能力|SAP Activate 与实施方法流程|。 +)/.test(question.question))).toBe(true);
    expect(questions.every((question) => question.formats.choice?.options.every((option) => !/[。！？]，(?:并|便于|同时|方便)/.test(option)))).toBe(true);
    expect(nodes.find((node) => node.id === 'sap-business-ai')?.required.join(' ')).toContain('Joule Studio');
    const juniorRoleNoise = /你是刚加入项目|毕业生实习生或 Junior Consultant|应届毕业生或实习生|对初级顾问而言|把资深顾问或项目负责人的决策职责误当成实习生应独立承担的工作/;
    const questionPersonaNoise = /导师|带教顾问|实习生|校招生|应届生|毕业生 TSM|初级 TSM|初级成员|Junior Consultant|Graduate TSM|候选人被要求解释一个没有实际经验的 SAP 能力/;
    expect(questions.every((question) => !juniorRoleNoise.test([
      question.question,
      question.assessment.target,
      question.assessment.reasoningGoal,
      question.explanation,
      ...question.misconceptions,
    ].join(' ')) && !questionPersonaNoise.test([
      question.question,
      question.assessment.target,
      question.explanation,
      ...(question.formats.choice?.options ?? []),
      ...question.misconceptions,
    ].join(' ')))).toBe(true);
    expect(nodes.every((node) => !juniorRoleNoise.test([
      node.summary,
      ...node.required,
      ...node.misconceptions,
    ].join(' ')))).toBe(true);
    const japanSilenceQuestion = juniorPractice.find((question) => question.id === 'sap-itc-636');
    expect(japanSilenceQuestion?.question).toContain('日本客户会议中出现较长沉默，你准备继续讲完所有幻灯片。 下一步最合适的做法是什么？（单选题）');
  });
});
