/**
 * Real-content fixtures for real-LLM ingest testing.
 *
 * These are the AUTHORITATIVE source of truth for the source documents
 * fed to the LLM in ingest.real-llm.test.ts. Materialized onto disk at
 * tests/fixtures/real-content/ by `materializeRealContent()` so humans
 * can inspect the files during debugging — but the materialized files
 * are gitignored (tests/ is in .gitignore).
 *
 * Adding a new document: add a new entry to REAL_CONTENT_DOCS.
 */
import fs from "node:fs/promises"
import path from "node:path"

const ROPE_PAPER = `# RoFormer: Enhanced Transformer with Rotary Position Embedding

Jianlin Su, Yu Lu, Shengfeng Pan, Ahmed Murtadha, Bo Wen, Yunfeng Liu
(Zhuiyi Technology Co., Ltd., Shenzhen)

## Abstract

Position encoding recently has shown effective in the transformer architecture.
It enables valuable supervision for dependency modeling between elements at
different positions of the sequence. In this paper, we first investigate various
methods to integrate positional information into the learning process of
transformer-based language models. Then, we propose a novel method named Rotary
Position Embedding (RoPE) to effectively leverage the positional information.
Specifically, the proposed RoPE encodes the absolute position with a rotation
matrix and meanwhile incorporates the explicit relative position dependency in
self-attention formulation. Notably, RoPE enables valuable properties, including
the flexibility of sequence length, decaying inter-token dependency with
increasing relative distances, and the capability of equipping the linear
self-attention with relative position encoding. Finally, we evaluate the
enhanced transformer with rotary position embedding, also called RoFormer, on
various long text classification benchmark datasets. Our experiments show that
it consistently overcomes its alternatives.

## 1. Introduction

The sequential order of words is of great value to natural language understanding.
Recurrent neural networks (RNNs) encode the order of tokens by recursively
computing a hidden state along the time dimension. Convolutional neural networks
(CNNs) were thought to be position-agnostic, but recent work has shown that the
commonly used padding operation can implicitly learn positional information.

Recently, the transformer, which is built on top of the self-attention mechanism,
has become the de facto backbone for many natural language processing (NLP) tasks.
Unlike RNN- and CNN-based models, the self-attention mechanism in vanilla
transformers is parallelizable with position-agnostic computations. As a
consequence, various approaches have been proposed to incorporate positional
information into the learning process.

On one hand, absolute position encoding adds position-dependent signals directly
to the context representations, either through a pre-defined function (such as
the sinusoidal encoding used in the original Transformer) or through learnable
embeddings. On the other hand, relative position encodings typically modify the
attention mechanism to be aware of the relative distance between tokens rather
than absolute positions. Shaw et al. (2018) first introduced relative position
encoding by adding a learnable relative position representation to the keys and
values in the attention computation. Subsequent work, including Transformer-XL
and T5, refined this idea with different parameterizations.

## 2. Motivation for Rotary Position Embedding

Both families have limitations. Absolute methods do not naturally generalize to
sequences longer than those seen during training, and they complicate the
extension to relative information. Existing relative methods modify the attention
matrix directly and cannot trivially be combined with efficient attention
variants (such as linear attention) that factorize the attention computation.

We ask: is there a way to encode position that (a) yields relative position
information through standard dot-product attention, (b) extends to arbitrary
sequence length, and (c) is compatible with linear-time attention variants? Our
answer is Rotary Position Embedding.

## 3. Formulation

Given a query vector q at position m and a key vector k at position n, define a
rotation matrix R_Θ,m that rotates q by an angle proportional to m. Applying
R_Θ,m to q and R_Θ,n to k yields the property that the inner product between the
rotated q and the rotated k depends only on the original vectors and the
difference m − n. In other words, absolute position is injected into each
vector, but the attention score between two tokens captures only their relative
position — exactly the behavior we want.

The rotation is applied pairwise across feature dimensions: each consecutive pair
of dimensions is treated as a 2D subspace that is rotated by a frequency-scaled
angle. This extends naturally to arbitrary model dimension d, and is efficient
to compute: no modification to the attention matrix is required, and the same
rotation can be applied in linear attention.

## 4. Properties

- **Long-range decay.** As the relative distance m − n grows, the inner-product
  magnitude decays smoothly, giving the model a useful inductive bias.
- **Sequence-length flexibility.** Because the rotation is a pure function of
  position, no maximum-length hyperparameter needs to be chosen in advance.
- **Linear-attention compatible.** Unlike relative-position methods that add
  terms to the attention matrix, RoPE modifies only the query/key vectors and
  can be used with kernel-based linear attention.

## 5. Empirical Results

We replace the sinusoidal absolute position embedding in a standard transformer
with RoPE, producing what we call RoFormer. On long-text classification tasks
including CAIL2019-SCM and a range of GLUE-style benchmarks, RoFormer outperforms
the vanilla transformer, particularly as input length grows. The gap widens at
inference lengths beyond those seen during training, confirming the
length-flexibility argument.
`

const FLASH_ATTENTION_PAPER = `# FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness

Tri Dao, Daniel Y. Fu, Stefano Ermon, Atri Rudra, Christopher Ré
(Stanford University, University at Buffalo)

## Abstract

Transformers are slow and memory-hungry on long sequences, since the time
and memory complexity of self-attention are quadratic in sequence length.
Approximate attention methods have attempted to address this problem by
trading off model quality to reduce the compute complexity, but often do
not achieve wall-clock speedup. We argue that a missing principle is making
attention algorithms IO-aware — accounting for reads and writes between
levels of GPU memory. We propose FlashAttention, an IO-aware exact
attention algorithm that uses tiling to reduce the number of memory reads
and writes between GPU high bandwidth memory (HBM) and GPU on-chip SRAM.
We analyze the IO complexity of FlashAttention, showing that it requires
fewer HBM accesses than standard attention, and is optimal for a range of
SRAM sizes.

## 1. Introduction

The transformer architecture has become ubiquitous in natural language
processing and is increasingly applied to vision, audio, and scientific
domains. Its core is the self-attention mechanism, which scales
quadratically with sequence length in both time and memory. This quadratic
cost has motivated a large body of work on approximate attention,
including sparse patterns, low-rank approximations, and kernel-based
methods. However, most of these approximations do not deliver wall-clock
speedups: they reduce the number of floating-point operations, but on
modern GPUs, attention is memory-bound, not compute-bound.

We identify the main bottleneck: moving attention matrices between GPU
high-bandwidth memory (HBM) and the much faster but smaller on-chip SRAM.
Standard attention implementations materialize the full N×N attention
matrix in HBM, requiring O(N²) reads and writes. FlashAttention instead
never materializes this matrix; it computes attention in blocks that fit
in SRAM, using tiling and a recomputation trick for the backward pass.

## 2. Background: Memory Hierarchy on GPUs

GPUs have a memory hierarchy: registers, shared memory (per-streaming-
multiprocessor SRAM), and HBM. HBM is large (40-80 GB on A100) but slow
(~1.5 TB/s), while shared memory is tiny (~192 KB per SM on A100) but
extremely fast (~19 TB/s). Kernel runtime is often dominated by HBM
traffic rather than compute. An IO-aware algorithm carefully schedules
computation to minimize HBM reads and writes.

## 3. The FlashAttention Algorithm

The forward pass of FlashAttention works as follows. Queries Q, keys K,
and values V are split into blocks that fit in SRAM. For each block of
queries, we iterate over blocks of keys and values, computing partial
attention scores and maintaining running statistics (max for numerical
stability and sum for normalization). The final output for each query
block is assembled from these block-wise partial results.

The crucial observation: we never need to materialize the full N×N
attention matrix. We only need per-block statistics, which fit in SRAM.

For the backward pass, we cannot afford to store the full attention matrix
either. Instead, FlashAttention uses a recomputation trick: during the
forward pass, we save the statistics (max and sum per row) along with the
output. During the backward pass, we recompute the attention matrix in
blocks on the fly, using the saved statistics to avoid re-deriving them.

## 4. IO Complexity Analysis

Standard attention: Ω(Nd + N²) HBM accesses, where N is sequence length
and d is head dimension. The N² term comes from reading/writing the
attention matrix.

FlashAttention: O(N²d²/M) HBM accesses, where M is SRAM size. For typical
GPU configurations (d ≈ 64, M ≈ 100 KB), this is strictly better than
standard attention whenever N > M/d ≈ 1500. For long sequences (N ≥ 2K),
FlashAttention is orders of magnitude more IO-efficient.

## 5. Empirical Results

FlashAttention yields 2-4× wall-clock speedup over PyTorch attention on
GPT-2 training, with no quality degradation (it is exact, not approximate).
On BERT training, we observe 15% end-to-end speedup. Most strikingly,
FlashAttention enables much longer contexts: models that previously OOM at
N=2K now train with N=16K or more on the same hardware.

FlashAttention has been integrated into PyTorch, DeepSpeed, MegatronLM, and
is now standard in most transformer training pipelines.
`

const LORA_PAPER = `# LoRA: Low-Rank Adaptation of Large Language Models

Edward J. Hu, Yelong Shen, Phillip Wallis, Zeyuan Allen-Zhu, Yuanzhi Li,
Shean Wang, Lu Wang, Weizhu Chen (Microsoft Corporation)

## Abstract

An important paradigm of natural language processing consists of
large-scale pre-training on general domain data and adaptation to
particular tasks or domains. As we pre-train larger models, full
fine-tuning, which retrains all model parameters, becomes less feasible.
Using GPT-3 175B as an example — deploying independent instances of
fine-tuned models, each with 175B parameters, is prohibitively expensive.
We propose Low-Rank Adaptation, or LoRA, which freezes the pre-trained
model weights and injects trainable rank decomposition matrices into each
layer of the Transformer architecture, greatly reducing the number of
trainable parameters for downstream tasks. Compared to GPT-3 175B
fine-tuned with Adam, LoRA can reduce the number of trainable parameters
by 10,000 times and the GPU memory requirement by 3 times.

## 1. Introduction

Large pre-trained language models like GPT-3 contain hundreds of billions
of parameters. Full fine-tuning adapts every parameter to a downstream
task, producing a new copy of the model. At deployment, each fine-tuned
task requires storing and serving a full-size model, which is infeasible
at scale — a single 175B model occupies ~350 GB in fp16 and requires
multiple high-end GPUs to serve.

Parameter-efficient fine-tuning (PEFT) methods aim to adapt large models
to new tasks by training only a small number of extra parameters, leaving
the base model frozen and shared across tasks. Prior PEFT methods include
adapter layers (small MLPs inserted into each transformer block) and
prefix tuning (learnable prefix tokens). Both introduce inference latency
or have difficulty scaling to large models.

## 2. LoRA Formulation

Let W₀ ∈ ℝ^(d×k) be a weight matrix in the pre-trained transformer. During
fine-tuning, instead of updating W₀ to W₀ + ΔW, LoRA represents the update
as a low-rank decomposition:

    ΔW = BA

where B ∈ ℝ^(d×r), A ∈ ℝ^(r×k), and r is a small rank (typically 4, 8, or
16). The forward pass becomes:

    h = W₀x + BAx

At initialization, A is drawn from a random Gaussian and B is zero, so
ΔW = BA = 0. This ensures LoRA starts as a no-op identical to the
pre-trained model. During training, only A and B are updated; W₀ stays
frozen.

The number of trainable parameters is reduced from d×k (full fine-tune)
to r(d + k) (LoRA). For d = k = 4096 and r = 8, this is a ~500×
reduction.

## 3. Applying LoRA to Transformers

LoRA can in principle be applied to any dense layer. In practice, we
apply it only to the attention weights (Wq, Wk, Wv, Wo) and leave the
MLP, LayerNorm, and embeddings frozen. This choice is empirically
motivated: adapting attention is sufficient for most downstream tasks,
and omitting MLP saves substantial parameters.

At inference time, the LoRA update can be merged into the base weights:
    W = W₀ + BA
producing a single matrix with no additional inference cost. This is a
key advantage over adapter methods, which always add inference latency.

## 4. Experimental Results

We evaluate LoRA against full fine-tuning, adapter tuning, and prefix
tuning on GPT-3 175B across GLUE, WikiSQL, SAMSum, and others. Headline
findings:

- **Parameter reduction**: LoRA with r=8 uses 0.01% of full fine-tuning
  parameters (37.7M vs 175B).
- **Performance parity**: On most tasks LoRA matches or exceeds full
  fine-tuning quality.
- **Lower GPU memory**: 3× reduction during training (no optimizer state
  for the base model).
- **No inference overhead**: Merged LoRA is indistinguishable from a
  normally fine-tuned model at inference.

## 5. Rank Analysis

A natural question: how small can r be? Empirically, r=1 or r=2 already
captures most of the adaptation for many tasks. This suggests that
task-specific adaptation lives in a very low-dimensional subspace of the
full parameter space — a striking structural fact about large pre-trained
models.

## 6. Impact

LoRA has become the standard way to fine-tune large language models. It
powers popular tools like PEFT (HuggingFace), has spawned extensions like
QLoRA (4-bit quantized base + LoRA), and enables the thriving ecosystem
of fine-tuned open-weights models on consumer GPUs.
`

const TRANSFORMER_SURVEY_ZH = `# Transformer 架构综述

## 摘要

Transformer 架构自 2017 年由 Vaswani 等人在论文《Attention Is All You Need》
中提出以来,已成为自然语言处理和众多其他领域的主导模型架构。本文系统梳理了
Transformer 的核心组件、关键变体以及其在过去数年间的演进脉络,重点关注注意力
机制的不同实现、位置编码方案、模型规模的 Scaling Law 以及针对效率和长序列
建模的多种优化方法。

## 1. 引言

在 Transformer 出现之前,循环神经网络(RNN)和长短期记忆网络(LSTM)是序列
建模的主流方案。它们按时间步依次处理输入,难以并行化,而且对于长距离依赖
的建模存在梯度消失等问题。卷积神经网络(CNN)虽然可以并行,但单层的感受野
有限,需要堆叠多层才能捕获长距离关系。

Transformer 抛弃了循环与卷积,完全基于自注意力机制来建模输入序列各位置之间
的依赖。它天然支持并行计算,同时每一层都能直接建模任意两个位置之间的关系,
突破了 RNN 在长距离依赖上的局限。

## 2. 核心组件

### 2.1 自注意力机制

自注意力的核心是对每个位置 i,计算它与所有位置 j 的相关性(attention score),
并据此对各位置的值向量做加权求和。具体而言,给定查询矩阵 Q、键矩阵 K、值
矩阵 V,注意力输出为:

    Attention(Q, K, V) = softmax(QK^T / √d_k) · V

其中 d_k 是键向量的维度,除以 √d_k 是为了防止点积值过大导致 softmax 梯度消失
(即缩放点积注意力,scaled dot-product attention)。

### 2.2 多头注意力

多头注意力(Multi-Head Attention)将查询、键、值分别投影到多个子空间,每个
子空间独立做注意力计算,最后拼接再投影回原维度。这让模型能够同时关注不同
类型的关系(例如语法、语义、共指)。

### 2.3 位置编码

由于注意力机制本身不具备顺序感,需要显式地向输入中注入位置信息。最早的方案
是正弦/余弦位置编码。后来出现了可学习的绝对位置嵌入、相对位置编码
(Shaw et al., 2018)、以及 RoPE(Rotary Position Embedding,Su et al., 2021)
等更先进的方案。RoPE 通过旋转矩阵将绝对位置信息注入查询和键向量,使得注意力
分数仅依赖于相对位置,目前已成为许多大模型的标配。

## 3. 关键变体

### 3.1 Encoder-only:BERT 系

BERT 及其衍生模型(RoBERTa, ALBERT, ELECTRA)使用双向 Transformer encoder,
通过 masked language modeling 任务进行预训练,擅长理解类任务。

### 3.2 Decoder-only:GPT 系

GPT 系列使用单向(causal)Transformer decoder,通过自回归语言建模进行预训练。
GPT-3/4、LLaMA、Qwen、DeepSeek 等当代主流大语言模型都基于 decoder-only 架构。

### 3.3 Encoder-Decoder:T5、BART

保留原始 Transformer 的完整 encoder-decoder 结构,适用于翻译、摘要等序列到
序列任务。

## 4. 效率优化

### 4.1 注意力近似

标准自注意力的时间和空间复杂度均为 O(N²),对长序列不友好。近似方法包括:
Sparse Attention(Longformer、BigBird)、低秩近似(Performer、Linformer)、
线性注意力等。这些方法以轻微质量损失换取显著速度提升。

### 4.2 IO 感知优化

FlashAttention(Dao et al., 2022)不近似注意力矩阵,而是通过分块计算避免
将完整的 N×N 矩阵写入 HBM。它是精确注意力,但在 GPU 上的实际 wall-clock
速度比 PyTorch 原生实现快 2-4 倍,已成为训练与推理的事实标准。

### 4.3 参数高效微调

在模型规模突破千亿参数后,全量微调(full fine-tuning)成本过高。LoRA(Hu et al.,
2021)通过在注意力权重旁增加低秩矩阵,仅训练极少量参数即可达到与全量微调
相当的效果,极大降低了微调成本。

## 5. Scaling Law

Kaplan et al. (2020) 和 Hoffmann et al. (Chinchilla, 2022) 的研究表明,
Transformer 的性能遵循明确的 scaling law:随模型参数量 N、训练数据量 D、计算
量 C 的幂律提升。这启发了 GPT-4、LLaMA-3、Qwen3 等更大规模模型的训练策略,
也为"更大即更好"提供了理论依据。

## 6. 未来方向

目前的研究热点包括:超长上下文(1M+ token)、多模态融合、专家混合
(Mixture of Experts, MoE)架构、以及推理链式思维(Chain-of-Thought)等。
Transformer 作为基础架构仍在持续演进。
`

export interface RealContentDoc {
  /** Filename (no path) used both on disk and as the source doc name during ingest */
  filename: string
  /** The document body. */
  content: string
}

export const REAL_CONTENT_DOCS: RealContentDoc[] = [
  { filename: "rope-paper.md", content: ROPE_PAPER },
  { filename: "flash-attention-paper.md", content: FLASH_ATTENTION_PAPER },
  { filename: "lora-paper.md", content: LORA_PAPER },
  { filename: "transformer-survey-zh.md", content: TRANSFORMER_SURVEY_ZH },
]

/**
 * Write all docs to disk under the given root. Output is gitignored
 * (tests/fixtures/ is in .gitignore), but present for humans to inspect
 * when debugging. Idempotent — safe to call from beforeAll on every run.
 */
export async function materializeRealContent(
  targetDir: string,
): Promise<void> {
  await fs.mkdir(targetDir, { recursive: true })
  for (const doc of REAL_CONTENT_DOCS) {
    await fs.writeFile(
      path.join(targetDir, doc.filename),
      doc.content,
      "utf-8",
    )
  }
}
