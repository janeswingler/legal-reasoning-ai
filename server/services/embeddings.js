const OpenAI = require("openai");

const EMBEDDING_MODEL =
    process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";

let client = null;

function getClient() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured");
    }
    if (!client) {
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return client;
}

async function embedTexts(texts) {
    if (!texts.length) {
        return [];
    }

    const openai = getClient();
    const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
    });

    return response.data
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);
}

async function embedQuery(text) {
    const [embedding] = await embedTexts([text]);
    return embedding || null;
}

module.exports = {
    embedTexts,
    embedQuery,
    EMBEDDING_MODEL,
};
