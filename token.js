const { GoogleAuth } = require("google-auth-library");

async function generateAccessToken() {
  const auth = new GoogleAuth({
    keyFile: "./key.json", // rename your downloaded key to key.json
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();
  console.log("ACCESS TOKEN:\n", token);
}

generateAccessToken();
