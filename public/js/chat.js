const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatSessionList = document.getElementById("chatSessionList");
const newChatBtn = document.getElementById("newChatBtn");

const WELCOME_MESSAGE =
    "Hi, I am your legal AI assistant. Ask a question about your assignment when you are ready.";

let currentChatSessionId = null;

function chatSessionStorageKey() {
    return `lrai_chatSession_${config.assignmentId}`;
}

function getStoredChatSessionId() {
    return localStorage.getItem(chatSessionStorageKey());
}

function setStoredChatSessionId(id) {
    if (id) {
        localStorage.setItem(chatSessionStorageKey(), id);
    } else {
        localStorage.removeItem(chatSessionStorageKey());
    }
}

function sessionCreatePayload() {
    return {
        participantID: config.participantID,
        assignmentId: config.assignmentId,
        sessionID: config.sessionID,
        systemID: config.systemID,
    };
}

function sessionQuery() {
    return (
        `participantID=${encodeURIComponent(config.participantID)}` +
        `&assignmentId=${encodeURIComponent(config.assignmentId)}`
    );
}

function appendMessage(role, text) {
    const messageEl = document.createElement("div");
    messageEl.classList.add("message", role === "user" ? "message--user" : "message--assistant");

    const roleEl = document.createElement("span");
    roleEl.classList.add("message__role");
    roleEl.textContent = role === "user" ? "You" : "Assistant";

    const textEl = document.createElement("p");
    textEl.classList.add("message__text");
    textEl.textContent = text;

    messageEl.appendChild(roleEl);
    messageEl.appendChild(textEl);
    chatLog.appendChild(messageEl);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function showWelcomeMessage() {
    chatLog.innerHTML = "";
    appendMessage("assistant", WELCOME_MESSAGE);
}

function clearChatLog() {
    chatLog.innerHTML = "";
}

function renderHistory(exchanges) {
    clearChatLog();

    if (!exchanges.length) {
        showWelcomeMessage();
        return;
    }

    exchanges.forEach((exchange) => {
        appendMessage("user", exchange.userInput);
        appendMessage("assistant", exchange.botResponse);
    });
}

function setActiveSessionItem(chatSessionId) {
    chatSessionList.querySelectorAll(".chat-sidebar__item").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.chatSessionId === chatSessionId);
    });
}

async function loadSessions() {
    const response = await fetch(`/api/chat/sessions?${sessionQuery()}`);
    if (!response.ok) {
        throw new Error("Could not load chat sessions");
    }

    const { sessions } = await response.json();
    chatSessionList.innerHTML = "";

    sessions.forEach((session) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "chat-sidebar__item";
        item.dataset.chatSessionId = session._id;
        item.textContent = session.title || "New Chat";
        item.addEventListener("click", () => selectSession(session._id));
        chatSessionList.appendChild(item);
    });

    if (currentChatSessionId) {
        setActiveSessionItem(currentChatSessionId);
    }

    return sessions;
}

async function loadConversationHistory(chatSessionId) {
    const response = await fetch(
        `/api/chat/sessions/${encodeURIComponent(chatSessionId)}/history?${sessionQuery()}`
    );

    if (!response.ok) {
        throw new Error("Could not load chat history");
    }

    const { exchanges } = await response.json();
    renderHistory(exchanges);
}

async function selectSession(chatSessionId) {
    currentChatSessionId = chatSessionId;
    setStoredChatSessionId(chatSessionId);
    setActiveSessionItem(chatSessionId);
    await loadConversationHistory(chatSessionId);
}

async function createChatSession() {
    const response = await fetch("/api/chat/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionCreatePayload()),
    });

    if (!response.ok) {
        throw new Error("Could not create chat session");
    }

    const { session } = await response.json();
    currentChatSessionId = session._id;
    setStoredChatSessionId(session._id);
    await loadSessions();
    setActiveSessionItem(session._id);
    return session._id;
}

async function ensureChatSession() {
    if (currentChatSessionId) {
        return currentChatSessionId;
    }
    return createChatSession();
}

function startNewChat() {
    currentChatSessionId = null;
    setStoredChatSessionId(null);
    showWelcomeMessage();
    chatSessionList.querySelectorAll(".chat-sidebar__item").forEach((item) => {
        item.classList.remove("is-active");
    });
    logSystemInteraction({
        eventType: "click",
        elementName: "New Chat Button",
        page: "chat",
    });
}

async function initChat() {
    try {
        const sessions = await loadSessions();
        const savedChatSessionId = getStoredChatSessionId();

        if (savedChatSessionId) {
            const savedSession = sessions.find((session) => session._id === savedChatSessionId);
            if (savedSession) {
                await selectSession(savedChatSessionId);
                return;
            }
            setStoredChatSessionId(null);
        }

        if (sessions.length > 0) {
            await selectSession(sessions[0]._id);
            return;
        }

        showWelcomeMessage();
    } catch (error) {
        showWelcomeMessage();
    }
}

chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const text = chatInput.value.trim();
    if (!text) return;

    logSystemInteraction({ eventType: "click", elementName: "Send Button", page: "chat" });

    try {
        const chatSessionId = await ensureChatSession();
        appendMessage("user", text);
        chatInput.value = "";

        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                participantID: config.participantID,
                sessionID: config.sessionID,
                chatSessionId,
                systemID: config.systemID,
                assignmentId: config.assignmentId,
                userInput: text,
            }),
        });

        if (!response.ok) {
            appendMessage("assistant", "Sorry, something went wrong.");
            return;
        }

        const exchange = await response.json();
        appendMessage("assistant", exchange.botResponse);
        await loadSessions();
    } catch (error) {
        appendMessage("assistant", "Sorry, something went wrong.");
    }
});

newChatBtn.addEventListener("click", startNewChat);

showWelcomeMessage();
initChat();
