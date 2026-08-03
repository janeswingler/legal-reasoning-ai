const express = require("express");
const multer = require("multer");
const assignmentsDb = require("../db/assignments.js");
const {
    uploadSubmissionPdf,
    isGoogleDriveConfigured,
    formatDriveSubmissionError,
} = require("../services/googleDrive.js");
const {
    getSubmissionStorageMode,
    isLocalSubmissionEnabled,
    isDriveSubmissionEnabled,
    saveSubmissionLocally,
} = require("../services/submissionStorage.js");
const { renderPleadingPdf } = require("../services/pdfGenerator.js");

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter(_req, file, cb) {
        const isPdf =
            file.mimetype === "application/pdf" ||
            file.originalname.toLowerCase().endsWith(".pdf");

        if (isPdf) {
            cb(null, true);
            return;
        }

        cb(new Error("Only PDF files are allowed"));
    },
});

function isSubmissionConfigured() {
    if (isLocalSubmissionEnabled()) {
        return true;
    }

    return isGoogleDriveConfigured();
}

function getSubmissionNotConfiguredMessage() {
    const mode = getSubmissionStorageMode();
    if (mode === "local") {
        return "Submission storage is not available.";
    }

    return (
        "Submission is not configured on the server. For Google Drive, set GOOGLE_DRIVE_FOLDER_ID, " +
        "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN. " +
        "Open /api/auth/google/setup after adding the client ID and secret. " +
        "Or set SUBMISSION_STORAGE=local in .env to save PDFs on the server."
    );
}

router.get("/", async (req, res) => {
    try {
        const { participantID } = req.query;
        if (!participantID) {
            return res.status(400).json({ error: "participantID required" });
        }
        const assignments = await assignmentsDb.findByParticipant(participantID);
        res.json(assignments);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/current", async (req, res) => {
    try {
        const { participantID, assignmentId } = req.query;

        if (!participantID || !assignmentId) {
            return res.status(400).json({
                error: "participantID and assignmentId required",
            });
        }

        const assignment = await assignmentsDb.findByParticipantAndAssignment(
            participantID,
            assignmentId
        );

        if (!assignment) {
            return res.status(404).json({ error: "Assignment not found" });
        }

        res.json(assignment);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const assignment = await assignmentsDb.findById(req.params.id);
        if (!assignment) {
            return res.status(404).json({ error: "Assignment not found" });
        }
        res.json(assignment);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post("/", async (req, res) => {
    try {
        const assignment = await assignmentsDb.create(req.body);
        res.status(201).json(assignment);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.put("/current", async (req, res) => {
    try {
        const {
            participantID,
            assignmentId,
            sessionID,
            systemID,
            content,
            title,
        } = req.body;

        if (!participantID || !assignmentId) {
            return res.status(400).json({
                error: "participantID and assignmentId required",
            });
        }

        const { assignment, created } = await assignmentsDb.upsertCurrent({
            participantID,
            assignmentId,
            sessionID,
            systemID,
            content,
            title,
        });

        res.status(created ? 201 : 200).json(assignment);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post("/pdf", async (req, res) => {
    try {
        const { html } = req.body;

        if (!html || typeof html !== "string" || !html.trim()) {
            return res.status(400).json({ error: "html required" });
        }

        const pdf = await renderPleadingPdf(html);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", pdf.length);
        res.send(Buffer.from(pdf));
    } catch (error) {
        console.error("PDF render error:", error);
        res.status(500).json({ error: "Could not create PDF" });
    }
});

router.post("/submit", (req, res) => {
    upload.single("pdf")(req, res, async (uploadError) => {
        if (uploadError) {
            const message =
                uploadError.message === "Only PDF files are allowed"
                    ? uploadError.message
                    : uploadError.message || "Could not upload PDF";
            return res.status(400).json({ error: message });
        }

        try {
            if (!isSubmissionConfigured()) {
                return res.status(503).json({
                    error: getSubmissionNotConfiguredMessage(),
                });
            }

            const { participantID, assignmentId, sessionID, systemID, title } =
                req.body;

            if (!participantID || !assignmentId) {
                return res.status(400).json({
                    error: "participantID and assignmentId required",
                });
            }

            if (!req.file?.buffer?.length) {
                return res.status(400).json({ error: "PDF file required" });
            }

            if (isDriveSubmissionEnabled() && !isGoogleDriveConfigured()) {
                return res.status(503).json({
                    error: getSubmissionNotConfiguredMessage(),
                });
            }

            let assignment = await assignmentsDb.findByParticipantAndAssignment(
                participantID,
                assignmentId
            );

            if (!assignment) {
                assignment = await assignmentsDb.create({
                    participantID,
                    assignmentId,
                    sessionID,
                    systemID,
                    title: title || `${assignmentId} assignment`,
                    content: "<p><br></p>",
                });
            }

            let localResult = null;
            let driveResult = null;

            if (isLocalSubmissionEnabled()) {
                localResult = await saveSubmissionLocally({
                    buffer: req.file.buffer,
                    participantID,
                    assignmentId,
                });
            }

            if (isDriveSubmissionEnabled()) {
                try {
                    driveResult = await uploadSubmissionPdf({
                        buffer: req.file.buffer,
                        participantID,
                        assignmentId,
                        existingFileId: assignment.driveFileId || null,
                    });
                } catch (driveError) {
                    if (localResult) {
                        assignment = await assignmentsDb.updateById(assignment.id, {
                            sessionID: sessionID || assignment.sessionID,
                            systemID: systemID || assignment.systemID,
                            title: title || assignment.title,
                            submittedAt: new Date(),
                            localFilePath: localResult.filePath,
                            version: assignment.version,
                        });

                        return res.json({
                            ok: true,
                            submittedAt: assignment.submittedAt,
                            storage: "local",
                            localFilePath: assignment.localFilePath,
                            warning: formatDriveSubmissionError(driveError),
                        });
                    }

                    throw driveError;
                }
            }

            const updateFields = {
                sessionID: sessionID || assignment.sessionID,
                systemID: systemID || assignment.systemID,
                title: title || assignment.title,
                submittedAt: new Date(),
                version: assignment.version,
            };

            if (localResult) {
                updateFields.localFilePath = localResult.filePath;
            }

            if (driveResult) {
                updateFields.driveFileId = driveResult.fileId;
                updateFields.driveFileName = driveResult.fileName;
            }

            assignment = await assignmentsDb.updateById(assignment.id, updateFields);

            res.json({
                ok: true,
                submittedAt: assignment.submittedAt,
                storage: driveResult ? "drive" : "local",
                driveFileId: assignment.driveFileId,
                driveFileName: assignment.driveFileName,
                localFilePath: assignment.localFilePath,
                webViewLink: driveResult?.webViewLink || null,
            });
        } catch (error) {
            console.error("Submission error:", error);
            res.status(500).json({
                error: formatDriveSubmissionError(error),
            });
        }
    });
});

router.put("/:id", async (req, res) => {
    try {
        const existing = await assignmentsDb.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ error: "Assignment not found" });
        }

        const { title, content } = req.body;
        const fields = {};
        if (title !== undefined) fields.title = title;
        if (content !== undefined) fields.content = content;

        const assignment = await assignmentsDb.updateById(req.params.id, fields);
        res.json(assignment);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
