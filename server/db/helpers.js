function isValidId(value) {
    if (value === null || value === undefined || value === "") {
        return false;
    }
    const n = Number(value);
    return Number.isInteger(n) && n > 0;
}

function toId(value) {
    return Number(value);
}

function parseJson(value, fallback = null) {
    if (value === null || value === undefined) {
        return fallback;
    }
    if (typeof value === "object") {
        return value;
    }
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function withApiId(row) {
    if (!row) {
        return null;
    }
    return {
        ...row,
        id: Number(row.id),
        _id: String(row.id),
    };
}

function mapKeys(row, keyMap) {
    if (!row) {
        return null;
    }

    const mapped = {};
    for (const [dbKey, apiKey] of Object.entries(keyMap)) {
        if (Object.prototype.hasOwnProperty.call(row, dbKey)) {
            mapped[apiKey] = row[dbKey];
        }
    }

    if (row.id !== undefined) {
        mapped.id = Number(row.id);
        mapped._id = String(row.id);
    }

    return mapped;
}

module.exports = {
    isValidId,
    toId,
    parseJson,
    withApiId,
    mapKeys,
};
