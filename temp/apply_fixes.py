"""应用本轮人工复核确认的 5 处修订。全部事实均已在会话中核对（论文原文 / 官方 config.json）。"""
import json, pathlib

ROOT = pathlib.Path("src/data/questions")

def load(name):
    p = ROOT / f"{name}.json"
    return p, json.loads(p.read_text(encoding="utf-8"))

def save(p, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def find(data, qid):
    for q in data:
        if q["id"] == qid:
            return q
    raise KeyError(qid)

def set_choice(q, question, options, explanation, misconceptions):
    ch = q["formats"]["choice"]
    q["question"] = question
    ch["type"] = "multiple"
    ch["options"] = options
    ch["answer"] = [0, 1]
    ch["misconceptionMap"] = [None, None, 0, 1]
    q["misconceptions"] = misconceptions
    q["explanation"] = explanation

report = []

# ── 1. flashattn-07：IO 复杂度与收益倍数均与论文不符 ──────────────────────────
p, d = load("hf-flash-attention")
q = find(d, "flashattn-07")
set_choice(
    q,
    "关于 FlashAttention 相对标准注意力的 HBM 显存访问（IO）复杂度，下列哪些说法是正确的？",
    [
        "论文给出的 IO 复杂度为：标准注意力 Θ(Nd + N²)，FlashAttention Θ(N²d²M⁻¹)（M 为 SRAM 容量），实测最高约 9 倍减少",
        "两者的比值约为 M/d²，与序列长度 N 无关；因此 head 维度 d 越大或 SRAM 越小，FlashAttention 的相对收益越小",
        "FlashAttention 把 IO 复杂度降到接近 O(Nd)，在 N=4096、d=128 时 HBM 流量约减少 33 倍",
        "序列越长收益越大：标准注意力是 O(N²) 而 FlashAttention 是 O(N)，N 增大时两者的倍数差会持续拉大",
    ],
    "先分清「显存占用」与「访存流量」两件事。显存占用上 FlashAttention 确实是 O(N²)→O(N)（不再物化注意力矩阵）；"
    "但**访存流量**按论文定理 2 是标准注意力 Θ(Nd+N²)、FlashAttention Θ(N²d²M⁻¹)，两者之比约为 M/d²"
    "——**与 N 无关，且随 head 维度 d 的平方恶化**。论文的实测锚点是 GPT-2 medium（N=1024、d=64、A100）："
    "HBM R/W 从 40.3 GB 降到 4.4 GB，约 9 倍，这正是原文「up to 9× fewer」的来源。"
    "所以「N=4096、d=128 时减少 33 倍」是把 O(N²)/O(Nd) = N/d = 32 当成了收益倍数：既用错了复杂度，也高估了收益"
    "（d=128 时 M/d² 已降到约 3 倍量级）。",
    [
        "以为 FlashAttention 的 HBM IO 复杂度是 O(Nd) 或 O(N)，并按 N/d 估算收益倍数",
        "以为序列越长 FlashAttention 的访存收益倍数越大",
    ],
)
save(p, d); report.append("flashattn-07 → IO 复杂度改 Θ(N²d²M⁻¹)，33 倍改为实测 9 倍，补 d 与 N 的关系")

# ── 2. specdec-06：把常数倍加速误写成复杂度级跨越，且把正确表述判为错误 ──────────
p, d = load("hf-inference-optimization")
q = find(d, "specdec-06")
set_choice(
    q,
    "在草稿模型几乎零误差、每轮固定生成 γ 个候选 token 的理想情况下，关于投机解码对自回归生成延迟的改善，下列哪些说法是正确的？",
    [
        "目标模型的串行前向次数从 n 降到约 n/(γ+1)，即获得最高约 γ+1 倍的常数倍加速，渐进复杂度仍是 O(n)",
        "收益来自把内存带宽受限的逐 token 解码，改成一次前向批量验证整条候选序列——验证 γ+1 个 token 的耗时接近验证 1 个",
        "渐进复杂度从 O(n) 降到接近 O(1)，因为一次前向即可验证整条候选序列，输出多长都不影响延迟",
        "加速比与草稿长度 γ 无关，只由草稿模型与目标模型的参数量之比决定，因此草稿模型越小收益越高",
    ],
    "投机解码拿到的是**常数倍加速，不是复杂度级别的跨越**。设每轮草稿 γ 个 token 且草稿模型几乎不犯错，"
    "则一次目标模型前向可并行验证 γ+1 个 token；产出 n 个 token 所需的串行前向次数从 n 降到约 n/(γ+1)，"
    "渐进复杂度仍是 O(n)——γ 是固定超参、不随 n 增长，所以拿不到 O(1)。收益是工程性的而非渐进的："
    "自回归解码是内存带宽受限的，每步都要把全部权重从 HBM 读一遍，而验证 γ+1 个 token 的一次前向，"
    "读权重的开销与验证 1 个几乎相同，于是被摊薄了约 γ+1 倍。这也解释了为什么加速比主要由 γ 与草稿模型的接受率决定，"
    "而不是由两个模型的参数量之比决定。",
    [
        "以为投机解码把延迟复杂度从 O(n) 降到 O(1)",
        "以为加速比与草稿长度无关、只由两个模型的参数量之比决定",
    ],
)
save(p, d); report.append("specdec-06 → O(1) 改为常数倍 γ+1（渐进仍 O(n)），原被判错的「仍是 O(n)」并入正确表述")

# ── 3. inference-vram-budget-calc-01：KV Cache 前提与模型实际结构不符；且 4 项全对无区分度 ──
p, d = load("inference")
q = find(d, "inference-vram-budget-calc-01")
set_choice(
    q,
    "某架构师计划在单张 16GB VRAM 的消费级 GPU 上部署 Qwen2.5-Coder-14B（48 层、8 个 KV 头、head_dim 128），"
    "采用 Q4_K_M 量化（约 0.55 Bytes/parameter）。若配置 num_ctx = 32768，KV Cache 以 FP16 存储（每元素 2 字节），"
    "推理引擎需预留 1.5GB 作为 CUDA Context 与临时 Workspace。关于显存预算评估，下列哪些判断是正确的？",
    [
        "32K 上下文下总开销约 15.6GB（权重 7.7 + KV 6.4 + 运行时 1.5），已逼近 16GB 上限，余量不足 0.5GB，不宜再叠加并发",
        "KV Cache 是唯一随上下文长度线性增长的分项：该模型每 token 约 0.1875 MiB，32K 约 6.4GB、64K 约 12.9GB",
        "32K 上下文下 KV Cache 约 3.5GB，总开销约 12.7GB，在 16GB 卡上余量充裕，可放心把上下文扩到 64K",
        "把上下文从 32K 扩到 64K 只会让总开销增加约 1.7GB（约 14.4GB），仍在 16GB 以内可正常运行",
    ],
    "逐项算。静态权重 14×10⁹ × 0.55 B ≈ 7.7 GB，且只由参数量与量化位宽决定，与 batch size、上下文长度无关。"
    "KV Cache 才是随上下文线性增长的那一项：Qwen2.5-Coder-14B 为 48 层、8 个 KV 头、head_dim 128，FP16 下每 token 为 "
    "2×48×8×128×2 = 196,608 B ≈ 0.1875 MiB，因此 32K 约 6.4 GB、64K 约 12.9 GB。于是 32K 总开销 = 7.7 + 6.4 + 1.5 ≈ 15.6 GB，"
    "虽未超 16 GB 但余量不足 0.5 GB，实际还要考虑显存碎片与并发，基本无法再叠第二路会话；扩到 64K 则总开销约 22.1 GB，"
    "必然 OOM 或换页。常见错误是凭「KV Cache 只有几个 GB」的印象估算，忽略了层数与 KV 头数的乘积。",
    [
        "以为 14B 模型的 32K FP16 KV Cache 只有 3.5GB 量级",
        "以为上下文翻倍时 KV Cache 只带来很小的增量",
    ],
)
save(p, d); report.append("inference-vram-budget-calc-01 → KV 3.5GB 改为实测 6.4GB（原 4 项全对，改为 2 对 2 错）")

# ── 4. moe-mixtral-03：把真实的 5.6B/专家 判为错误；总量 45B 与官方 46.7B 不符 ──
p, d = load("hf-moe")
q = find(d, "moe-mixtral-03")
set_choice(
    q,
    "Mixtral 8x7B 的命名容易让人误以为总参数量是 56B（8×7B），但官方口径约为 46.7B。关于这一差异的成因，下列哪些说法是正确的？",
    [
        "注意力、词嵌入、归一化等参数被全部 8 个专家共享、只计算一次（约 1.6B），加上 8 个专家 FFN 合计的约 45B 才是总量",
        "单个专家 FFN 约 5.6B（每层 3×4096×14336，共 32 层），因此 8 个专家 FFN 合计约 45B，而不是 8×7B=56B",
        "每个 token 只路由到 2 个专家，未激活的 6 个专家不计入总参数量，所以从 56B 降到约 46.7B",
        "模型默认以 4-bit 存储，标称总参数量按量化后的有效位数折算，因此远小于 56B",
    ],
    "拆开算就清楚了。每个专家只是一个 FFN，不是完整的 7B 模型：单层 3（gate/up/down）× 4096 × 14336 ≈ 1.76 亿参数，"
    "乘 32 层约 5.6B；8 个专家 FFN 合计约 45B，再加上被所有专家共享、只计算一次的注意力（约 1.34B）、"
    "词嵌入与输出头（合计约 0.26B）、路由（约 0.001B），总量约 46.7B，与官方口径一致。"
    "还要区分两个不同的数：46.7B 是**总参数量**，决定显存（所有专家都可能被路由到，需常驻，fp16 下约 93GB）；"
    "约 12.9B 是每 token 的**激活参数量**，决定计算量与延迟。路由只影响后者，不影响总参数量。",
    [
        "以为未激活的专家不计入总参数量",
        "以为标称参数量是按量化后的位数折算的",
    ],
)
save(p, d); report.append("moe-mixtral-03 → 5.6B/专家 由「错误」改判为正确；总量 45B 改为官方 46.7B")

# ── 5. q6-adaboost-learnability：选项措辞与其自身解析不一致（缺 γ 间隙）──
p, d = load("ml-theory")
q = find(d, "q6-adaboost-learnability")
old = "只要存在一个分类准确率略高于随机猜想（错误率小于 50%）的弱学习算法"
new = "只要存在一个对所有数据分布都能取得略优于随机猜想（错误率低于 50%−γ，γ>0）的弱学习算法"
opts = q["formats"]["choice"]["options"]
i = next(k for k, o in enumerate(opts) if old in o)
opts[i] = opts[i].replace(old, new)
save(p, d); report.append(f"q6-adaboost-learnability → 选项[{i}] 补上 γ 间隙，与其解析口径一致")

print("已应用修订：")
for r in report:
    print("  ✓", r)
