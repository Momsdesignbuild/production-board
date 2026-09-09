// Session token check, same scheme unlock.js issues (HMAC body.sig). Shared so
// endpoints don't each carry a copy.
import crypto from "node:crypto";
export function verifySession(authHeader, secret) {
  const token = String(authHeader || "").startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token || !secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  if (sig !== crypto.createHmac("sha256", secret).update(body).digest("base64url")) return null;
  try { const p = JSON.parse(Buffer.from(body, "base64url").toString()); return p.exp && Date.now() < p.exp ? p : null; } catch { return null; }
}
