const OpenAI = require("openai");
const { EMBEDDING_MODEL } = require("../config/rag.js");

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

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

function buildSystemPrompt(assignmentId, hasRetrievedContext) {
    let prompt =
        "You are a legal AI assistant helping law students with weekly legal reasoning assignments. " +
        "Be clear, accurate, and educational. Do not give definitive legal advice for real cases. " +
        "Answer in plain language; use Markdown sparingly when it improves clarity. " +
        `The student's current assignment is: ${assignmentId}.`;

    if (hasRetrievedContext) {
        prompt +=
            "\n\nThe student attached PDF documents to this chat thread. " +
            "Excerpts from those PDFs are included in the student's message. " +
            "You can read and use them — do not say you cannot access, view, or open attachments. " +
            "If earlier assistant messages incorrectly claimed the documents were unavailable, ignore those statements. " +
            "Answer using the excerpts. If they do not contain enough information, say so clearly rather than inventing citations.";
    }

    return prompt;
}

function buildUserMessage(userInput, retrievedContext) {
    if (!retrievedContext) {
        return userInput;
    }

    return (
        "Here are excerpts from my uploaded PDF(s):\n\n" +
        retrievedContext +
        "\n\nMy question: " +
        userInput
    );
}

function buildChatMessages(exchanges, assignmentId, userInput, retrievedContext) {
    const history = [];

    for (const exchange of exchanges) {
        history.push({ role: "user", content: exchange.userInput });
        history.push({ role: "assistant", content: exchange.botResponse });
    }

    return [
        { role: "system", content: buildSystemPrompt(assignmentId, Boolean(retrievedContext)) },
        ...history,
        { role: "user", content: buildUserMessage(userInput, retrievedContext) },
    ];
}

async function getChatCompletion(exchanges, assignmentId, userInput, retrievedContext = "") {
    const openai = getClient();
    const messages = buildChatMessages(exchanges, assignmentId, userInput, retrievedContext);

    const response = await openai.chat.completions.create({
        model: MODEL,
        messages,
        temperature: 0.4,
    });

    return response.choices[0]?.message?.content?.trim() || "";
}

async function generateSessionTitle(userInput, botResponse) {
    const openai = getClient();

    const response = await openai.chat.completions.create({
        model: MODEL,
        messages: [
            {
                role: "system",
                content:
                    "You are a title generator. Create a concise title (3–5 words) that captures this conversation's topic. Return only the title, no quotes.",
            },
            {
                role: "user",
                content: `User asked: "${userInput}"\nAI answered: "${botResponse.slice(0, 500)}"`,
            },
        ],
        temperature: 0.2,
        max_tokens: 20,
    });

    return response.choices[0]?.message?.content?.trim() || null;
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
    getChatCompletion,
    generateSessionTitle,
    embedTexts,
    embedQuery,
};
