const OpenAI = require("openai");

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

function buildSystemPrompt(assignmentId) {
    return (
        "You are a legal AI assistant helping law students with weekly legal reasoning assignments. " +
        "Be clear, accurate, and educational. Do not give definitive legal advice for real cases. " +
        "Answer in plain language; use Markdown sparingly when it improves clarity. " +
        `The student's current assignment is: ${assignmentId}.`
    );
}

function buildChatMessages(exchanges, assignmentId, userInput) {
    const history = [];

    for (const exchange of exchanges) {
        history.push({ role: "user", content: exchange.userInput });
        history.push({ role: "assistant", content: exchange.botResponse });
    }

    return [
        { role: "system", content: buildSystemPrompt(assignmentId) },
        ...history,
        { role: "user", content: userInput },
    ];
}

async function getChatCompletion(exchanges, assignmentId, userInput) {
    const openai = getClient();
    const messages = buildChatMessages(exchanges, assignmentId, userInput);

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

module.exports = {
    getChatCompletion,
    generateSessionTitle,
};
