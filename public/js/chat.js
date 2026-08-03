const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatSessionList = document.getElementById("chatSessionList");
const newChatBtn = document.getElementById("newChatBtn");
const chatComposerPending = document.getElementById("chatComposerPending");
const chatComposerPendingList = document.getElementById("chatComposerPendingList");
const attachFileBtn = document.getElementById("attachFileBtn");
const chatFileInput = document.getElementById("chatFileInput");
const sendBtn = document.getElementById("sendBtn");
const chatLayout = document.getElementById("chatLayout");
const chatSidebarToggle = document.getElementById("chatSidebarToggle");

// systemID=1 is editor-only — do not initialize chat.
if (!config.isAiEnabled || !chatForm || !sendBtn) {
    // Skip chat bootstrap.
} else {
const sendBtnIcon = sendBtn.querySelector(".chat-composer__send-icon");

const WELCOME_MESSAGE =
    "Hi, I am your legal AI assistant. Ask a question about your assignment when you are ready.";

const SEND_ICON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none">
    <path
        d="M12 19V5"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
    />
    <path
        d="M5 12l7-7 7 7"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
    />
</svg>`;

const STOP_ICON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
</svg>`;

let currentChatSessionId = null;
let pendingAttachments = [];
let chatBusy = false;
let activeChatAbortController = null;
let streamAbortRequested = false;

const PDF_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
    />
    <path
        d="M14 2v6h6M9 13h6M9 17h4"
        stroke="currentColor"
        stroke-width="1.75"
        stroke-linecap="round"
        stroke-linejoin="round"
    />
</svg>`;

function attachmentStatusText(attachment) {
    if (attachment.status === "processing") {
        return "Processing…";
    }
    if (attachment.status === "failed") {
        return "Failed";
    }
    return null;
}

function normalizeAttachments(attachments) {
    if (!Array.isArray(attachments)) {
        return [];
    }

    return attachments
        .map((attachment) => {
            if (!attachment) {
                return null;
            }

            if (typeof attachment === "string") {
                return { _id: attachment, originalFilename: "Attached PDF" };
            }

            return attachment;
        })
        .filter(Boolean);
}

function createMessageAttachmentEl(attachment) {
    const item = document.createElement("div");
    item.className = "message-attachment";

    const icon = document.createElement("span");
    icon.className = "message-attachment__icon";
    icon.innerHTML = PDF_ICON_SVG;

    const name = document.createElement("span");
    name.className = "message-attachment__name";
    name.textContent = attachment.originalFilename;
    name.title = attachment.originalFilename;

    item.appendChild(icon);
    item.appendChild(name);
    return item;
}

function createPendingAttachmentEl(attachment) {
    const item = document.createElement("li");
    item.className = "chat-pending-attachment";
    item.dataset.attachmentId = attachment._id;

    const icon = document.createElement("span");
    icon.className = "chat-pending-attachment__icon";
    icon.innerHTML = PDF_ICON_SVG;

    const name = document.createElement("span");
    name.className = "chat-pending-attachment__name";
    name.textContent = attachment.originalFilename;
    name.title = attachment.originalFilename;

    item.appendChild(icon);
    item.appendChild(name);

    const statusText = attachmentStatusText(attachment);
    if (statusText) {
        const status = document.createElement("span");
        status.className = "chat-pending-attachment__status";
        status.textContent = statusText;
        item.appendChild(status);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "chat-pending-attachment__remove";
    removeBtn.setAttribute("aria-label", `Remove ${attachment.originalFilename}`);
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => removePendingAttachment(attachment._id));

    item.appendChild(removeBtn);

    return item;
}

function renderPendingAttachments() {
    chatComposerPendingList.innerHTML = "";

    if (!pendingAttachments.length) {
        chatComposerPending.hidden = true;
        return;
    }

    chatComposerPending.hidden = false;
    pendingAttachments.forEach((attachment) => {
        chatComposerPendingList.appendChild(createPendingAttachmentEl(attachment));
    });
}

function setPendingAttachments(attachments) {
    pendingAttachments = attachments;
    renderPendingAttachments();
}

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
        `&assignmentId=${encodeURIComponent(config.assignmentId)}` +
        `&systemID=${encodeURIComponent(config.systemID)}`
    );
}

function chatInteractionProps(extra = {}) {
    return {
        chatSessionId: currentChatSessionId,
        ...extra,
    };
}

function getChatMessageRoleFromNode(node) {
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const message = element?.closest?.(".message");
    if (!message || !chatLog.contains(message)) {
        return null;
    }
    if (message.classList.contains("message--user")) {
        return "user";
    }
    if (message.classList.contains("message--assistant")) {
        return "assistant";
    }
    return null;
}

function renderAssistantHtml(text) {
    if (typeof marked !== "undefined" && typeof marked.parse === "function") {
        return marked.parse(text, { breaks: true, gfm: true });
    }

    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, "<br>");
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function getStreamTokens(text) {
    return String(text).match(/\S+\s*|\s+/g) || [String(text)];
}

function getStreamPace(tokenCount) {
    const targetMs = Math.min(5500, Math.max(1800, tokenCount * 90));
    const frameMs = 42;
    const steps = Math.max(1, Math.ceil(targetMs / frameMs));
    return {
        tokensPerStep: 1,
        delayMs: Math.max(frameMs, Math.floor(targetMs / Math.max(1, tokenCount))),
    };
}

/**
 * Jumps to the newest message.
 *
 * Only used when a conversation is loaded or switched, where the log has just
 * been rebuilt from scratch and there is no reading position to preserve.
 *
 * Sending a message and streaming a response deliberately do NOT scroll - the
 * view stays exactly where the reader left it, and scrolling is manual only.
 */
function scrollChatLogToBottom() {
    chatLog.scrollTop = chatLog.scrollHeight;
}

function appendMessage(role, text, attachments = []) {
    const normalizedAttachments = normalizeAttachments(attachments);
    const messageEl = document.createElement("div");
    messageEl.classList.add("message", role === "user" ? "message--user" : "message--assistant");

    const textEl = document.createElement("div");
    textEl.classList.add("message__text");

    if (role === "assistant") {
        textEl.innerHTML = renderAssistantHtml(text);
    } else {
        textEl.textContent = text;
    }

    messageEl.appendChild(textEl);

    let rowEl = messageEl;
    if (role === "user" && normalizedAttachments.length > 0) {
        rowEl = document.createElement("div");
        rowEl.classList.add("message-group", "message-group--user");

        const attachmentsEl = document.createElement("div");
        attachmentsEl.classList.add("message-group__attachments");
        normalizedAttachments.forEach((attachment) => {
            attachmentsEl.appendChild(createMessageAttachmentEl(attachment));
        });

        rowEl.appendChild(attachmentsEl);
        rowEl.appendChild(messageEl);
    }

    chatLog.appendChild(rowEl);
    return { messageEl, textEl, rowEl };
}

async function appendAssistantMessageAnimated(text) {
    const fullText = String(text || "");
    const { messageEl, textEl } = appendMessage("assistant", "");
    messageEl.classList.add("message--streaming");
    textEl.classList.add("message__text--streaming");

    if (!fullText) {
        messageEl.classList.remove("message--streaming");
        textEl.classList.remove("message__text--streaming");
        return { messageEl, textEl, stopped: false };
    }

    if (streamAbortRequested) {
        messageEl.remove();
        return { messageEl, textEl, stopped: true };
    }

    const tokens = getStreamTokens(fullText);
    const { tokensPerStep, delayMs } = getStreamPace(tokens.length);
    let shownCount = 0;
    let stopped = false;

    while (shownCount < tokens.length) {
        if (streamAbortRequested) {
            stopped = true;
            break;
        }
        shownCount = Math.min(tokens.length, shownCount + tokensPerStep);
        const partial = tokens.slice(0, shownCount).join("");
        textEl.innerHTML = renderAssistantHtml(partial);
        await sleep(delayMs);
    }

    if (stopped && shownCount === 0) {
        messageEl.remove();
    } else {
        const finalText = stopped
            ? tokens.slice(0, shownCount).join("")
            : fullText;
        textEl.innerHTML = renderAssistantHtml(finalText);
        messageEl.classList.remove("message--streaming");
        textEl.classList.remove("message__text--streaming");
        textEl.setAttribute("aria-live", "polite");
    }

    return { messageEl, textEl, stopped };
}

let typingIndicatorEl = null;

function showTypingIndicator() {
    hideTypingIndicator();

    typingIndicatorEl = document.createElement("div");
    typingIndicatorEl.className = "message message--assistant message--typing";
    typingIndicatorEl.setAttribute("aria-label", "Assistant is typing");

    const dotsEl = document.createElement("div");
    dotsEl.className = "typing-indicator";
    dotsEl.innerHTML = "<span></span><span></span><span></span>";

    typingIndicatorEl.appendChild(dotsEl);
    chatLog.appendChild(typingIndicatorEl);
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
        appendMessage("user", exchange.userInput, exchange.attachmentIds);
        appendMessage("assistant", exchange.botResponse);
    });
    scrollChatLogToBottom();
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

async function loadPendingAttachments() {
    if (!currentChatSessionId) {
        setPendingAttachments([]);
        return;
    }

    const response = await fetch(
        `/api/chat/sessions/${encodeURIComponent(currentChatSessionId)}/attachments?${sessionQuery()}`
    );

    if (!response.ok) {
        setPendingAttachments([]);
        return;
    }

    const { attachments } = await response.json();
    setPendingAttachments(attachments);
}

async function removePendingAttachment(attachmentId) {
    if (!currentChatSessionId) return;

    const response = await fetch(
        `/api/chat/sessions/${encodeURIComponent(currentChatSessionId)}/attachments/${encodeURIComponent(attachmentId)}?${sessionQuery()}`,
        { method: "DELETE" }
    );

    if (!response.ok) {
        alert("Could not remove attachment");
        return;
    }

    pendingAttachments = pendingAttachments.filter(
        (attachment) => String(attachment._id) !== String(attachmentId)
    );
    renderPendingAttachments();
}

function setAttachUploading(isUploading) {
    attachFileBtn.disabled = isUploading;
    attachFileBtn.classList.toggle("is-uploading", isUploading);
    attachFileBtn.setAttribute("aria-busy", isUploading ? "true" : "false");
    attachFileBtn.setAttribute("aria-label", isUploading ? "Uploading PDF" : "Attach PDF");
}

async function uploadAttachment(file) {
    setAttachUploading(true);

    try {
        const chatSessionId = await ensureChatSession();
        const formData = new FormData();
        formData.append("file", file);
        formData.append("participantID", config.participantID);
        formData.append("assignmentId", config.assignmentId);

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

        const { attachment } = await response.json();

        logSystemInteraction({
            eventType: "upload",
            elementName: "Chat PDF Attachment",
            page: "chat",
            eventProps: { filename: file.name },
        });

        pendingAttachments.push(attachment);
        renderPendingAttachments();
    } finally {
        setAttachUploading(false);
        chatFileInput.value = "";
    }
}

async function selectSession(chatSessionId) {
    currentChatSessionId = chatSessionId;
    setStoredChatSessionId(chatSessionId);
    setActiveSessionItem(chatSessionId);
    await loadConversationHistory(chatSessionId);
    await loadPendingAttachments();
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
    setPendingAttachments([]);
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

function setChatBusy(busy) {
    chatBusy = busy;
    updateSendButtonState();
}

function updateSendButtonState() {
    if (chatBusy) {
        sendBtn.disabled = false;
        sendBtn.type = "button";
        sendBtn.classList.add("chat-composer__send--stop");
        sendBtn.setAttribute("aria-label", "Stop generating");
        sendBtnIcon.innerHTML = STOP_ICON_SVG;
        return;
    }

    sendBtn.type = "submit";
    sendBtn.classList.remove("chat-composer__send--stop");
    sendBtn.setAttribute("aria-label", "Send message");
    sendBtnIcon.innerHTML = SEND_ICON_SVG;
    sendBtn.disabled = chatInput.value.trim().length === 0;
}

function stopChatGeneration() {
    streamAbortRequested = true;
    if (activeChatAbortController) {
        activeChatAbortController.abort();
        activeChatAbortController = null;
    }
}

function resizeChatInput() {
    chatInput.style.height = "auto";
    chatInput.style.height = `${chatInput.scrollHeight}px`;
}

sendBtn.addEventListener("click", (event) => {
    if (!chatBusy) return;
    event.preventDefault();
    logSystemInteraction({ eventType: "click", elementName: "Stop Button", page: "chat" });
    stopChatGeneration();
});

chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (chatBusy) return;

    const text = chatInput.value.trim();
    if (!text) return;

    logSystemInteraction({ eventType: "click", elementName: "Send Button", page: "chat" });

    streamAbortRequested = false;
    activeChatAbortController = new AbortController();
    const { signal } = activeChatAbortController;
    setChatBusy(true);

    try {
        const chatSessionId = await ensureChatSession();
        const attachmentsForMessage = [...pendingAttachments];
        const attachmentIds = attachmentsForMessage.map((attachment) => attachment._id);

        appendMessage("user", text, attachmentsForMessage);
        setPendingAttachments([]);
        chatInput.value = "";
        resizeChatInput();
        showTypingIndicator();

        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal,
            body: JSON.stringify({
                participantID: config.participantID,
                sessionID: config.sessionID,
                chatSessionId,
                systemID: config.systemID,
                assignmentId: config.assignmentId,
                userInput: text,
                attachmentIds,
            }),
        });

        hideTypingIndicator();

        if (!response.ok) {
            let errorText = "Sorry, something went wrong.";
            if (response.status === 503) {
                errorText = "Chat is not configured yet. Please contact the study administrator.";
            }
            appendMessage("assistant", errorText);
            await loadPendingAttachments();
            return;
        }

        const exchange = await response.json();
        if (streamAbortRequested) {
            return;
        }
        await appendAssistantMessageAnimated(exchange.botResponse);
        await loadSessions();
    } catch (error) {
        hideTypingIndicator();
        if (error?.name === "AbortError") {
            return;
        }
        appendMessage("assistant", "Sorry, something went wrong.");
        await loadPendingAttachments();
    } finally {
        activeChatAbortController = null;
        streamAbortRequested = false;
        setChatBusy(false);
        chatInput.focus();
    }
});

chatInput.addEventListener("input", () => {
    resizeChatInput();
    updateSendButtonState();
});

chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (chatBusy || sendBtn.disabled) return;
        chatForm.requestSubmit();
    }
});

resizeChatInput();

newChatBtn.addEventListener("click", startNewChat);

function setChatSidebarCollapsed(collapsed) {
    if (!chatLayout || !chatSidebarToggle) {
        return;
    }

    chatLayout.classList.toggle("is-sidebar-collapsed", collapsed);
    chatSidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    const label = collapsed ? "Open sidebar" : "Close sidebar";
    chatSidebarToggle.setAttribute("aria-label", label);
    chatSidebarToggle.setAttribute("data-tooltip", label);
    chatSidebarToggle.removeAttribute("title");
}

if (chatSidebarToggle && chatLayout) {
    setChatSidebarCollapsed(false);

    chatSidebarToggle.addEventListener("click", () => {
        const nextCollapsed = !chatLayout.classList.contains("is-sidebar-collapsed");
        setChatSidebarCollapsed(nextCollapsed);
        logSystemInteraction({
            eventType: "click",
            elementName: nextCollapsed ? "Hide Chat Sidebar" : "Show Chat Sidebar",
            page: "chat",
        });
    });
}

attachFileBtn.addEventListener("click", () => {
    chatFileInput.click();
});

chatFileInput.addEventListener("change", async () => {
    const file = chatFileInput.files?.[0];
    if (!file) return;
    await uploadAttachment(file);
});

chatLog.addEventListener("copy", () => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed) {
        return;
    }

    const messageRole = getChatMessageRoleFromNode(selection.anchorNode);
    if (!messageRole) {
        return;
    }

    logSystemInteraction({
        eventType: "copy",
        elementName: "chat-message",
        page: "chat",
        eventProps: chatInteractionProps({ messageRole }),
    });
});

chatInput.addEventListener("paste", () => {
    logSystemInteraction({
        eventType: "paste",
        elementName: "chat-input",
        page: "chat",
        eventProps: chatInteractionProps(),
    });
});

initChat();
} // end AI-enabled chat bootstrap