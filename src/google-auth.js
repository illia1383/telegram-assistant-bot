import { google } from 'googleapis';

// Shared OAuth2 client for user-scoped Google APIs (Calendar, Gmail).
// Uses the refresh token obtained via scripts/get-calendar-token.js.

let oAuth2Client = null;

export function getOAuthClient() {
  if (!oAuth2Client) {
    oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      'urn:ietf:wg:oauth:2.0:oob'
    );
    oAuth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_CALENDAR_REFRESH_TOKEN,
    });
  }
  return oAuth2Client;
}
