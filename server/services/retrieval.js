const bm25 = require("wink-bm25-text-search");
const nlp = require("wink-nlp-utils");
const DocumentChunk = require("../models/DocumentChunk.js");
const { embedQuery } = require("./openai.js");
const {
    RETRIEVE_CANDIDATES,
    TOP_K,
    FALLBACK_LIMIT,
    BM25_WEIGHT,
    DENSE_WEIGHT,
    RAG_VERSION,
} = require("../config/rag.js");

const BROAD_DOCUMENT_QUERY =
    /\b(summarize|summary|summarise|overview|attached|attachment|document|pdf|file|uploaded|whole|entire|full text|read the|what does it say)\b/i;

function isBroadDocumentQuery(query) {
    return BROAD_DOCUMENT_QUERY.test(query.trim());
}

function buildEngine(chunks) {
    const engine = bm25();
    engine.defineConfig({ fldWeights: { body: 1 } });
    engine.definePrepTasks([
        nlp.string.lowerCase,
        nlp.string.removePunctuations,
        nlp.string.tokenize0,
    ]);

    chunks.forEach((chunk) => {
        engine.addDoc({ body: chunk.text }, String(chunk._id));
    });

    engine.consolidate();
    return engine;
}

function scoreBm25(chunks, query) {
    if (chunks.length < 2) {
        return new Map();
    }

    try {
        const engine = buildEngine(chunks);
        const results = engine.search(query.trim(), RETRIEVE_CANDIDATES);
        const scores = new Map();

        for (const [chunkId, score] of results) {
            scores.set(chunkId, score);
        }

        return scores;
    } catch (error) {
        console.error("BM25 search error:", error);
        return new Map();
    }
}

function cosineSimilarity(left, right) {
    if (!left?.length || !right?.length || left.length !== right.length) {
        return 0;
    }

    let dot = 0;
    let leftNorm = 0;
    let rightNorm = 0;

    for (let index = 0; index < left.length; index += 1) {
        dot += left[index] * right[index];
        leftNorm += left[index] * left[index];
        rightNorm += right[index] * right[index];
    }

    if (!leftNorm || !rightNorm) {
        return 0;
    }

    return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function normalizeScores(scoreMap) {
    const values = [...scoreMap.values()];
    if (!values.length) {
        return new Map();
    }

    const max = Math.max(...values);
    const min = Math.min(...values);
    const normalized = new Map();

    for (const [key, value] of scoreMap.entries()) {
        if (max === min) {
            normalized.set(key, 1);
        } else {
            normalized.set(key, (value - min) / (max - min));
        }
    }

    return normalized;
}

function buildScoreEntry(chunk, bm25Score, denseScore, combinedScore) {
    return {
        chunkId: chunk._id,
        bm25Score,
        denseScore,
        combinedScore,
    };
}

function rankChunks(chunks, bm25Scores, denseScores) {
    const normalizedBm25 = normalizeScores(bm25Scores);
    const normalizedDense = normalizeScores(denseScores);
    const ranked = [];

    for (const chunk of chunks) {
        const chunkId = String(chunk._id);
        const bm25Score = normalizedBm25.get(chunkId) || 0;
        const denseScore = normalizedDense.get(chunkId) || 0;
        const hasEmbedding = Array.isArray(chunk.embedding) && chunk.embedding.length > 0;
        const combinedScore = hasEmbedding
            ? BM25_WEIGHT * bm25Score + DENSE_WEIGHT * denseScore
            : bm25Score;

        ranked.push({
            chunk,
            score: buildScoreEntry(chunk, bm25Score, denseScore, combinedScore),
        });
    }

    ranked.sort((left, right) => right.score.combinedScore - left.score.combinedScore);
    return ranked.slice(0, TOP_K);
}

function formatChunkSource(chunk) {
    const pageLabel =
        chunk.pageStart && chunk.pageEnd
            ? chunk.pageStart === chunk.pageEnd
                ? `p. ${chunk.pageStart}`
                : `pp. ${chunk.pageStart}-${chunk.pageEnd}`
            : null;

    if (pageLabel) {
        return `${chunk.sourceFilename}, ${pageLabel}`;
    }

    return chunk.sourceFilename || "Uploaded PDF";
}

function formatRetrievedContext(chunks) {
    if (!chunks.length) {
        return "";
    }

    return chunks
        .map(
            (chunk, index) =>
                `[Excerpt ${index + 1} | Source: ${formatChunkSource(chunk)}]\n${chunk.text}`
        )
        .join("\n\n");
}

async function retrieveChunksForSession(chatSessionId, query, limit = TOP_K) {
    const result = await retrieveWithMeta(chatSessionId, query, limit);
    return result.chunks;
}

async function retrieveWithMeta(chatSessionId, query, limit = TOP_K) {
    const chunks = await DocumentChunk.find({ chatSessionId }).sort({ chunkIndex: 1 });

    if (!chunks.length || !query?.trim()) {
        return { chunks: [], scores: [], ragVersion: RAG_VERSION };
    }

    if (isBroadDocumentQuery(query)) {
        const selected = chunks.slice(0, FALLBACK_LIMIT);
        return {
            chunks: selected,
            scores: selected.map((chunk) =>
                buildScoreEntry(chunk, null, null, 1)
            ),
            ragVersion: RAG_VERSION,
        };
    }

    if (chunks.length === 1) {
        return {
            chunks: [chunks[0]],
            scores: [buildScoreEntry(chunks[0], null, null, 1)],
            ragVersion: RAG_VERSION,
        };
    }

    const bm25Raw = scoreBm25(chunks, query);
    const denseRaw = new Map();
    const embeddedChunks = chunks.filter(
        (chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length > 0
    );

    if (embeddedChunks.length) {
        try {
            const queryEmbedding = await embedQuery(query.trim());
            if (queryEmbedding) {
                for (const chunk of embeddedChunks) {
                    denseRaw.set(
                        String(chunk._id),
                        cosineSimilarity(queryEmbedding, chunk.embedding)
                    );
                }
            }
        } catch (error) {
            console.error("Embedding query error:", error);
        }
    }

    if (!bm25Raw.size && !denseRaw.size) {
        const selected = chunks.slice(0, FALLBACK_LIMIT);
        return {
            chunks: selected,
            scores: selected.map((chunk) =>
                buildScoreEntry(chunk, null, null, 0)
            ),
            ragVersion: RAG_VERSION,
        };
    }

    const ranked = rankChunks(chunks, bm25Raw, denseRaw);
    const selected = ranked.slice(0, limit);

    if (!selected.length) {
        const fallback = chunks.slice(0, FALLBACK_LIMIT);
        return {
            chunks: fallback,
            scores: fallback.map((chunk) =>
                buildScoreEntry(chunk, null, null, 0)
            ),
            ragVersion: RAG_VERSION,
        };
    }

    return {
        chunks: selected.map((entry) => entry.chunk),
        scores: selected.map((entry) => entry.score),
        ragVersion: RAG_VERSION,
    };
}

module.exports = {
    retrieveChunksForSession,
    retrieveWithMeta,
    formatRetrievedContext,
};
