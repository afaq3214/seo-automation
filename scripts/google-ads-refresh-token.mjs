// Generates a Google Ads API refresh token (one-time setup).
//
// Usage:
//   node scripts/google-ads-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>
//
// The OAuth client must be a "Desktop app" client in Google Cloud Console.
// Sign in with a Google account that has access to your Google Ads account,
// then copy the printed refresh token into GOOGLE_ADS_REFRESH_TOKEN.

import http from "node:http";

const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) {
  console.error("Usage: node scripts/google-ads-refresh-token.mjs <CLIENT_ID> <CLIENT_SECRET>");
  process.exit(1);
}

const PORT = 8765;
const redirectUri = `http://127.0.0.1:${PORT}`;
const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/adwords",
    access_type: "offline",
    prompt: "consent",
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", redirectUri);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  if (!code && !error) {
    res.writeHead(404).end();
    return;
  }

  if (error) {
    res.end(`Authorization failed: ${error}. You can close this tab.`);
    console.error(`Authorization failed: ${error}`);
    server.close();
    return;
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const json = await tokenRes.json();

  if (json.refresh_token) {
    res.end("Done! Return to the terminal to copy your refresh token. You can close this tab.");
    console.log("\nGOOGLE_ADS_REFRESH_TOKEN=" + json.refresh_token + "\n");
  } else {
    res.end("Could not get a refresh token. Check the terminal.");
    console.error("Token exchange failed:", json);
  }
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Open this URL in your browser and sign in:\n\n" + authUrl + "\n");
});
