---
name: verify-question-correctness
description: >
  Verify the factual, mathematical, logical, and technical correctness of
  interview questions and answer options. Use independent solving, claim
  decomposition, evidence retrieval, scope/assumption analysis, option-level
  verification, answer-set verification, and adjudication. This skill is
  report-first and must not silently modify the question bank.
---

# Verify Question Correctness

## Purpose

This skill verifies whether an interview question is technically, logically,
mathematically, and factually correct.

It is a correctness-verification layer.

It is NOT a question-generation skill.
It is NOT a wording-polishing skill.
It is NOT a duplicate detector.
It is NOT a replacement for `questionChallenger`.

The goal is to detect errors that structural validation and ordinary
question-quality heuristics cannot reliably detect, including:

- wrong answer keys
- mathematically false claims
- technically false claims
- invalid assumptions
- impossible premises
- missing conditions that change the answer
- multiple valid choices in a single-choice question
- no valid choices in a multiple-choice question
- explanations that contradict the actual theory
- complexity claims that are wrong
- causal claims with reversed direction
- implementation details that depend on version/configuration
- outdated claims about models, APIs, libraries, or frameworks
- statements that are only conditionally true but are presented as universal
- subtle distractors that are actually correct
- distractors that are incorrect for the wrong reason
- internally inconsistent question premises

The skill must prefer uncertainty over fabricated certainty.

---

# 1. Core Principles

## 1.1 Answer-key independence

Never verify a question by reading the stored answer key first and then
reasoning toward it.

The verification process MUST attempt to solve the question independently
before comparing the result against the stored answer.

Correct order:

1. Read question and options.
2. Identify what is being asked.
3. Extract relevant claims and assumptions.
4. Solve independently.
5. Verify each option independently.
6. Determine the independently supported answer set.
7. Compare with the stored answer key.
8. Inspect explanation.
9. Produce verdict.

Incorrect order:

1. Read answer key.
2. Assume answer is correct.
3. Find evidence supporting the answer.
4. Ignore contradictory evidence.

This rule is mandatory.

---

## 1.2 Every option is independently testable

For choice questions, every option must be independently evaluated.

Use:

- `SUPPORTED`
- `REFUTED`
- `CONDITIONAL`
- `INSUFFICIENT`
- `CONFLICTING`

Never use "wrong" merely because an option is not the stored answer.

For example:

```text
A: SUPPORTED
B: REFUTED
C: CONDITIONAL
D: REFUTED
