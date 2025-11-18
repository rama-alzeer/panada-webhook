import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';

// Save JSON from environment variable to a temporary file
const jsonPath = './temp-service-account.json';
fs.writeFileSync(jsonPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);

const auth = new GoogleAuth({
  keyFile: jsonPath,
  scopes: 'https://www.googleapis.com/auth/cloud-platform',
});

async function getAccessToken() {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  console.log('Access Token:', token.token); // this is your token
}

getAccessToken();

