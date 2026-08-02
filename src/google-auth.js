import { google } from 'googleapis';

// Shared OAuth2 client for user-scoped Google APIs (Calendar, Gmail, Sheets).
// Uses the refresh token obtained via `npm run setup`.

// Every self-hosted instance shares this installed-app OAuth client by default, so
// nobody has to create their own Google Cloud project just to run the bot. This is
// Google's standard pattern for installed/desktop apps — unlike a service-account
// key, this client secret isn't meant to stay confidential (it ships in every copy
// of the app and can't act alone without a user's own consent + refresh token).
// GOOGLE_OAUTH_CLIENT_ID/SECRET env vars override this, which is also how anyone
// can opt to use their own Google Cloud project instead of the shared one below.
const DEFAULT_CLIENT_ID = '377839655008-iu5schuddn9h5eq9tts76dd7ladsfshk.apps.googleusercontent.com';
const DEFAULT_CLIENT_SECRET = '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';

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/spreadsheets',
];

export function getOAuthClientId() {
  return process.env.GOOGLE_OAUTH_CLIENT_ID || DEFAULT_CLIENT_ID;
}

export function getOAuthClientSecret() {
  return process.env.GOOGLE_OAUTH_CLIENT_SECRET || DEFAULT_CLIENT_SECRET;
}

let oAuth2Client = null;

export function getOAuthClient() {
  if (!oAuth2Client) {
    oAuth2Client = new google.auth.OAuth2(
      getOAuthClientId(),
      getOAuthClientSecret(),
      'http://127.0.0.1'
    );
    oAuth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
    });
  }
  return oAuth2Client;
}

// ─── Local-redirect OAuth flow (used by scripts/setup.js) ────────────────────
// Google is retiring the old copy/paste "oob" redirect for new OAuth clients, and
// it was clunky for non-technical users anyway. This spins up a throwaway local
// HTTP server, opens the consent screen in the browser, and captures the auth
// code from the redirect — no manual copy/paste required.

// Resolves with a refresh token once the user completes the consent screen.
export async function runLocalOAuthFlow({ openUrl } = {}) {
  const { createServer } = await import('http');
  const { exec } = await import('child_process');

  const { code, client } = await new Promise((resolve, reject) => {
    let client;
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/oauth/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(error
        ? `<h1>Authorization failed</h1><p>${error}</p><p>You can close this tab.</p>`
        : '<h1>✅ Authorized</h1><p>You can close this tab and go back to the terminal.</p>');

      server.close();
      if (error) reject(new Error(`Google OAuth error: ${error}`));
      else resolve({ code, client });
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
      client = new google.auth.OAuth2(getOAuthClientId(), getOAuthClientSecret(), redirectUri);
      const authUrl = client.generateAuthUrl({
        access_type: 'offline',
        scope: GOOGLE_OAUTH_SCOPES,
        prompt: 'consent',
      });

      if (openUrl !== false) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${opener} "${authUrl}"`, () => {});
      }
      console.log('\nOpen this URL in your browser if it did not open automatically:\n');
      console.log(authUrl, '\n');
    });
  });

  const { tokens } = await client.getToken(code);
  return tokens.refresh_token;
}
