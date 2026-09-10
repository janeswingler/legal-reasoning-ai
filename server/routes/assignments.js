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
const { resolveAssignmentState } = require("../services/assignmentState.js");
const { getDueDateForMemo } = require("../services/memoDueDates.js");
const {
    attachStudyIdentity,
    IDENTITY_ERROR_MESSAGE,
} = require("../middleware/studyIdentity.js");

const router = express.Router();

const IDENTITY_REQUIRED_MESSAGE = "participantID and assignmentId required";

const WRITING_LOCKED_MESSAGE =
    "This memo has been submitted and can no longer be edited.";
const SAVE_CONFLICT_MESSAGE =
    "This memo was updated in another tab or device. Reload the page to see the latest version.";

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

router.get("/due-date", (req, res) => {
    if (!req.study) {
        return res.status(400).json({ error: IDENTITY_REQUIRED_MESSAGE });
    }

    res.json({ dueDate: getDueDateForMemo(req.study.memoNumber) });
});

router.get("/current", async (req, res) => {
    try {
        if (!req.study) {
            return res.status(400).json({ error: IDENTITY_REQUIRED_MESSAGE });
        }

        const assignment = await assignmentsDb.findByParticipantAndAssignment(
            req.study.participantID,
            req.study.memoId
        );

        if (!assignment) {
            return res.status(404).json({ error: "Assignment not found" });
        }

        res.json({ ...assignment, state: resolveAssignmentState(assignment) });
    } catch (error) {
        console.error("Assignment load error:", error);
        res.status(500).json({ error: "Could not load the assignment" });
    }
});

router.put("/current", async (req, res) => {
    try {
        if (!req.study) {
            return res.status(400).json({ error: IDENTITY_REQUIRED_MESSAGE });
        }

        const { participantID, memoId: assignmentId, systemID } = req.study;
        const { studySessionId, content, title, expectedVersion } = req.body;

        // The editor also goes read-only on submit, but autosave is the one
        // caller that could still be in flight, so the lock is enforced here.
        const existing = await assignmentsDb.findByParticipantAndAssignment(
            participantID,
            assignmentId
        );

        if (existing?.submittedAt) {
            return res.status(409).json({
                error: WRITING_LOCKED_MESSAGE,
                state: resolveAssignmentState(existing),
            });
        }

        const { assignment, created, conflict } = await assignmentsDb.upsertCurrent({
            participantID,
            assignmentId,
            studySessionId,
            systemID,
            content,
            title,
            expectedVersion,
        });

        if (conflict) {
            // Someone else's write landed between our read and ours. Report
            // whatever is on the row now rather than clobbering it — and if
            // that write was the submit itself, say so instead of "reload".
            const latest = await assignmentsDb.findByParticipantAndAssignment(
                participantID,
                assignmentId
            );
            if (latest?.submittedAt) {
                return res.status(409).json({
                    error: WRITING_LOCKED_MESSAGE,
                    state: resolveAssignmentState(latest),
                });
            }
            return res.status(409).json({
                error: SAVE_CONFLICT_MESSAGE,
                conflict: true,
                state: resolveAssignmentState(latest),
                assignment: latest,
            });
        }

        res.status(created ? 201 : 200).json(assignment);
    } catch (error) {
        console.error("Assignment save error:", error);
        res.status(500).json({ error: "Could not save the assignment" });
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

            // Multipart fields only exist now that multer has run, so the
            // study identity is resolved here rather than by the middleware.
            let study;
            try {
                study = attachStudyIdentity(req);
            } catch (error) {
                return res.status(403).json({ error: IDENTITY_ERROR_MESSAGE });
            }
            const { participantID, memoId: assignmentId, systemID } = study;
            const { studySessionId, title } = req.body;

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

            // Submission is one-way: a second submit would replace the stored
            // PDF after the participant was told their writing was final.
            if (assignment?.submittedAt) {
                return res.status(409).json({
                    error: WRITING_LOCKED_MESSAGE,
                    state: resolveAssignmentState(assignment),
                });
            }

            if (!assignment) {
                assignment = await assignmentsDb.create({
                    participantID,
                    assignmentId,
                    studySessionId,
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
                            studySessionId: studySessionId || assignment.studySessionId,
                            systemID,
                            title: title || assignment.title,
                            submittedAt: new Date(),
                            localFilePath: localResult.filePath,
                        });

                        return res.json({
                            ok: true,
                            submittedAt: assignment.submittedAt,
                            state: resolveAssignmentState(assignment),
                            storage: "local",
                            localFilePath: assignment.localFilePath,
                            warning: formatDriveSubmissionError(driveError),
                        });
                    }

                    throw driveError;
                }
            }

            const updateFields = {
                studySessionId: studySessionId || assignment.studySessionId,
                systemID,
                title: title || assignment.title,
                submittedAt: new Date(),
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
                state: resolveAssignmentState(assignment),
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

module.exports = router;
