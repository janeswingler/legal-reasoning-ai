const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatSessionList = document.getElementById("chatSessionList");
const newChatBtn = document.getElementById("newChatBtn");
const chatAttachmentsEl = document.getElementById("chatAttachments");
const chatAttachmentList = document.getElementById("chatAttachmentList");
const attachFileBtn = document.getElementById("attachFileBtn");
const chatFileInput = document.getElementById("chatFileInput");

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

function renderAssistantHtml(text) {
    if (typeof marked !== "undefined" && typeof marked.parse === "function") {
        return marked.parse(text, { breaks: true, gfm: true });
    }

    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, "<br>");
}

function appendMessage(role, text) {
    const messageEl = document.createElement("div");
    messageEl.classList.add("message", role === "user" ? "message--user" : "message--assistant");

    const roleEl = document.createElement("span");
    roleEl.classList.add("message__role");
    roleEl.textContent = role === "user" ? "You" : "Assistant";

    const textEl = document.createElement("div");
    textEl.classList.add("message__text");

    if (role === "assistant") {
        textEl.innerHTML = renderAssistantHtml(text);
    } else {
        textEl.textContent = text;
    }

    messageEl.appendChild(roleEl);
    messageEl.appendChild(textEl);
    chatLog.appendChild(messageEl);
    chatLog.scrollTop = chatLog.scrollHeight;
}

let typingIndicatorEl = null;

function showTypingIndicator() {
    hideTypingIndicator();

    typingIndicatorEl = document.createElement("div");
    typingIndicatorEl.className = "message message--assistant message--typing";
    typingIndicatorEl.setAttribute("aria-live", "polite");
    typingIndicatorEl.setAttribute("aria-label", "Assistant is typing");

    const roleEl = document.createElement("span");
    roleEl.className = "message__role";
    roleEl.textContent = "Assistant";

    const dotsEl = document.createElement("div");
    dotsEl.className = "typing-indicator";
    dotsEl.innerHTML = "<span></span><span></span><span></span>";

    typingIndicatorEl.appendChild(roleEl);
    typingIndicatorEl.appendChild(dotsEl);
    chatLog.appendChild(typingIndicatorEl);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function hideTypingIndicator() {
    if (typingIndicatorEl) {
        typingIndicatorEl.remove();
        typingIndicatorEl = null;
    }
}

function showWelcomeMessage() {
    chatLog.innerHTML = "";
    appendMessage("assistant", WELCOME_MESSAGE);
}

function clearChatLog() {
    hideTypingIndicator();
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

async function loadAttachments() {
    chatAttachmentList.innerHTML = "";

    if (!currentChatSessionId) {
        chatAttachmentsEl.hidden = true;
        return;
    }

    const response = await fetch(
        `/api/chat/sessions/${encodeURIComponent(currentChatSessionId)}/attachments?${sessionQuery()}`
    );

    if (!response.ok) {
        chatAttachmentsEl.hidden = true;
        return;
    }

    const { attachments } = await response.json();

    if (!attachments.length) {
        chatAttachmentsEl.hidden = true;
        return;
    }

    chatAttachmentsEl.hidden = false;

    attachments.forEach((attachment) => {
        const item = document.createElement("li");
        item.className = "chat-attachment-chip";

        const name = document.createElement("span");
        name.className = "chat-attachment-chip__name";
        name.textContent = attachment.originalFilename;
        name.title = attachment.originalFilename;

        const status = document.createElement("span");
        status.className = "chat-attachment-chip__status";
        if (attachment.status === "processing") {
            status.textContent = "Processing…";
        } else if (attachment.status === "failed") {
            status.textContent = "Failed";
        } else {
            status.textContent = `${attachment.chunkCount} sections`;
        }

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "chat-attachment-chip__remove";
        removeBtn.setAttribute("aria-label", `Remove ${attachment.originalFilename}`);
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => deleteAttachment(attachment._id));

        item.appendChild(name);
        item.appendChild(status);
        item.appendChild(removeBtn);
        chatAttachmentList.appendChild(item);
    });
}

async function deleteAttachment(attachmentId) {
    if (!currentChatSessionId) return;

    const response = await fetch(
        `/api/chat/sessions/${encodeURIComponent(currentChatSessionId)}/attachments/${encodeURIComponent(attachmentId)}?${sessionQuery()}`,
        { method: "DELETE" }
    );

    if (!response.ok) {
        alert("Could not remove attachment");
        return;
    }

    await loadAttachments();
}

async function uploadAttachment(file) {
    const chatSessionId = await ensureChatSession();
    const formData = new FormData();
    formData.append("file", file);
    formData.append("participantID", config.participantID);
    formData.append("assignmentId", config.assignmentId);

    attachFileBtn.disabled = true;

    try {
        const response = await fetch(
            `/api/chat/sessions/${encodeURIComponent(chatSessionId)}/attachments?${sessionQuery()}`,
            {
                method: "POST",
                body: formData,
            }
        );

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            alert(error.error || "Could not upload PDF");
            return;
        }

        logSystemInteraction({
            eventType: "upload",
            elementName: "Chat PDF Attachment",
            page: "chat",
            eventProps: { filename: file.name },
        });

        await loadAttachments();
    } finally {
        attachFileBtn.disabled = false;
        chatFileInput.value = "";
    }
}

async function selectSession(chatSessionId) {
    currentChatSessionId = chatSessionId;
    setStoredChatSessionId(chatSessionId);
    setActiveSessionItem(chatSessionId);
    await loadConversationHistory(chatSessionId);
    await loadAttachments();
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
    chatAttachmentsEl.hidden = true;
    chatAttachmentList.innerHTML = "";
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

    const sendBtn = chatForm.querySelector('button[type="submit"]');
    sendBtn.disabled = true;
    chatInput.disabled = true;

    try {
        const chatSessionId = await ensureChatSession();
        appendMessage("user", text);
        chatInput.value = "";
        showTypingIndicator();

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

        hideTypingIndicator();

        if (!response.ok) {
            let errorText = "Sorry, something went wrong.";
            if (response.status === 503) {
                errorText = "Chat is not configured yet. Please contact the study administrator.";
            }
            appendMessage("assistant", errorText);
            return;
        }

        const exchange = await response.json();
        appendMessage("assistant", exchange.botResponse);
        await loadSessions();
    } catch (error) {
        hideTypingIndicator();
        appendMessage("assistant", "Sorry, something went wrong.");
    } finally {
        sendBtn.disabled = false;
        chatInput.disabled = false;
        chatInput.focus();
    }
});

newChatBtn.addEventListener("click", startNewChat);

attachFileBtn.addEventListener("click", () => {
    chatFileInput.click();
});

chatFileInput.addEventListener("change", async () => {
    const file = chatFileInput.files?.[0];
    if (!file) return;
    await uploadAttachment(file);
});

showWelcomeMessage();
initChat();
