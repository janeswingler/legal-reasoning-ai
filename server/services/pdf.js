const fs = require("fs");
const pdfParse = require("pdf-parse");

function normalizeText(text) {
    return text.replace(/\s+/g, " ").trim();
}

async function extractPdfPages(filePath) {
    const buffer = fs.readFileSync(filePath);
    const pages = [];
    let pageNumber = 0;

    await pdfParse(buffer, {
        pagerender: async (pageData) => {
            pageNumber += 1;
            const textContent = await pageData.getTextContent();
            const text = normalizeText(textContent.items.map((item) => item.str).join(" "));

            if (text) {
                pages.push({ pageNumber, text });
            }

            return text;
        },
    });

    return pages;
}

module.exports = {
    extractPdfPages,
};
