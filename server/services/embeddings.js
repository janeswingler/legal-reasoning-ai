const EMBEDDING_MODEL = process.env.VOYAGE_EMBEDDING_MODEL || "voyage-4";
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

function getApiKey() {
    const key = String(process.env.VOYAGE_API_KEY || "").trim();
    if (!key) {
        throw new Error("VOYAGE_API_KEY is not configured");
    }
    return key;
}

async function embed(texts, inputType) {
    if (!texts.length) {
        return [];
    }

    const response = await fetch(VOYAGE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getApiKey()}`,
        },
        body: JSON.stringify({
            input: texts,
            model: EMBEDDING_MODEL,
            input_type: inputType,
        }),
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
        const detail =
            result.detail ||
            result.error?.message ||
            result.error ||
            "Voyage embedding failed";
        throw new Error(detail);
    }

    return (result.data || [])
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);
}

async function embedTexts(texts) {
    return embed(texts, "document");
}

async function embedQuery(text) {
    const [embedding] = await embed([text], "query");
    return embedding || null;
}

module.exports = {
    embedTexts,
    embedQuery,
    EMBEDDING_MODEL,
};
