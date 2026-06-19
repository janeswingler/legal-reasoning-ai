const TARGET_CHARS = 750;
const MAX_CHARS = 900;
const OVERLAP_CHARS = 100;

function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
}

function splitParagraphs(text) {
    const normalized = normalizeText(text);
    if (!normalized) {
        return [];
    }

    let parts = normalized
        .split(/\n{2,}/)
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length <= 1 && normalized.length > TARGET_CHARS) {
        parts = normalized
            .split(/(?<=[.!?])\s+/)
            .map((part) => part.trim())
            .filter(Boolean);
    }

    return parts;
}

function pushChunk(chunks, parts, pageStart, pageEnd, sourceFilename) {
    const text = normalizeText(parts.join(" "));
    if (!text) {
        return;
    }

    chunks.push({
        text,
        pageStart,
        pageEnd,
        sourceFilename,
    });
}

function chunkPageText(pageNumber, text, sourceFilename) {
    const paragraphs = splitParagraphs(text);
    const chunks = [];
    let buffer = [];
    let bufferChars = 0;

    for (const paragraph of paragraphs) {
        if (paragraph.length > MAX_CHARS) {
            if (buffer.length) {
                pushChunk(chunks, buffer, pageNumber, pageNumber, sourceFilename);
                buffer = [];
                bufferChars = 0;
            }

            let start = 0;
            while (start < paragraph.length) {
                let end = Math.min(start + TARGET_CHARS, paragraph.length);
                if (end < paragraph.length) {
                    const slice = paragraph.slice(start, end);
                    const lastBreak = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(" "));
                    if (lastBreak > TARGET_CHARS * 0.5) {
                        end = start + lastBreak + 1;
                    }
                }

                pushChunk(
                    chunks,
                    [paragraph.slice(start, end)],
                    pageNumber,
                    pageNumber,
                    sourceFilename
                );
                if (end >= paragraph.length) {
                    break;
                }
                start = Math.max(end - OVERLAP_CHARS, start + 1);
            }
            continue;
        }

        const nextChars = bufferChars + paragraph.length + (buffer.length ? 1 : 0);
        if (buffer.length && nextChars > TARGET_CHARS) {
            pushChunk(chunks, buffer, pageNumber, pageNumber, sourceFilename);
            buffer = [paragraph];
            bufferChars = paragraph.length;
            continue;
        }

        buffer.push(paragraph);
        bufferChars = nextChars;
    }

    if (buffer.length) {
        pushChunk(chunks, buffer, pageNumber, pageNumber, sourceFilename);
    }

    return chunks;
}

function chunkPages(pages, sourceFilename) {
    const chunks = [];

    for (const page of pages) {
        chunks.push(...chunkPageText(page.pageNumber, page.text, sourceFilename));
    }

    if (chunks.length <= 1) {
        return chunks;
    }

    const merged = [];
    for (const chunk of chunks) {
        const previous = merged[merged.length - 1];
        if (
            previous &&
            previous.pageEnd === chunk.pageStart &&
            previous.text.length + chunk.text.length <= MAX_CHARS
        ) {
            previous.text = normalizeText(`${previous.text} ${chunk.text}`);
            previous.pageEnd = chunk.pageEnd;
            continue;
        }
        merged.push({ ...chunk });
    }

    return merged;
}

module.exports = {
    chunkPages,
};
