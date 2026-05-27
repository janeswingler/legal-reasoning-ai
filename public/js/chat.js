const chatLog = document.getElementById("chatLog")
const chatForm = document.getElementById("chatForm")
const chatInput = document.getElementById("chatInput")

function appendMessage(role, text) {
    const messageEl = document.createElement("div"); // creates a message div
    messageEl.classList.add("message", role === "user" ? "message--user" : "message--assistant"); // applies existing css bubble styles to the div, first class is message (always applied), next class applied depends on role

    const roleEl = document.createElement("span"); // creates a span element (generic inline container)
    roleEl.classList.add("message__role"); // adds the class for small caps label styling
    roleEl.textContent = role == "user" ? "You" : "Assistant";

    const textEl = document.createElement("p"); // creates an empty p element for message body
    textEl.classList.add("message__text"); // adds the class for styling
    textEl.textContent = text; // puts the function argument text into the paragraph

    messageEl.appendChild(roleEl);
    messageEl.appendChild(textEl); // puts paragraph inside the same bubble div
    chatLog.appendChild(messageEl); // attaches the complete bubble to the log
    chatLog.scrollTop = chatLog.scrollHeight; // scrolls the log so the newest message is visible (jumps to the bottom) 
}

// Handle form submit
chatForm.addEventListener("submit", (event) => { // runs on Send or Enter in the input
    event.preventDefault(); // prevent browser reload

    const text = chatInput.value.trim();
    if (!text) return;

    appendMessage("user", text);
    chatInput.value = "";

    appendMessage("assistant", "Thanks, responses coming soon :) ");
});

