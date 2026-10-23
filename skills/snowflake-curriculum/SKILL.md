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

## Source and schema requirements

Every new canonical question must include `courseId: "snowflake"`, `knowledgeId` equal to a valid knowledge node ID, `source.materialId` and `source.section` for its primary course/module, and `source.relatedMaterials` for authoritative documentation cross-checks. Use a globally unique question ID, a valid `angle`, and both `formats.choice` and `formats.open`.

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
