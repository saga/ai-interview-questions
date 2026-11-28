---
name: snowflake-curriculum
description: Maintain the independent Snowflake curriculum using public Coursera module structure and current Snowflake documentation; create traceable knowledge nodes and scenario-based questions.
disable-model-invocation: true
argument-hint: "Course, module, documentation area, or coverage gap to add"
---

# Snowflake Curriculum Authoring

## Curriculum boundary

Work only inside the independent `courseId=snowflake` learning track. Cortex GenAI, Cortex Agents, Snowflake ML and CoCo are Snowflake product capabilities in this curriculum; do not move them into the AI foundations taxonomy. The AI track retains its own six capability domains.

Use public Coursera module titles and learning objectives to order instruction. Use current Snowflake official documentation to verify product semantics, supported behavior, limitations and operational guidance. Public course descriptions are a roadmap source, not a substitute for product documentation. Do not infer private lessons, copy lecture transcripts or claim that non-public labs were fetched.

## Coursera source catalog

- `coursera-sf-intro`: [Intro to Snowflake for Devs, Data Scientists, Data Engineers](https://www.coursera.org/learn/snowflake-intro-app-developers-data-scientists-data-engineers)
- `coursera-sf-modern-de`: [Introduction to Modern Data Engineering with Snowflake](https://www.coursera.org/learn/data-engineering-snowflake)
- `coursera-sf-advanced-de`: [Advanced Data Engineering with Snowflake](https://www.coursera.org/learn/advanced-data-engineering-with-snowflake)
- `coursera-sf-iceberg`: [Apache Iceberg: From Zero to Production Data Lakehouse](https://www.coursera.org/learn/apache-iceberg-data-lakehouse)
- `coursera-sf-genai-intro`: [Introduction to Generative AI with Snowflake](https://www.coursera.org/learn/intro-generative-ai-course-snowflake)
- `coursera-sf-genai-apps`: [Building Generative AI Apps to Talk to Your Data](https://www.coursera.org/learn/building-generative-ai-apps-to-talk-to-your-data)
- `coursera-sf-agents`: [Building AI Agents with Snowflake](https://www.coursera.org/learn/building-ai-agents-with-snowflake)
- `coursera-sf-coco`: [Snowflake CoCo Essentials](https://www.coursera.org/learn/coco-essentials)

Official documentation IDs such as `docs-snowflake-architecture`, `docs-time-travel`, `docs-iceberg`, `docs-cli`, `docs-cortex-search`, `docs-cortex-analyst`, and `docs-cortex-agents` are catalogued in `docs/snowflake-course-roadmap.md`. Add new IDs to the roadmap before using them.

## Learning article authoring and expression review

A lesson is for someone trying to understand a system, not for someone checking a list of headings. Do not impose a universal heading template. Keep only sections that serve the specific learning problem; preserve a heading only when the renderer or data contract explicitly requires it. Merge, rename or remove empty sections instead of filling them with generic text. Any structural constraint must be documented separately from the article's content design.

For every new or substantially revised article:

1. **Open with a recognizable problem.** Name the person or system affected, what they observed, and what decision they need to make. Avoid openings such as “本教程只对应知识点……” or generic platform introductions.
2. **Carry one example through the explanation.** Use a small but complete data sample, SQL query, configuration, event sequence or architecture. Show the input, the operation and the resulting output. When explaining a bug, show the incorrect result before the correction.
3. **Explain why the result happens.** Walk from the mechanism to the observable symptom. Do not replace the explanation with slogans such as “明确输入、状态变化和预期输出” or a list of abstract nouns.
4. **Make engineering guidance executable.** State what to inspect, which query or command to run, what a healthy result looks like, what a failure looks like, and what to do next. If a step depends on a role, version, edition, permission or data assumption, say so.
5. **Use counterexamples.** Explain at least one plausible wrong approach and the concrete way it fails. Avoid repeating the same generic paragraph under every concept or misconception.
6. **End with useful questions.** Ask about the example, decision boundary, failure mode or verification result. Do not ask “如何在实际系统中验证本知识点” or merely restate a heading as a question.
7. **Use diagrams and tables to carry information.** A diagram should show real components and relationships. A table should compare meaningful cases or data. Do not add a decorative diagram or a checklist just to satisfy a template.
8. **Keep facts and teaching examples separate.** Label invented rows and scenarios as teaching data. Do not invent customer stories, performance numbers, product behavior or first-hand experience. Verify product claims against current Snowflake documentation and cite the relevant source next to the explanation.
9. **Write like a technical author.** Prefer direct Chinese prose, specific nouns and verbs, and paragraphs that explain cause and consequence. Remove prompt instructions, self-description, generic disclaimers, repeated summaries, artificial transitions and phrases that talk about “this tutorial” rather than teach the subject.
10. Before finalizing, apply `skills/unslop/SKILL.md` to the Chinese prose. Preserve technical terminology, source attribution, figures, conditions, exceptions and uncertainty. The skill changes expression, not Snowflake semantics.

A useful review question is: could a reader reproduce the example, recognize the failure in their own system, and explain why the corrected design works? If not, the article is not ready even when every required heading is present.

## Hard quality gate before publishing a lesson

This is a content gate, not a formatting checklist. Every new or substantially rewritten lesson must pass all of the following. If any critical item is missing, do not publish the article as complete.

### Research and scope
- Read the exact KnowledgeNode, its required concepts, course module mapping, existing neighboring lessons and relevant source material before drafting. The node's required concepts define what the lesson must teach. Its angles describe question-bank coverage dimensions, not a mandatory article outline; use only the angles that genuinely help explain this topic, and never force every angle into the lesson.
- Write down the one concrete learner problem the article solves. Confirm that each core section belongs to this node; do not pad it with generic Snowflake, AI, governance or data-engineering material.
- Verify every Snowflake-specific behavior against the current official documentation. Distinguish product facts, engineering recommendations and teaching assumptions.

### Technical explanation
- Explain the mechanism, not just the product feature name. Describe what is stored/executed/compared, when it applies, what it does not do, and how the behavior can be observed.
- Include one complete example that belongs to this topic: input data or request, SQL/code/configuration, resulting output and interpretation. For conceptual topics, use a concrete case, decision table or counterexample when code is not meaningful.
- Use internally consistent sample data. Recalculate sample outputs; check SQL syntax, column names, data types, join cardinality and time semantics.
- Explain at least one plausible failure or wrong implementation, why it fails, and how to diagnose or correct it.
- Make implementation guidance executable. Name the object, command/query or evidence to inspect; explain a normal result, a failure signal and the next step.

### Editorial rejection tests
- Reject generic openers, self-referential tutorial prose, filler introductions, generic scenarios, template self-tests and paragraphs copied across unrelated nodes.
- Do not reuse a paragraph merely because the current node shares courseId, topic, product or audience with another node. Reuse only stable facts or genuinely shared definitions, and link to the canonical lesson where appropriate.
- Do not force every article to have the same count of subsections, steps, tables, diagrams, misconceptions or questions. A heading is not content.
- Do not add code, Mermaid, tables, bullet lists or word count solely to satisfy an audit. Every artifact must explain or verify a point that prose alone would make harder to understand.
- Ask whether a paragraph could be pasted into an unrelated lesson unchanged. If yes, replace it with a topic-specific explanation or remove it.
- Self-tests must require reasoning about the article's own example, output, trade-off or failure mode. Questions that merely restate a heading are not acceptable.
- Do not call a source verified because its URL looks official. Open the source and confirm it supports the specific behavior stated; keep unknown or version-dependent behavior explicit.

### Final review
1. Read the whole article from the learner's perspective; do not audit only headings or keyword matches.
2. Trace every important claim to a source or clearly labeled teaching assumption.
3. Run sample SQL/code mentally or in a real test environment where possible; verify arithmetic and expected output.
4. Check that the core explanation is not repeated in the implementation, scenario and misconception sections.
5. Apply skills/unslop/SKILL.md to expression after the substantive content is correct.
6. Only then update manifest metadata and mark references as verified. If the article still feels like a prompt answer assembled from stock paragraphs, rewrite it before publishing.
## Source and schema requirements

Every new canonical question must include `courseId: "snowflake"`, `knowledgeId` equal to a valid knowledge node ID, and `topic` equal to that same `KnowledgeNode.id`. Do not put the shared `KnowledgeNode.topic` classification into `Question.topic`. Also include `source.materialId` and `source.section` for its primary course/module, and `source.relatedMaterials` for authoritative documentation cross-checks. Use a globally unique question ID, a valid `angle`, and both `formats.choice` and `formats.open`.

Choice questions must contain 4–6 balanced options. Answer indexes must be in range. `misconceptionMap` must have the same length as `options`; every correct option maps to `null`, and any numeric map entry must index a valid question-level misconception.

Every knowledge node must include `courseId: "snowflake"`, `area: "data-platform"`, a globally unique kebab-case `id`, a topic registered in `SNOWFLAKE_COURSE_TOPICS`, nonempty summary/required/misconceptions/angles, and at least one supporting question.

## Authoring procedure

1. Choose a course and publicly visible module/learning objective. Capture its focus in a short paraphrase.
2. Confirm the technical claim against a current Snowflake official document. Where relevant, verify edition/feature support and avoid absolute performance or SLA claims.
3. Model an assessable knowledge unit covering mechanism, constraints, choice criteria, common failure modes and verification evidence.
4. Write scenario-based questions that assess implementation choices, operational trade-offs, data correctness and root-cause diagnosis—not trivia about product names.
5. Store the course module in `source.materialId`/`source.section`, and the official documentation ID in `source.relatedMaterials`. Keep the URL-to-ID map in `docs/snowflake-course-roadmap.md`.
6. Give open questions a reference answer with decision rationale and failure-mode boundaries. Align the choice and open answer semantically.
7. Update the knowledge node, question file, course theme labels, roadmap mapping and any relevant taxonomy/content test together.
8. Keep Snowflake-specific Cortex/Agent/CoCo themes under Snowflake even though their names overlap AI concepts. Curriculum ownership is determined by `courseId`, not by whether a feature uses a language model.
9. Run checks when requested/available. Do not claim tests, typecheck, CI or build passed unless they actually ran. Record unverified claims as open gaps rather than guessing.

## Output contract

Produce the changed node/question JSON, roadmap updates, a mapping from course module → knowledge IDs → question IDs, and a concise list of any technical claims that still need verification.


## Large-batch coverage and question quality

For the 8-course Snowflake roadmap, keep course/module attribution explicit and use a coverage matrix rather than relying on tags alone. The current 300-question expansion has 60 knowledge nodes × 5 questions and distributes questions by actual course coverage. For future batches:

1. Identify uncovered objectives from the course modules and split broad nodes where they hide distinct operational competencies; do not manufacture new nodes solely to hit a target count.
2. Author different assessment intents for each knowledge unit (mechanism, design, diagnosis, trade-off, acceptance/runbook) and customize scenario, correct reasoning, distractors, explanation and reference answer to the product behavior.
3. Require evidence after every recommendation: relevant official doc ID, scenario constraints, validation query/test, failure/recovery boundary. Avoid treating a successful SQL status as proof of correct data.
4. Test uniqueness on normalized question stems and assessment intent. Rewording the same decision with a different noun is not a new canonical question.
5. Generate a course → module → knowledge ID → question ID matrix and reconcile counts from actual question JSON before publishing.
6. A static generator check is not a substitute for `question:add -- --check`, schema validation, all-bank duplicate/identity checks, typecheck, tests or build. Record which checks truly ran.


## Certification-exam coverage

When adding Snowflake certification practice, use the current official SnowPro exam study guide for the authoritative Domain/Objectives/weightings, and use third-party free practice banks only to discover commonly covered topics and question formats. Do not copy their question stems, answer options, explanations, or dumps. Author new questions and verify each technical proposition against Snowflake documentation.

- Store the official Domain and Objective in question tags (for example, `exam-domain-3`, `exam-objective-3-1`).
- Keep the main Coursera source in `source.materialId` and `source.section`; add exam-guide and official-doc IDs in `source.relatedMaterials`.
- Distinguish explicit exam-guide objectives from course-adjacent material. In particular, do not present a course tool as an explicit exam objective unless the official guide names it.
- For large exam-aligned batches, calculate the exact question count by official domain weight, then validate the per-domain distribution, easy/medium difficulty, source IDs, answer indexes, and duplicate stems before committing.


## Snowflake Developer Guides authoring rules

- 从 [Snowflake Developer Guides](https://www.snowflake.com/en/developers/guides/) 发现 Quickstart、参考架构和 Well-Architected 主题；详细产品行为应核对具体指南及其链接的官方产品文档。
- 在 `docs/snowflake-course-roadmap.md` 中记录稳定 Guide ID 和 canonical URL 后，才能在题目的 `source.materialId` / `source.relatedMaterials` 使用。
- 优先编写架构选择、适用边界、生产故障、权限、可观测性和验收证据题；避免把教程中的变量名或命令文本当作孤立记忆题。
- 区分示例与普遍保证。对于区域/Edition/Preview/运行时依赖、延迟和费用的断言，应核对当前文档和目标账户，不要把 Quickstart 的性能描述直接当生产 SLA。
- CoCo/Agent 生成物是候选方案；要验证权限、秘密信息、SQL 语义、JOIN 基数、数据对账、Query Profile 和回归结果。
- Semantic View/Agent 发布应分别评测语义模型和 Agent 行为，门禁需要阻止不合格版本晋级；候选视图/dashboard 应与生产资源隔离。
- 保持 `courseId: "snowflake"` 独立课程边界，不将 Snowflake 专属主题加入 AI 六大能力域。


## Cross-platform database training source

- Reference: [Snowflake-Labs/postgres-full-day-training](https://github.com/Snowflake-Labs/postgres-full-day-training), source ID `postgres-full-day-training`. It is a PostgreSQL course; use its public module structure only to identify transferable SQL, data correctness, troubleshooting, monitoring and performance learning objectives.
- Do not carry PostgreSQL implementation-specific behavior into Snowflake questions. WAL, VACUUM, `shared_buffers`, `work_mem`, `pg_stat_*` catalogs and traditional PostgreSQL index advice must not be stated as Snowflake features.
- Reframe the learning objectives using Snowflake-native concepts such as Time Travel and cloning, COPY/Snowpipe, Streams/Tasks/Dynamic Tables, Query History/Profile, warehouse sizing and concurrency, micro-partition pruning, clustering, Search Optimization and Resource Monitor. Cross-check product behavior against the official document IDs in `docs/snowflake-course-roadmap.md`.
- Keep `source.materialId: "postgres-full-day-training"`, record the exact public source module in `source.section`, and list the relevant Snowflake documentation IDs in `source.relatedMaterials`. Do not imply the PostgreSQL material itself documents Snowflake behavior.


## Native PostgreSQL module inside the Snowflake learning track

- The Snowflake track includes a separately labelled PostgreSQL database-engineering supplement because the user requested both subjects under the same course entry. Its questions keep `courseId: "snowflake"`, but use `topic: "postgresql"` on knowledge nodes, PostgreSQL-specific concepts, `postgres-full-day-training` as source material and PostgreSQL official documentation IDs in `source.relatedMaterials`.
- This native module is deliberately separate from Snowflake-native questions adapted from PostgreSQL training themes. In this module, PostgreSQL semantics such as MVCC, WAL, VACUUM, `pg_stat_activity`, B-tree/GIN/GiST/BRIN indexes and PgBouncer are taught as PostgreSQL concepts—not as Snowflake features.
- Use the PostgreSQL 18 documentation as the main authority for version-specific details, while recognizing the upstream training repo describes compatibility with PostgreSQL 14+. Mark version-specific features explicitly; for example, `UNIQUE NULLS NOT DISTINCT` is available from PostgreSQL 15, not introduced in 18.
- Keep the module's twenty topic-specific knowledge IDs and question IDs in its coverage matrix. Do not collapse them into the generic Snowflake topic or map PostgreSQL answers to Snowflake product behavior.
