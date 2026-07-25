const express = require("express");
const { google } = require("googleapis");

const router = express.Router();

const REDIRECT_URI =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    "http://localhost:3000/api/auth/google/callback";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

function getOAuth2Client() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        return null;
    }

    return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

function renderPage({ title, body }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 720px; margin: 48px auto; padding: 0 24px; line-height: 1.5; color: #222; }
    h1 { font-size: 1.5rem; }
    code, pre { background: #f4f1ea; padding: 2px 6px; border-radius: 4px; }
    pre { padding: 16px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
    a.button { display: inline-block; margin-top: 16px; padding: 10px 16px; background: #1a4d8f; color: #fff; text-decoration: none; border-radius: 6px; }
    ol { padding-left: 1.25rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  ${body}
</body>
</html>`;
}

router.get("/setup", (req, res) => {
    const client = getOAuth2Client();

    if (!client) {
        return res.status(503).send(
            renderPage({
                title: "Google Drive setup",
                body: `<p>Add these to your <code>.env</code> file first, then restart the server:</p>
<pre>GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/google/callback</pre>
<p>Create an OAuth client in <a href="https://console.cloud.google.com/apis/credentials">Google Cloud Console</a> (Web application) and add the redirect URI above.</p>`,
            })
        );
    }

    const authUrl = client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: SCOPES,
    });

    res.send(
        renderPage({
            title: "Connect Google Drive",
            body: `<p>Click below to sign in with the Google account that owns your submissions folder.</p>
<p>Redirect URI for Google Cloud Console:</p>
<pre>${REDIRECT_URI}</pre>
<a class="button" href="${authUrl}">Authorize Google Drive</a>`,
        })
    );
});

router.get("/callback", async (req, res) => {
    const client = getOAuth2Client();
    const code = req.query.code;
    const error = req.query.error;

    if (error) {
        return res.status(400).send(
            renderPage({
                title: "Authorization failed",
                body: `<p>Google returned: <code>${error}</code></p>
<p><a href="/api/auth/google/setup">Try again</a></p>`,
            })
        );
    }

    if (!client) {
        return res.redirect("/api/auth/google/setup");
    }

    if (!code) {
        return res.status(400).send(
            renderPage({
                title: "Missing authorization code",
                body: `<p><a href="/api/auth/google/setup">Start over</a></p>`,
            })
        );
    }

    try {
        const { tokens } = await client.getToken(code);

        if (!tokens.refresh_token) {
            return res.status(400).send(
                renderPage({
                    title: "No refresh token",
                    body: `<p>Google did not return a refresh token. Revoke access for this app at
<a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>, then
<a href="/api/auth/google/setup">authorize again</a>.</p>`,
                })
            );
        }

        res.send(
            renderPage({
                title: "Google Drive connected",
                body: `<p>Add this line to your <code>.env</code> file, then restart the server:</p>
<pre>GOOGLE_DRIVE_REFRESH_TOKEN="${tokens.refresh_token}"
SUBMISSION_STORAGE=drive</pre>
<p>Use the quotes — the token contains <code>//</code> and will break without them.</p>
<p>Keep <code>GOOGLE_DRIVE_FOLDER_ID</code> set to your submissions folder.</p>
<p>After restarting, try <strong>Submit</strong> in the app again.</p>`,
            })
        );
    } catch (tokenError) {
        res.status(500).send(
            renderPage({
                title: "Could not complete authorization",
                body: `<p>${tokenError.message}</p>
<p><a href="/api/auth/google/setup">Try again</a></p>`,
            })
        );
    }
});

module.exports = router;
