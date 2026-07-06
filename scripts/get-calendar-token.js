// Run this once locally to get your Google Calendar refresh token.
// Usage: node scripts/get-calendar-token.js
// It will print a URL — open it in your browser, log in, approve access,
// then paste the code it gives you back into the terminal.
// Copy the printed refresh token into your .env as GOOGLE_CALENDAR_REFRESH_TOKEN.

import 'dotenv/config';
import { google } from 'googleapis';
import readline from 'readline';

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob';
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent',
});

console.log('\n1. Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n2. Log in with your Google account and approve access.');
console.log('3. Paste the code shown in the browser below.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Enter the code: ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oAuth2Client.getToken(code.trim());
    console.log('\n✅ Success! Add this to your .env and Railway env vars:\n');
    console.log(`GOOGLE_CALENDAR_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log(`GOOGLE_OAUTH_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GOOGLE_OAUTH_CLIENT_SECRET=${CLIENT_SECRET}`);
  } catch (err) {
    console.error('Error getting token:', err.message);
  }
});
