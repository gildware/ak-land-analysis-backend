import axios from "axios";

const TOKEN_URL = "https://services.sentinel-hub.com/oauth/token";

export async function getSentinelAccessToken() {
  const res = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SENTINEL_CLIENT_ID,
      client_secret: process.env.SENTINEL_CLIENT_SECRET,
    }),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  return res.data.access_token;
}
