const memoTitleEl = document.getElementById("completeMemoTitle");

const memoNumber = resolveMemoNumber(
    new URLSearchParams(window.location.search).get("memoID")
);

if (memoNumber) {
    memoTitleEl.textContent = `Memo ${memoNumber}`;
} else {
    memoTitleEl.hidden = true;
}
