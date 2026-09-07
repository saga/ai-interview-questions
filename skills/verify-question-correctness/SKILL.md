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

## 1. Purpose

This skill verifies whether an interview question is technically, logically,
mathematically, and factually correct.

It is a correctness-verification layer.

It is NOT:

* a question-generation skill
* a wording-polishing skill
* a duplicate detector
* a coverage checker
* a replacement for `questionChallenger`
* a replacement for deterministic schema validation
* an automatic question-repair system

The purpose is to catch semantic correctness failures that structural
validation and ordinary question-quality heuristics cannot reliably detect.

Typical defects include:

* wrong answer key
* materially false technical fact
* mathematically false statement
* invalid theorem application
* impossible premise
* missing condition that changes the answer
* multiple valid answers in a single-choice question
* no valid answer
* explanation contradicting the answer
* explanation relying on a false premise
* complexity claim being wrong
* causal direction being reversed
* theory being confused with implementation behavior
* implementation/API claim being outdated
* version-sensitive behavior being presented as universal
* empirical result being presented as a guarantee
* distractor that is actually correct under the stated assumptions

The skill must prefer uncertainty over fabricated certainty.

---

## 2. Relationship to Existing Quality Checks

The repository already has separate validation layers.

### 2.1 Deterministic validation

Owns:

* schema correctness
* required fields
* answer index validity
* single/multiple choice cardinality
* structural consistency
* machine-checkable contracts

This skill MUST NOT duplicate those checks as primary correctness signals.

### 2.2 `questionChallenger`

Owns:

* whether the question is a good assessment
* self-containment
* sufficiency
* logic as an assessment
* distractor quality
* explanation quality
* assessment quality
* retrieval readiness

A question can be a very good assessment but factually wrong.

Therefore:

```text
Good Question != Correct Question
```

### 2.3 This skill

Owns:

* factual correctness
* mathematical correctness
* logical correctness
* technical correctness
* answer-key correctness
* option correctness
* explanation correctness
* assumption/scope correctness
* version/API correctness
* current-information correctness

The overall pipeline is:

```text
Question
   │
   ├── deterministic validation
   │
   ├── questionChallenger
   │
   └── verify-question-correctness
            │
            ▼
        human review
```

Do not merge these responsibilities.

---

## 3. Core Principles

### 3.1 Independent solve before answer-key inspection

The verifier MUST solve the question independently before using the stored
answer as an input to reasoning.

Required order:

```text
question + options
    ↓
independent understanding
    ↓
independent solution
    ↓
option verification
    ↓
verified answer set
    ↓
compare with stored answer
```

Do NOT use:

```text
stored answer
    ↓
explanation
    ↓
reasoning toward stored answer
```

This is mandatory because answer-key anchoring can turn a wrong answer key into
a seemingly convincing justification.

### 3.2 Verify every option independently

For choice questions every option must be evaluated independently.

Allowed statuses:

```text
SUPPORTED
REFUTED
CONDITIONAL
INSUFFICIENT
CONFLICTING
```

Do not infer:

```text
not stored answer => false
```

For example:

```text
A: REFUTED
B: SUPPORTED
C: CONDITIONAL
D: REFUTED
```

may indicate that a single-choice question is under-constrained.

### 3.3 Do not force binary truth

A technical claim may depend on:

* version
* implementation
* configuration
* architecture
* parameter regime
* task definition
* training objective
* data distribution
* deployment environment
* hardware
* numerical precision

Therefore a claim that is not universally true may be:

```text
CONDITIONAL
```

instead of being incorrectly marked as:

```text
SUPPORTED
```

or:

```text
REFUTED
```

### 3.4 Evidence is distinct from confidence

The verifier MUST distinguish:

```text
reasoning
evidence
confidence
```

A high-confidence statement without evidence is not equivalent to a verified
statement.

Do not invent citations, URLs, benchmarks, paper results, specifications, or
implementation details.

### 3.5 Search for support and refutation

For uncertain or high-risk claims, evidence collection MUST attempt both:

```text
supporting evidence
contradicting evidence
```

Useful search patterns include:

```text
claim
claim + limitation
claim + exception
claim + counterexample
claim + failure case
claim + misconception
```

Do not perform confirmation-only research.

---

## 4. Verification Workflow

The canonical workflow is:

```text
1. Preflight
2. Claim extraction
3. Independent solve
4. Assumption analysis
5. Option-by-option verification
6. Answer-set derivation
7. Evidence verification
8. Mathematical / logical audit
9. Explanation verification
10. Adjudication
11. Final verdict
```

These stages may be combined internally for efficiency, but the final result
must contain enough information to reconstruct the reasoning.

---

## 5. Stage 1 — Preflight

Read:

* question id
* category
* topic
* subtopic
* difficulty
* angle
* cognitiveTask
* concepts
* assessment
* question text
* options
* stored answer
* explanation
* source metadata if available

Determine the risk profile.

Potential claim classes include:

```text
DEFINITION
FACT
THEOREM
EQUATION
ALGORITHM
COMPLEXITY
CAUSAL
COMPARATIVE
EMPIRICAL
IMPLEMENTATION
API
VERSION_DEPENDENT
BEST_PRACTICE
ARCHITECTURAL
PREDICTION
```

Do not treat topic name alone as a risk signal.

---

## 6. Stage 2 — Claim Extraction

Extract all material claims from:

* the question
* every option
* the explanation
* the reference answer for open questions

Example:

```text
Question:
"LoRA freezes the base model, trains low-rank matrices, and therefore
always reduces inference latency."

Claims:

C1:
The base model parameters are frozen.

C2:
LoRA trains low-rank matrices.

C3:
LoRA always reduces inference latency.
```

Each material claim should have its own verification state.

Do not evaluate the entire question as one indivisible assertion.

---

## 7. Stage 3 — Independent Solve

For choice questions, determine:

```text
independentAnswerSet
```

without relying on the stored answer.

For open questions, determine:

```text
independentExpectedAnswer
```

and list the minimum technically required concepts or conclusions.

The independent solution should contain enough reasoning to justify the result.

For difficult questions explicitly consider:

```text
What assumption does this answer depend on?
Could another option also be correct?
Can I construct a counterexample?
What edge case breaks this statement?
```

---

## 8. Stage 4 — Assumption Analysis

Check whether the question contains all assumptions required for the expected
answer.

Potential missing assumptions:

* input domain
* data distribution
* task definition
* model architecture
* training objective
* optimization setting
* parameter values
* randomization
* implementation
* framework version
* hardware
* numerical precision
* asymptotic regime
* batch size
* evaluation metric
* deployment environment

Example:

```text
"Algorithm A is faster than Algorithm B."
```

may require:

```text
input size
hardware
implementation
batch size
asymptotic vs empirical interpretation
```

If the missing assumption can change the answer, the question is not safely
verified.

---

## 9. Stage 5 — Option Verification

For each option independently produce:

```text
status
reason
claimIds
confidence
evidenceIds
```

Example:

```json
{
  "index": 2,
  "status": "CONDITIONAL",
  "reason": "The claim is true only when X is assumed, but X is not stated.",
  "claimIds": ["C4"],
  "confidence": 0.91,
  "evidenceIds": ["E2"]
}
```

The verifier must not infer option validity solely from elimination.

---

## 10. Choice Question Rules

### 10.1 Single choice

The correct assessment must result in exactly one clearly supported option.

Invalid states include:

```text
0 supported options
2+ supported options
1 supported + another option valid under the question's actual assumptions
```

The stored key must match the independently verified answer.

### 10.2 Multiple choice

The verified answer set must equal:

```text
all and only the supported options
```

Compare:

```text
storedAnswerSet
vs
verifiedAnswerSet
```

Any material mismatch is a correctness issue.

---

## 11. Stage 6 — Evidence Retrieval

External evidence should be used when:

* claim is non-trivial
* claim is disputed
* claim is surprising
* model knowledge may be stale
* implementation behavior matters
* version matters
* quantitative result is claimed
* paper-specific result is claimed
* absolute wording is used
* verifier confidence is low
* independent verifiers disagree

Stable elementary facts do not require web verification every time.

---

## 12. Evidence Hierarchy

Prefer evidence in this order:

### Tier 1 — Primary authoritative evidence

* original research paper
* official specification
* official API documentation
* official framework documentation
* official model card
* official technical report
* source code of the relevant implementation
* standards
* formal theorem / established textbook source

### Tier 2 — Strong technical evidence

* peer-reviewed paper
* major conference paper
* university material
* authoritative engineering documentation

### Tier 3 — Secondary technical evidence

* reputable technical article
* expert technical explanation

### Tier 4 — Discovery-only sources

* forums
* Reddit
* Stack Overflow
* social media
* ordinary blogs

Tier 4 can provide leads but should not be the sole evidence for a
high-confidence P0 correctness decision.

---

## 13. Current / Version-sensitive Claims

For claims involving:

* libraries
* frameworks
* APIs
* models
* model capabilities
* defaults
* package behavior
* benchmark results
* recent research
* deprecated behavior
* current best practices

use current authoritative sources.

Record:

```text
source
url
title
publishedAt if available
checkedAt
version if relevant
```

A claim that is true only for a particular version must not be rewritten mentally
as a timeless fact.

---

## 14. Mathematical Verification

Mathematical claims require more than semantic plausibility.

For a mathematical claim:

1. Formalize the claim.
2. Identify definitions.
3. Check all assumptions.
4. Derive the result.
5. Check edge cases.
6. Attempt a counterexample.
7. Compare against authoritative evidence where useful.

Pay special attention to:

```text
equality
inequality
rank
eigenvalues
probability
expectation
variance
convergence
optimization
complexity
theorem conditions
iff / equivalence
necessary / sufficient
```

For universal statements, actively attempt to construct a counterexample.

Example:

```text
"For all x, P(x)"
```

should trigger:

```text
Can I find x such that P(x) is false?
```

One valid counterexample refutes a universal claim.

---

## 15. Complexity Verification

For complexity claims verify:

* input dimensions
* dominant operation
* sequence length
* hidden dimension
* vocabulary size
* number of layers
* training vs inference
* dense vs sparse representation
* asymptotic vs empirical complexity

Do not confuse:

```text
parameter count
memory
compute
latency
throughput
```

These are distinct properties.

---

## 16. AI / ML Technical Verification

Distinguish:

```text
theoretical property
algorithmic property
implementation behavior
empirical result
engineering heuristic
benchmark result
```

Dangerous patterns include:

```text
always improves
always reduces
eliminates
guarantees
prevents
best
optimal
strictly better
works for all models
```

Examples requiring careful qualification:

```text
"RAG eliminates hallucinations."
"Quantization always reduces latency."
"LoRA always improves performance."
"Chain-of-thought improves every reasoning task."
"Model X is better than Model Y."
```

---

## 17. Explanation Verification

Verify the explanation independently.

Check:

```text
question
answer
explanation
```

for mutual consistency.

Look for:

* explanation proves a different option
* explanation contains a false premise
* explanation silently adds assumptions
* explanation contradicts the question
* explanation only explains one part of a multiple-choice answer
* explanation uses an invalid theorem
* explanation reaches the right answer for the wrong reason

A correct answer with a materially false explanation is still a correctness
problem.

---

## 18. Anti-bias Requirements

The verifier must actively avoid:

### 18.1 Answer-key anchoring

Do not use the stored answer as the starting point.

### 18.2 Position bias

Do not prefer A/B/C/D based on position.

### 18.3 Verbosity bias

Do not treat a longer explanation as more correct.

### 18.4 Confirmation bias

Do not search only for supporting evidence.

### 18.5 Authority hallucination

Do not fabricate sources.

### 18.6 Model-memory overconfidence

Do not treat model memory as authoritative for version-sensitive facts.

### 18.7 Explanation contamination

When practical, independently solve before reading the explanation.

---

## 19. Independent Second Verifier

Use a second independent verification pass when:

* first confidence < 0.85
* P0 is suspected
* mathematics is non-trivial
* answer key and independent solve disagree
* multiple options appear plausible
* evidence conflicts
* API/version behavior is uncertain
* strong universal language is present

Interpretation:

```text
same conclusion
    ↓
higher confidence

different conclusion
    ↓
adjudication
```

Do not blindly average contradictory reasoning.

---

## 20. Adjudication

The adjudicator should inspect:

1. original question
2. independent solution
3. option-level verdicts
4. claims
5. assumptions
6. evidence
7. source authority
8. stored answer
9. explanation

Final action:

```text
KEEP
FIX
REVIEW
REJECT
```

### KEEP

The question is sufficiently supported and no material correctness problem
remains.

### FIX

A correctness problem exists but the assessment can be repaired.

Examples:

* wrong answer key
* wrong formula
* missing assumption
* outdated API statement
* incorrect option wording

### REVIEW

Evidence or reasoning remains materially uncertain.

Examples:

* conflicting authoritative sources
* unresolved implementation detail
* genuinely ambiguous conditions
* verifier disagreement

### REJECT

The assessment itself is fundamentally unsound.

Examples:

* impossible premise
* no defensible answer
* irreducible ambiguity
* question depends on an unstated interpretation that cannot be normalized

---

## 21. Severity

### P0 — Critical correctness error

Use P0 for:

* wrong answer key
* materially false technical claim
* mathematically false result
* invalid theorem application
* impossible premise
* single-choice question with multiple valid answers
* single-choice question with no valid answer
* materially wrong multiple-choice answer set
* explanation proving a wrong answer
* security-critical false claim

P0 MUST NOT be silently accepted.

### P1 — Material correctness / validity issue

Examples:

* missing assumption changes the answer
* important version drift
* API behavior incorrectly generalized
* ambiguous technical condition
* important causal direction error
* materially misleading explanation
* conditional claim stated as universal

### P2 — Minor precision issue

Examples:

* terminology imprecision
* secondary caveat omitted
* minor wording nuance that does not change the answer

P2 does not necessarily require removal.

---

## 22. Verdict Model

Question-level:

```text
VERIFIED
CONDITIONAL
NEEDS_REVIEW
INCORRECT
```

Claim / option-level:

```text
SUPPORTED
REFUTED
CONDITIONAL
INSUFFICIENT
CONFLICTING
```

Action:

```text
KEEP
FIX
REVIEW
REJECT
```

Do not collapse these into a single boolean.

---

## 23. Confidence

Suggested interpretation:

```text
0.95–1.00  very high
0.85–0.94  high
0.70–0.84  medium
0.50–0.69  low
<0.50       very low
```

Confidence should consider:

* evidence quality
* reasoning complexity
* source authority
* verifier agreement
* assumption ambiguity
* version sensitivity

Confidence alone is never a correctness guarantee.

---

## 24. Output Schema

Return JSON matching this structure:

```json
{
  "questionId": "string",
  "verdict": "VERIFIED|CONDITIONAL|NEEDS_REVIEW|INCORRECT",
  "action": "KEEP|FIX|REVIEW|REJECT",
  "severity": "P0|P1|P2|null",
  "confidence": 0.0,
  "format": "single|multiple|open",
  "independentAnswer": [],
  "storedAnswer": [],
  "answerAgreement": true,
  "claims": [
    {
      "id": "C1",
      "text": "string",
      "type": ["FACT"],
      "status": "SUPPORTED|REFUTED|CONDITIONAL|INSUFFICIENT|CONFLICTING",
      "confidence": 0.0,
      "reason": "string",
      "evidenceIds": []
    }
  ],
  "options": [
    {
      "index": 0,
      "status": "SUPPORTED|REFUTED|CONDITIONAL|INSUFFICIENT|CONFLICTING",
      "reason": "string",
      "claimIds": [],
      "evidenceIds": []
    }
  ],
  "assumptions": [
    {
      "text": "string",
      "required": true,
      "presentInQuestion": true
    }
  ],
  "explanation": {
    "status": "SUPPORTED|REFUTED|CONDITIONAL|INSUFFICIENT|CONFLICTING",
    "reason": "string",
    "evidenceIds": []
  },
  "issues": [
    {
      "severity": "P0|P1|P2",
      "type": "ANSWER_KEY|FACT|MATH|LOGIC|AMBIGUITY|OUTDATED|EXPLANATION|OPTION",
      "description": "string"
    }
  ],
  "evidence": [
    {
      "id": "E1",
      "title": "string",
      "source": "string",
      "url": "string",
      "authority": "PRIMARY|SECONDARY|DISCOVERY",
      "supports": [],
      "refutes": [],
      "checkedAt": "string",
      "publishedAt": "string|null"
    }
  ],
  "reviewerNotes": "string",
  "checkedAt": "string"
}
```

Do not invent fields outside this schema unless the repository explicitly
extends the contract.

---

## 25. Open Questions

For open questions there is no option answer set.

Verify:

* technical correctness of the reference answer
* correctness of required concepts
* important missing caveats
* unstated assumptions
* explanation correctness

Do not require the learner's wording to match the reference answer literally.

Correctness matters more than wording identity.

---

## 26. Batch Verification Strategy

Do NOT run expensive web/evidence verification over every question by default.

Use risk-based triage.

### Tier A — Deterministic preflight

All questions.

The preflight may detect:

* claims likely requiring verification
* suspicious universal wording
* mathematical expressions
* quantitative claims
* API/version terms
* empirical comparisons
* explicit guarantees
* current-product/model claims
* internal answer/explanation contradictions when detectable

These signals prioritize work; they do not determine correctness.

### Tier B — Semantic verification

Prioritize questions with genuine correctness-risk signals.

Preferred order:

1. suspicious internal contradiction
2. answer/explanation disagreement
3. non-trivial mathematics/theorem claims
4. complexity claims
5. version/API/implementation claims
6. current model behavior
7. empirical/quantitative claims
8. strong universal/guarantee claims
9. disputed architecture claims
10. random calibration sample

### Tier C — Independent second verifier

Use for hard or uncertain cases.

### Tier D — Human review

Required for:

* P0
* unresolved evidence conflict
* persistent verifier disagreement
* subtle mathematical disputes
* ambiguous assessment intent

---

## 27. Candidate Triage Requirements

The companion candidate scanner is a triage tool.

It MUST NOT claim to verify correctness.

Its job is to reduce:

```text
all questions
```

to a smaller:

```text
correctness verification worklist
```

The scanner MUST NOT:

* mark a question incorrect
* modify the question bank
* duplicate schema validation as its main signal
* assign high risk merely because a question is AI-related
* assign high risk merely because difficulty is hard
* treat every mathematical word as evidence of an error

Risk is a prioritization mechanism, not a truth judgment.

---

## 28. Risk Scoring Principles

A useful candidate signal should answer:

> "Why is this question more likely to require semantic correctness
> verification?"

Good examples:

```text
universal claim + empirical conclusion
version-sensitive API claim
quantitative benchmark
theorem/equation claim
internal answer/explanation contradiction
causal claim
necessary/sufficient wording
explicit guarantee
current model behavior
```

Poor examples:

```text
topic = LLM
difficulty = hard
question contains "AI"
question contains "RAG"
question contains "agent"
```

The latter are not correctness-risk evidence for this question bank.

---

## 29. Internal Consistency Signals

Candidate triage should prefer strong local signals when available:

* answer key mentioned by explanation but inconsistent
* explanation identifies an option different from stored key
* multiple choice answer indexes duplicated or malformed
* explanation uses contradictory terminology
* question says "single" but semantic evidence suggests multiple answers
* stored answer and reference conclusion disagree

Deterministic schema errors remain owned by schema validation, but semantic
contradiction signals may still be escalated.

---

## 30. Do Not Auto-edit

Version 1 of this skill is report-only.

It may recommend:

```text
FIX ANSWER KEY
FIX OPTION
ADD ASSUMPTION
REWRITE CLAIM
UPDATE SOURCE
REMOVE QUESTION
```

but MUST NOT modify source files automatically.

Semantic verification can itself be wrong.

Automatic repair should be a separate future skill.

---

## 31. Gold Set / Calibration

Maintain a small manually verified set of representative questions.

Recommended categories:

* mathematics
* ML theory
* LLM fundamentals
* agents
* systems
* API/version-sensitive
* single-choice
* multiple-choice
* open questions
* tricky distractors
* ambiguous-looking but valid questions

Suggested initial size:

```text
30–100 questions
```

Use this set to calibrate triage and verifier prompts.

It is not a replacement for authoritative evidence.

---

## 32. Quality Target

The goal of triage is not maximum recall at any cost.

Target:

```text
small enough worklist to verify deeply
+
low enough false-negative rate that random calibration catches blind spots
```

A candidate rate near 80% indicates the triage model is not useful.

The scanner should normally produce a substantially smaller worklist while
keeping a random calibration sample.

---

## 33. Failure Policy

Never fabricate:

* sources
* URLs
* citations
* benchmarks
* API behavior
* theorem results
* model capabilities
* implementation details

Use:

```text
INSUFFICIENT
```

when evidence is not sufficient.

Use:

```text
CONFLICTING
```

when authoritative evidence genuinely conflicts.

Do not silently choose whichever source confirms the expected answer.

---

## 34. Final Acceptance Rule

A question may be marked `VERIFIED` only when:

1. independent solving agrees with the stored answer where applicable
2. all options are accounted for
3. material claims have no unresolved contradiction
4. assumptions required for correctness are present or harmless
5. explanation is consistent with the verified answer
6. required evidence has been checked
7. confidence is appropriate for the risk level

Otherwise use:

```text
CONDITIONAL
NEEDS_REVIEW
INCORRECT
```

The verifier is an evidence-producing system, not an oracle.

Human review remains the final authority for P0 and unresolved cases.
