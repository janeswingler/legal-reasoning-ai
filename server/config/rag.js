module.exports = {
    EMBEDDING_MODEL: process.env.VOYAGE_EMBEDDING_MODEL || "voyage-4",
    RETRIEVE_CANDIDATES: 20,
    TOP_K: 5,
    FALLBACK_LIMIT: 15,
    BM25_WEIGHT: 0.3,
    DENSE_WEIGHT: 0.7,
    RAG_VERSION: "hybrid-v1",
};
