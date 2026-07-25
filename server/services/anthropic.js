const Anthropic = require("@anthropic-ai/sdk");

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const TITLE_MODEL = process.env.ANTHROPIC_TITLE_MODEL || "claude-haiku-4-5";

let client = null;

function getClient() {
    if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    if (!client) {
        client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
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

function buildChatMessages(exchanges, userInput, retrievedContext) {
    const messages = [];

    for (const exchange of exchanges) {
        messages.push({ role: "user", content: exchange.userInput });
        messages.push({ role: "assistant", content: exchange.botResponse });
    }

    messages.push({
        role: "user",
        content: buildUserMessage(userInput, retrievedContext),
    });

    return messages;
}

function extractText(response) {
    if (!response?.content?.length) {
        return "";
    }

    return response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
}

async function getChatCompletion(
    exchanges,
    assignmentId,
    userInput,
    retrievedContext = "",
    { signal } = {}
) {
    const anthropic = getClient();
    const messages = buildChatMessages(exchanges, userInput, retrievedContext);

    const response = await anthropic.messages.create(
        {
            model: MODEL,
            max_tokens: 4096,
            system: buildSystemPrompt(assignmentId, Boolean(retrievedContext)),
            messages,
        },
        signal ? { signal } : undefined
    );

    return extractText(response);
}

async function generateSessionTitle(userInput, botResponse) {
    const anthropic = getClient();

    const response = await anthropic.messages.create({
        model: TITLE_MODEL,
        max_tokens: 32,
        system:
            "You are a title generator. Create a concise title (3–5 words) that captures this conversation's topic. Return only the title, no quotes.",
        messages: [
            {
                role: "user",
                content: `User asked: "${userInput}"\nAI answered: "${botResponse.slice(0, 500)}"`,
            },
        ],
    });

    return extractText(response) || null;
}

module.exports = {
    getChatCompletion,
    generateSessionTitle,
};
