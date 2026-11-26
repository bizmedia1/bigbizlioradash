
const crypto = require("crypto");

function getSecret() {
  const secret = process.env.LIORA_AUTH_SECRET;
  if (!secret) throw new Error("LIORA_AUTH_SECRET is missing");
  return secret;
}

function createToken(email) {
  const payload = Buffer.from(JSON.stringify({
    email,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");

  return payload + "." + signature;
}

function verifyToken(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) return null;

    const expected = crypto
      .createHmac("sha256", getSecret())
      .update(parts[0])
      .digest();

    const actual = Buffer.from(parts[1], "base64url");

    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    ) return null;

    const payload = JSON.parse(
      Buffer.from(parts[0], "base64url").toString()
    );

    if (!payload.email || payload.exp < Date.now() / 1000) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

module.exports = { createToken, verifyToken };
