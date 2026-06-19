module.exports = {
    EMBEDDING_MODEL: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    RETRIEVE_CANDIDATES: 20,
    TOP_K: 5,
    FALLBACK_LIMIT: 15,
    BM25_WEIGHT: 0.3,
    DENSE_WEIGHT: 0.7,
    RAG_VERSION: "hybrid-v1",
};
