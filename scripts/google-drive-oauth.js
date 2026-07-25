require("dotenv").config();
const readline = require("readline");
const { google } = require("googleapis");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI =
    process.env.GOOGLE_OAUTH_REDIRECT_URI ||
    "http://localhost:3000/api/auth/google/callback";

const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(
        "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.\n" +
            "Create an OAuth client in Google Cloud Console (Desktop app or Web app with redirect URI above)."
    );
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
});

console.log("Authorize this app by visiting:\n");
console.log(authUrl);
console.log(
    "\nAfter approving, paste the authorization code from the redirect URL here."
);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

rl.question("\nAuthorization code: ", async (code) => {
    rl.close();

    try {
        const { tokens } = await oauth2Client.getToken(code.trim());
        console.log("\nAdd this to your .env file:\n");
        console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
        console.log(
            "\nKeep GOOGLE_DRIVE_FOLDER_ID set to the folder where submissions should go."
        );
        console.log("Restart the server after updating .env.");
    } catch (error) {
        console.error("Could not exchange authorization code:", error.message);
        process.exit(1);
    }
});
