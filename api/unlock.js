// Validates the board's edit PIN server-side (it used to be hardcoded right
// in the client JS bundle — anyone could read it via "View Source") and
// hands back a signed session token on success. The token, not the PIN, is
// what authorizes writes from here on (see api/save-board.js).

import crypto from "node:crypto";

const PIN = process.env.BOARD_PIN || "1993";
const SECRET = process.env.SESSION_SECRET;
const SESSION_LENGTH_MS = 90 * 24 * 60 * 60 * 1000; // 90 days — matches the old "stays unlocked on this device" behavior

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  if (!SECRET) {
    res.status(500).json({ error: "SESSION_SECRET isn't configured" });
    return;
  }

  const { pin, deviceId } = req.body || {};
  if (!pin || String(pin) !== PIN) {
    res.status(401).json({ error: "wrong pin" });
    return;
  }

  const now = Date.now();
  const token = sign({ deviceId: deviceId || "unknown", iat: now, exp: now + SESSION_LENGTH_MS });
  res.status(200).json({ token, exp: now + SESSION_LENGTH_MS });
}
