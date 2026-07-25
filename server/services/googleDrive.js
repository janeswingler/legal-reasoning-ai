const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { google } = require("googleapis");

function loadServiceAccountCredentials() {
    const jsonInline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (jsonInline) {
        return JSON.parse(jsonInline);
    }

    const keyFile =
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE ||
        process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (keyFile) {
        const resolved = path.isAbsolute(keyFile)
            ? keyFile
            : path.join(process.cwd(), keyFile);
        return JSON.parse(fs.readFileSync(resolved, "utf8"));
    }

    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

    if (clientEmail && privateKey) {
        return {
            client_email: clientEmail,
            private_key: privateKey.replace(/\\n/g, "\n"),
        };
    }

    throw new Error(
        "Google Drive is not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY_FILE or GOOGLE_SERVICE_ACCOUNT_JSON."
    );
}

function normalizeFolderId(folderId) {
    if (!folderId) {
        return folderId;
    }

    const trimmed = String(folderId).trim();
    const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : trimmed;
}

function getDriveFolderId() {
    const folderId = normalizeFolderId(process.env.GOOGLE_DRIVE_FOLDER_ID);
    if (!folderId) {
        throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured.");
    }
    return folderId;
}

function hasOAuthCredentials() {
    return Boolean(
        process.env.GOOGLE_CLIENT_ID &&
            process.env.GOOGLE_CLIENT_SECRET &&
            process.env.GOOGLE_DRIVE_REFRESH_TOKEN
    );
}

async function getOAuthDriveClient() {
    const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_OAUTH_REDIRECT_URI || "http://localhost:3000/api/auth/google/callback"
    );

    oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
    });

    return google.drive({ version: "v3", auth: oauth2Client });
}

async function getServiceAccountDriveClient() {
    const credentials = loadServiceAccountCredentials();
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    return google.drive({ version: "v3", auth });
}

async function getDriveClient() {
    if (hasOAuthCredentials()) {
        return getOAuthDriveClient();
    }

    return getServiceAccountDriveClient();
}

function escapeDriveQueryValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function getOrCreateFolder(drive, folderName, parentId) {
    const escapedName = escapeDriveQueryValue(folderName);
    const listResponse = await drive.files.list({
        q: [
            "mimeType='application/vnd.google-apps.folder'",
            `name='${escapedName}'`,
            `'${parentId}' in parents`,
            "trashed=false",
        ].join(" and "),
        fields: "files(id)",
        spaces: "drive",
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
    });

    const existing = listResponse.data.files?.[0];
    if (existing?.id) {
        return existing.id;
    }

    const created = await drive.files.create({
        requestBody: {
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: [parentId],
        },
        fields: "id",
        supportsAllDrives: true,
    });

    return created.data.id;
}

async function resolveUploadFolderId(drive, assignmentId) {
    const rootFolderId = getDriveFolderId();
    if (!assignmentId) {
        return rootFolderId;
    }

    return getOrCreateFolder(drive, assignmentId, rootFolderId);
}

function buildSubmissionFilename(participantID, assignmentId) {
    const safeParticipant = String(participantID).replace(/[^\w\-]+/g, "-");
    const safeAssignment = String(assignmentId).replace(/[^\w\-]+/g, "-");
    return `${safeAssignment}__${safeParticipant}.pdf`;
}

async function uploadSubmissionPdf({
    buffer,
    participantID,
    assignmentId,
    existingFileId = null,
}) {
    const drive = await getDriveClient();
    const folderId = await resolveUploadFolderId(drive, assignmentId);
    const filename = buildSubmissionFilename(participantID, assignmentId);
    const media = {
        mimeType: "application/pdf",
        body: Readable.from(buffer),
    };

    if (existingFileId) {
        const updated = await drive.files.update({
            fileId: existingFileId,
            media,
            fields: "id, name, webViewLink",
            supportsAllDrives: true,
        });

        return {
            fileId: updated.data.id,
            fileName: updated.data.name || filename,
            webViewLink: updated.data.webViewLink || null,
            folderId,
        };
    }

    const created = await drive.files.create({
        requestBody: {
            name: filename,
            parents: [folderId],
        },
        media,
        fields: "id, name, webViewLink",
        supportsAllDrives: true,
    });

    return {
        fileId: created.data.id,
        fileName: created.data.name || filename,
        webViewLink: created.data.webViewLink || null,
        folderId,
    };
}

function isGoogleDriveConfigured() {
    try {
        getDriveFolderId();

        if (hasOAuthCredentials()) {
            return true;
        }

        if (process.env.GOOGLE_DRIVE_USE_SERVICE_ACCOUNT === "true") {
            loadServiceAccountCredentials();
            return true;
        }

        return false;
    } catch (error) {
        return false;
    }
}

function isServiceAccountStorageQuotaError(error) {
    const message = String(error?.message || error?.response?.data?.error?.message || "");
    return message.includes("Service Accounts do not have storage quota");
}

function formatDriveSubmissionError(error) {
    if (isServiceAccountStorageQuotaError(error)) {
        return (
            "Google service accounts cannot upload to a personal Drive folder. " +
            "Open http://localhost:3000/api/auth/google/setup to authorize your Google account, " +
            "or set SUBMISSION_STORAGE=local to save PDFs on the server instead."
        );
    }

    return error?.message || "Could not upload to Google Drive";
}

module.exports = {
    uploadSubmissionPdf,
    buildSubmissionFilename,
    isGoogleDriveConfigured,
    formatDriveSubmissionError,
    hasOAuthCredentials,
};
