const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");
const chatThreadList = document.getElementById("chatThreadList");
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
    "Hi, I am your legal AI assistant. Ask a question about your memo when you are ready.";

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

let currentChatThreadId = null;
let pendingAttachments = [];
/**
 * In-flight sends keyed by chat thread id.
 * Each chat can generate independently (own abort + optimistic prompt).
 * @type {Map<string, {
 *   userText: string,
 *   attachments: Array,
 *   abortController: AbortController,
 *   streamAbortRequested: boolean
 * }>}
 */
const pendingByThreadId = new Map();
/** Ignores stale history responses when the student switches chats quickly. */
let historyLoadToken = 0;

function sameChatThreadId(a, b) {
    return a != null && b != null && String(a) === String(b);
}

function threadKey(id) {
    return String(id);
}

function getPendingForThread(id) {
    if (id == null) {
        return null;
    }
    return pendingByThreadId.get(threadKey(id)) || null;
}

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

function chatThreadStorageKey() {
    return `lrai_chatThread_${config.memoId}`;
}

function getStoredChatThreadId() {
    return localStorage.getItem(chatThreadStorageKey());
}

function setStoredChatThreadId(id) {
    if (id) {
        localStorage.setItem(chatThreadStorageKey(), id);
    } else {
        localStorage.removeItem(chatThreadStorageKey());
    }
}

function threadCreatePayload() {
    return {
        participantID: config.participantID,
        // Wire and database still say assignmentId / assignment_id.
        assignmentId: config.memoId,
        studySessionId: config.studySessionId,
        systemID: config.systemID,
    };
}

function threadQuery() {
    return (
        `participantID=${encodeURIComponent(config.participantID)}` +
        `&assignmentId=${encodeURIComponent(config.memoId)}` +
        `&systemID=${encodeURIComponent(config.systemID)}`
    );
}

function chatInteractionProps(extra = {}) {
    return {
        chatThreadId: currentChatThreadId,
        ...extra,
    };
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
 * Used when a conversation is loaded or switched, and when a reply finishes
 * generating, so the end of the answer signals that it is done.
 */
function scrollChatLogToBottom() {
    chatLog.scrollTop = chatLog.scrollHeight;
}

/**
 * Anchors the newest prompt near the top of the chat window, then scrolls
 * further if needed so the typing indicator stays visible. A long prompt would
 * otherwise push the indicator below the fold and the reply looks stalled.
 *
 * Only runs on send, so the reader can scroll away without being yanked back.
 */
function anchorLatestPromptInView(promptEl) {
    if (!promptEl || !chatLog.contains(promptEl)) {
        return;
    }

    const logRect = chatLog.getBoundingClientRect();
    const toContentOffset = (clientTop) => chatLog.scrollTop + (clientTop - logRect.top);

    let target = toContentOffset(promptEl.getBoundingClientRect().top);

    if (typingIndicatorEl && chatLog.contains(typingIndicatorEl)) {
        const indicatorBottom = toContentOffset(
            typingIndicatorEl.getBoundingClientRect().bottom
        );
        target = Math.max(target, indicatorBottom - chatLog.clientHeight);
    }

    const maxScroll = Math.max(0, chatLog.scrollHeight - chatLog.clientHeight);
    chatLog.scrollTop = Math.min(Math.max(0, target), maxScroll);
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

async function appendAssistantMessageAnimated(text, pending = null) {
    const fullText = String(text || "");
    const { messageEl, textEl } = appendMessage("assistant", "");
    messageEl.classList.add("message--streaming");
    textEl.classList.add("message__text--streaming");

    if (!fullText) {
        messageEl.classList.remove("message--streaming");
        textEl.classList.remove("message__text--streaming");
        return { messageEl, textEl, stopped: false };
    }

    if (pending?.streamAbortRequested) {
        messageEl.remove();
        return { messageEl, textEl, stopped: true };
    }

    const tokens = getStreamTokens(fullText);
    const { tokensPerStep, delayMs } = getStreamPace(tokens.length);
    let shownCount = 0;
    let stopped = false;

    while (shownCount < tokens.length) {
        if (pending?.streamAbortRequested) {
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
        if (exchange.botResponse) {
            appendMessage("assistant", exchange.botResponse);
        } else {
            // Kept for the record but never answered: stopped, or the service
            // failed. Show why the prompt has no reply under it.
            const stopped = exchange.stopReason === "aborted";
            appendMessage(
                "assistant",
                stopped
                    ? "*Reply stopped before it finished.*"
                    : "*No reply was received for this message.*"
            );
        }
    });
    scrollChatLogToBottom();
}

function setActiveThreadItem(chatThreadId) {
    chatThreadList.querySelectorAll(".chat-sidebar__item").forEach((item) => {
        item.classList.toggle("is-active", item.dataset.chatThreadId === chatThreadId);
    });
}

async function loadThreads() {
    const response = await fetch(`/api/chat/threads?${threadQuery()}`);
    if (!response.ok) {
        throw new Error("Could not load chat threads");
    }

    const { threads } = await response.json();
    chatThreadList.innerHTML = "";

    threads.forEach((thread) => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "chat-sidebar__item";
        item.dataset.chatThreadId = thread._id;
        item.textContent = thread.title || "New Chat";
        item.addEventListener("click", () => selectThread(thread._id));
        chatThreadList.appendChild(item);
    });

    if (currentChatThreadId) {
        setActiveThreadItem(currentChatThreadId);
    }

    return threads;
}

/**
 * Re-show the optimistic user bubble (+ typing dots) when returning to a chat
 * whose reply has not been saved yet. History only includes completed exchanges.
 */
function restorePendingChatUi(chatThreadId) {
    const pending = getPendingForThread(chatThreadId);
    if (!pending) {
        return;
    }

    const { rowEl } = appendMessage("user", pending.userText, pending.attachments);
    showTypingIndicator();
    anchorLatestPromptInView(rowEl);
}

async function loadConversationHistory(chatThreadId) {
    const token = ++historyLoadToken;
    const response = await fetch(
        `/api/chat/threads/${encodeURIComponent(chatThreadId)}/history?${threadQuery()}`
    );

    if (!response.ok) {
        throw new Error("Could not load chat history");
    }

    const { exchanges } = await response.json();

    // Student may have switched away while this fetch was in flight.
    if (token !== historyLoadToken || !sameChatThreadId(currentChatThreadId, chatThreadId)) {
        return;
    }

    renderHistory(exchanges);
    restorePendingChatUi(chatThreadId);
}

async function loadPendingAttachments() {
    if (!currentChatThreadId) {
        setPendingAttachments([]);
        return;
    }

    const response = await fetch(
        `/api/chat/threads/${encodeURIComponent(currentChatThreadId)}/attachments?${threadQuery()}`
    );

    if (!response.ok) {
        setPendingAttachments([]);
        return;
    }

    const { attachments } = await response.json();
    setPendingAttachments(attachments);
}

async function removePendingAttachment(attachmentId) {
    if (!currentChatThreadId) return;

    const response = await fetch(
        `/api/chat/threads/${encodeURIComponent(currentChatThreadId)}/attachments/${encodeURIComponent(attachmentId)}?${threadQuery()}`,
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
        const chatThreadId = await ensureChatThread();
        const formData = new FormData();
        formData.append("file", file);
        formData.append("participantID", config.participantID);
        formData.append("assignmentId", config.memoId);

        const response = await fetch(
            `/api/chat/threads/${encodeURIComponent(chatThreadId)}/attachments?${threadQuery()}`,
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

        logEvent({
            eventType: "attachment_add",
            elementName: "Chat PDF Attachment",
            page: "chat",
            valueNum: file.size,
            eventProps: { ...chatInteractionProps(), filename: file.name, sizeBytes: file.size },
        });

        pendingAttachments.push(attachment);
        renderPendingAttachments();
    } finally {
        setAttachUploading(false);
        chatFileInput.value = "";
    }
}

async function selectThread(chatThreadId) {
    if (!sameChatThreadId(currentChatThreadId, chatThreadId)) {
        logEvent({
            eventType: "chat_thread_switch",
            elementName: "chat-thread",
            page: "chat",
            eventProps: {
                fromChatThreadId: currentChatThreadId,
                toChatThreadId: chatThreadId,
            },
        });
    }

    currentChatThreadId = chatThreadId;
    setStoredChatThreadId(chatThreadId);
    setActiveThreadItem(chatThreadId);
    await loadConversationHistory(chatThreadId);
    await loadPendingAttachments();
    updateSendButtonState();
}

async function createChatThread() {
    const response = await fetch("/api/chat/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(threadCreatePayload()),
    });

    if (!response.ok) {
        throw new Error("Could not create chat thread");
    }

    const { thread } = await response.json();
    currentChatThreadId = thread._id;
    setStoredChatThreadId(thread._id);
    await loadThreads();
    setActiveThreadItem(thread._id);
    return thread._id;
}

async function ensureChatThread() {
    if (currentChatThreadId) {
        return currentChatThreadId;
    }
    return createChatThread();
}

function startNewChat() {
    currentChatThreadId = null;
    setStoredChatThreadId(null);
    showWelcomeMessage();
    setPendingAttachments([]);
    chatThreadList.querySelectorAll(".chat-sidebar__item").forEach((item) => {
        item.classList.remove("is-active");
    });
    updateSendButtonState();
    logEvent({
        eventType: "chat_new",
        elementName: "New Chat Button",
        page: "chat",
    });
}

async function initChat() {
    try {
        const threads = await loadThreads();
        const savedChatThreadId = getStoredChatThreadId();

        if (savedChatThreadId) {
            const savedThread = threads.find((thread) => thread._id === savedChatThreadId);
            if (savedThread) {
                await selectThread(savedChatThreadId);
                return;
            }
            setStoredChatThreadId(null);
        }

        if (threads.length > 0) {
            await selectThread(threads[0]._id);
            return;
        }

        showWelcomeMessage();
    } catch (error) {
        showWelcomeMessage();
    }
}

/** True only when the open chat itself is generating a reply. */
function isViewingGeneratingThread() {
    return Boolean(getPendingForThread(currentChatThreadId));
}

function updateSendButtonState() {
    if (isViewingGeneratingThread()) {
        sendBtn.disabled = false;
        sendBtn.type = "button";
        sendBtn.classList.add("chat-composer__send--stop");
        sendBtn.removeAttribute("title");
        sendBtn.setAttribute("aria-label", "Stop generating");
        sendBtnIcon.innerHTML = STOP_ICON_SVG;
        return;
    }

    sendBtn.type = "submit";
    sendBtn.classList.remove("chat-composer__send--stop");
    sendBtn.removeAttribute("title");
    sendBtn.setAttribute("aria-label", "Send message");
    sendBtnIcon.innerHTML = SEND_ICON_SVG;
    sendBtn.disabled = chatInput.value.trim().length === 0;
}

function stopChatGeneration() {
    const pending = getPendingForThread(currentChatThreadId);
    if (!pending) {
        return;
    }
    pending.streamAbortRequested = true;
    pending.abortController.abort();
}

function resizeChatInput() {
    chatInput.style.overflowY = "hidden";
    chatInput.style.height = "auto";
    const nextHeight = chatInput.scrollHeight;
    chatInput.style.height = `${nextHeight}px`;

    const maxHeight = parseFloat(window.getComputedStyle(chatInput).maxHeight);
    if (Number.isFinite(maxHeight) && nextHeight > maxHeight) {
        chatInput.style.overflowY = "auto";
    }
}

sendBtn.addEventListener("click", (event) => {
    if (!isViewingGeneratingThread()) return;
    event.preventDefault();
    logEvent({
        eventType: "chat_stop",
        elementName: "Stop Button",
        page: "chat",
        eventProps: chatInteractionProps(),
    });
    stopChatGeneration();
});

chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    // Only block if THIS chat is already generating — other chats stay independent.
    if (isViewingGeneratingThread()) return;

    const text = chatInput.value.trim();
    if (!text) return;

    logEvent({
        eventType: "chat_send",
        elementName: "Send Button",
        page: "chat",
        valueNum: text.length,
        eventProps: {
            ...chatInteractionProps(),
            promptChars: text.length,
            attachmentCount: pendingAttachments.length,
        },
    });

    let requestThreadId = null;
    const sendStartedAt = Date.now();

    try {
        const chatThreadId = await ensureChatThread();
        requestThreadId = chatThreadId;

        if (getPendingForThread(chatThreadId)) {
            return;
        }

        const attachmentsForMessage = [...pendingAttachments];
        const attachmentIds = attachmentsForMessage.map((attachment) => attachment._id);
        const abortController = new AbortController();
        const pending = {
            userText: text,
            attachments: attachmentsForMessage,
            abortController,
            streamAbortRequested: false,
        };
        pendingByThreadId.set(threadKey(chatThreadId), pending);
        updateSendButtonState();

        const { rowEl: promptRowEl } = appendMessage("user", text, attachmentsForMessage);
        setPendingAttachments([]);
        chatInput.value = "";
        resizeChatInput();
        showTypingIndicator();
        anchorLatestPromptInView(promptRowEl);

        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: abortController.signal,
            body: JSON.stringify({
                participantID: config.participantID,
                studySessionId: config.studySessionId,
                chatThreadId,
                systemID: config.systemID,
                assignmentId: config.memoId,
                userInput: text,
                attachmentIds,
            }),
        });

        const viewingRequestThread = sameChatThreadId(currentChatThreadId, requestThreadId);
        if (viewingRequestThread) {
            hideTypingIndicator();
        }

        if (!response.ok) {
            let errorText = "Sorry, something went wrong.";
            if (response.status === 503) {
                errorText = "Chat is not configured yet. Please contact the study administrator.";
            }
            if (viewingRequestThread) {
                appendMessage("assistant", errorText);
            }
            if (viewingRequestThread) {
                await loadPendingAttachments();
            }
            return;
        }

        const exchange = await response.json();

        logEvent({
            eventType: "chat_response",
            elementName: "assistant-reply",
            page: "chat",
            valueNum: Date.now() - sendStartedAt,
            durationMs: Date.now() - sendStartedAt,
            eventProps: {
                chatThreadId: requestThreadId,
                responseChars: (exchange.botResponse || "").length,
                attachmentCount: attachmentIds.length,
                retrievedChunks: exchange.retrievedChunkIds?.length ?? 0,
            },
        });

        if (pending.streamAbortRequested) {
            return;
        }

        // Only paint into the open thread. If the student is elsewhere, the
        // exchange is already saved and will appear when they open this chat.
        if (sameChatThreadId(currentChatThreadId, requestThreadId)) {
            await appendAssistantMessageAnimated(exchange.botResponse, pending);

            // Land at the end of the reply so it reads as finished.
            if (sameChatThreadId(currentChatThreadId, requestThreadId)) {
                scrollChatLogToBottom();
            }
        }
        await loadThreads();
    } catch (error) {
        const viewingRequestThread = sameChatThreadId(currentChatThreadId, requestThreadId);
        if (viewingRequestThread) {
            hideTypingIndicator();
        }
        if (error?.name === "AbortError") {
            // Stop cancels before the exchange is saved — drop the optimistic bubble.
            if (viewingRequestThread && requestThreadId != null) {
                await loadConversationHistory(requestThreadId).catch(() => {
                    showWelcomeMessage();
                });
            }
            return;
        }
        if (viewingRequestThread) {
            appendMessage("assistant", "Sorry, something went wrong.");
            await loadPendingAttachments();
        }
    } finally {
        if (requestThreadId != null) {
            pendingByThreadId.delete(threadKey(requestThreadId));
        }
        updateSendButtonState();
        // Hand the cursor back to the message box only if the student is
        // still in the chat. A reply can take a while, and if they have gone
        // on writing in the editor meanwhile, pulling focus away from it
        // would interrupt their typing.
        if (
            sameChatThreadId(currentChatThreadId, requestThreadId) &&
            focusIsFreeForChat()
        ) {
            chatInput.focus();
        }
    }
});

/**
 * True when nothing else is being typed into: focus is on the page body, or
 * already somewhere inside the chat pane. False whenever the student is in
 * the editor or any other control outside the chat.
 */
function focusIsFreeForChat() {
    const active = document.activeElement;
    if (!active || active === document.body) {
        return true;
    }
    const chatPane = document.querySelector(".panel-chat");
    return Boolean(chatPane && chatPane.contains(active));
}

chatInput.addEventListener("input", () => {
    resizeChatInput();
    updateSendButtonState();
});

chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (isViewingGeneratingThread() || sendBtn.disabled) return;
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
        logEvent({
            eventType: "sidebar_toggle",
            elementName: nextCollapsed ? "Hide Chat Sidebar" : "Show Chat Sidebar",
            page: "chat",
            eventProps: { collapsed: nextCollapsed },
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

// Copy and paste are captured with their text by instrumentation.js, which
// records the content itself rather than only the location.

initChat();
} // end AI-enabled chat bootstrap