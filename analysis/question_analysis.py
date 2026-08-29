"""Optional Python analysis for question-bank curation.

Install with ``uv sync --extra analysis``. The heavier semantic model is only
loaded when ``--semantic`` is explicitly requested.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Literal

import networkx as nx
import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict
from rapidfuzz import fuzz
from sklearn.cluster import KMeans
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import LabelEncoder


ROOT = Path(__file__).resolve().parents[1]
QUESTIONS_DIR = ROOT / "src" / "data" / "questions"
KNOWLEDGE_DIR = ROOT / "src" / "data" / "knowledge"
CONCEPT_GRAPH_FILE = ROOT / "src" / "data" / "conceptGraph.json"
LOCAL_MODEL_DIR = ROOT / "analysis" / "models" / "paraphrase-multilingual-MiniLM-L12-v2"
QUANTIZED_MODEL_FILE = "onnx/model_qint8_arm64.onnx"


class QuestionRecord(BaseModel):
    """Small Python-side adapter; TypeScript/Zod remains the canonical schema."""

    model_config = ConfigDict(extra="allow")

    id: str
    category: str
    topic: str
    difficulty: Literal["easy", "medium", "hard"]
    angle: str | None = None
    question: str


def read_arrays(directory: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            records.extend(item for item in payload if isinstance(item, dict))
    return records


def read_concept_graph() -> list[dict[str, str]]:
    payload = json.loads(CONCEPT_GRAPH_FILE.read_text(encoding="utf-8"))
    return payload.get("edges", []) if isinstance(payload, dict) else []


def build_frame(records: list[QuestionRecord]) -> pd.DataFrame:
    return pd.DataFrame([record.model_dump() for record in records])


def fuzzy_duplicate_candidates(texts: list[str], threshold: int) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for left in range(len(texts)):
        for right in range(left + 1, len(texts)):
            score = fuzz.ratio(texts[left], texts[right])
            if score >= threshold:
                candidates.append({"left": left, "right": right, "score": round(score, 2)})
    return sorted(candidates, key=lambda item: -item["score"])


def text_features(texts: list[str]) -> tuple[Any, Any]:
    vectorizer = TfidfVectorizer(analyzer="char", ngram_range=(2, 5), min_df=1, max_features=12_000)
    return vectorizer, vectorizer.fit_transform(texts)


def cluster_report(texts: list[str], ids: list[str]) -> list[dict[str, Any]]:
    _, matrix = text_features(texts)
    cluster_count = min(8, max(2, len(texts) // 80))
    labels = KMeans(n_clusters=cluster_count, n_init=10, random_state=42).fit_predict(matrix)
    grouped: defaultdict[int, list[str]] = defaultdict(list)
    for question_id, label in zip(ids, labels):
        grouped[int(label)].append(question_id)
    return [{"cluster": label, "size": len(values), "questionIds": values[:20]} for label, values in sorted(grouped.items())]


def difficulty_predictability(frame: pd.DataFrame) -> dict[str, Any]:
    if frame["difficulty"].value_counts().min() < 2:
        return {"status": "skipped", "reason": "each difficulty needs at least two questions"}
    labels = LabelEncoder().fit_transform(frame["difficulty"])
    folds = min(5, int(frame["difficulty"].value_counts().min()))
    pipeline = make_pipeline(
        TfidfVectorizer(analyzer="char", ngram_range=(2, 5), min_df=1, max_features=12_000),
        LogisticRegression(max_iter=500, random_state=42),
    )
    predictions = cross_val_predict(pipeline, frame["question"], labels, cv=StratifiedKFold(folds, shuffle=True, random_state=42))
    return {
        "status": "ok",
        "accuracy": round(float(accuracy_score(labels, predictions)), 4),
        "baseline": round(float(frame["difficulty"].value_counts(normalize=True).max()), 4),
        "interpretation": "high accuracy can indicate lexical difficulty cues or label leakage; it is not a quality score",
    }


def graph_report(frame: pd.DataFrame, nodes: list[dict[str, Any]], edges: list[dict[str, str]]) -> dict[str, Any]:
    graph = nx.DiGraph()
    graph.add_nodes_from(node["id"] for node in nodes)
    for edge in edges:
        if edge.get("type") in {"prerequisite", "related"}:
            graph.add_edge(edge.get("from"), edge.get("to"), type=edge.get("type"))
    prerequisite = nx.DiGraph(
        (edge["from"], edge["to"])
        for edge in edges
        if edge.get("type") == "prerequisite"
    )
    prerequisite.add_nodes_from(node["id"] for node in nodes)
    covered = set(zip(frame["topic"], frame["angle"].fillna("")))
    return {
        "nodes": graph.number_of_nodes(),
        "edges": graph.number_of_edges(),
        "connectedComponents": nx.number_weakly_connected_components(graph),
        "prerequisiteEdges": prerequisite.number_of_edges(),
        "prerequisiteDag": nx.is_directed_acyclic_graph(prerequisite),
        "prerequisiteRoots": sorted(node for node, degree in prerequisite.in_degree() if degree == 0),
        "prerequisiteLeaves": sorted(node for node, degree in prerequisite.out_degree() if degree == 0),
        "isolatedTopics": sorted(node for node, degree in graph.degree() if degree == 0),
        "coveredQuestionCells": len(covered),
    }


def pandas_coverage_report(frame: pd.DataFrame) -> dict[str, Any]:
    topic_counts = frame.groupby("topic", sort=True).size()
    topic_angle = (
        frame.dropna(subset=["angle"])
        .groupby(["topic", "angle"], sort=True)
        .size()
        .unstack(fill_value=0)
    )
    return {
        "topicCounts": {str(topic): int(count) for topic, count in topic_counts.items()},
        "topicAngleCounts": {
            str(topic): {str(angle): int(count) for angle, count in row.items() if count}
            for topic, row in topic_angle.iterrows()
        },
    }


def encode_embeddings(texts: list[str], model_name: str, requested_device: str) -> tuple[Any, str]:
    from sentence_transformers import SentenceTransformer

    model_path = Path(model_name)
    if not model_path.is_absolute():
        model_path = ROOT / model_path
    if not model_path.exists():
        raise FileNotFoundError(
            f"本地 embedding 模型不存在：{model_path}。请准备仓库内模型，或通过 --model 指定本地目录。"
        )
    if requested_device != "cpu":
        raise ValueError("ONNX Runtime 方案只支持 --device cpu；Apple Silicon 的 CoreML provider 需另行 benchmark")
    model = SentenceTransformer(
        str(model_path),
        backend="onnx",
        device="cpu",
        local_files_only=True,
        model_kwargs={"file_name": QUANTIZED_MODEL_FILE},
    )
    return model.encode(texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False), "onnx-cpu"


def semantic_candidates(embeddings: Any, ids: list[str], threshold: float) -> list[dict[str, Any]]:
    from sklearn.metrics.pairwise import cosine_similarity

    similarities = cosine_similarity(embeddings)
    results: list[dict[str, Any]] = []
    for left in range(len(ids)):
        for right in range(left + 1, len(ids)):
            score = float(similarities[left, right])
            if score >= threshold:
                results.append({"left": ids[left], "right": ids[right], "score": round(score, 4)})
    return sorted(results, key=lambda item: -item["score"])


def embedding_cluster_report(embeddings: Any, ids: list[str]) -> list[dict[str, Any]]:
    cluster_count = min(8, max(2, len(ids) // 80))
    labels = KMeans(n_clusters=cluster_count, n_init=10, random_state=42).fit_predict(embeddings)
    grouped: defaultdict[int, list[str]] = defaultdict(list)
    for question_id, label in zip(ids, labels):
        grouped[int(label)].append(question_id)
    return [{"cluster": label, "size": len(values), "questionIds": values[:20]} for label, values in sorted(grouped.items())]


def analyze(args: argparse.Namespace) -> dict[str, Any]:
    raw_questions = read_arrays(QUESTIONS_DIR)
    records = [QuestionRecord.model_validate(question) for question in raw_questions]
    frame = build_frame(records)
    texts = frame["question"].tolist()
    ids = frame["id"].tolist()
    nodes = read_arrays(KNOWLEDGE_DIR)
    edges = read_concept_graph()
    numeric_lengths = np.array([len(text) for text in texts], dtype=float)
    result: dict[str, Any] = {
        "summary": {
            "questions": len(records),
            "topics": int(frame["topic"].nunique()),
            "meanQuestionLength": round(float(np.mean(numeric_lengths)), 2),
            "questionLengthStd": round(float(np.std(numeric_lengths)), 2),
        },
        "distributions": {
            "difficulty": frame["difficulty"].value_counts().sort_index().to_dict(),
            "category": frame["category"].value_counts().sort_index().to_dict(),
            "angle": frame["angle"].fillna("<missing>").value_counts().sort_index().to_dict(),
        },
        "pandas": pandas_coverage_report(frame),
        "fuzzyDuplicateCandidates": fuzzy_duplicate_candidates(texts, args.fuzzy_threshold),
        "clusters": cluster_report(texts, ids),
        "difficultyPredictability": difficulty_predictability(frame),
        "knowledgeGraph": graph_report(frame, nodes, edges),
    }
    if args.semantic:
        embeddings, actual_device = encode_embeddings(texts, args.model, args.device)
        result["semanticConfig"] = {
            "model": args.model,
            "threshold": args.semantic_threshold,
            "normalizedEmbeddings": True,
            "requestedDevice": args.device,
            "actualDevice": actual_device,
        }
        result["semanticDuplicateCandidates"] = semantic_candidates(embeddings, ids, args.semantic_threshold)
        result["embeddingClusters"] = embedding_cluster_report(embeddings, ids)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze question-bank statistics and similarity")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    parser.add_argument("--fuzzy-threshold", type=int, default=92)
    parser.add_argument("--semantic", action="store_true", help="load sentence-transformers and find semantic duplicates")
    parser.add_argument("--semantic-threshold", type=float, default=0.9)
    parser.add_argument("--model", default=str(LOCAL_MODEL_DIR.relative_to(ROOT)))
    parser.add_argument("--device", choices=["cpu"], default="cpu")
    args = parser.parse_args()
    result = analyze(args)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())