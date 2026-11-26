
const crypto = require("crypto");
const { readJSON, writeJSON } = require("../github-storage");
const { createToken } = require("../liora-auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    const {
      action, fullName, email, country, phone, password
    } = req.body || {};

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const pass = String(password || "");

    if (!normalizedEmail || !pass || !["signup", "login"].includes(action)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid authentication details."
      });
    }

    const result = await readJSON("data/accounts.json", {});
    const accounts = result.data || {};

    let account = accounts[normalizedEmail];

    if (action === "signup") {
      if (account) {
        return res.status(409).json({
          ok: false,
          message: "An account with this email already exists."
        });
      }

      const salt = crypto.randomBytes(16).toString("hex");
      const passwordHash = crypto.scryptSync(pass, salt, 64).toString("hex");

      account = {
        fullName: String(fullName || "").trim(),
        email: normalizedEmail,
        country: String(country || ""),
        phone: String(phone || ""),
        passwordSalt: salt,
        passwordHash,
        profileImage: "",
        createdAt: new Date().toISOString()
      };

      if (!account.fullName || !account.country || !account.phone) {
        return res.status(400).json({
          ok: false,
          message: "Complete all registration details."
        });
      }

      accounts[normalizedEmail] = account;
    } else {
      if (!account) {
        return res.status(401).json({
          ok: false,
          message: "Account not found."
        });
      }

      const hash = crypto.scryptSync(
        pass,
        account.passwordSalt,
        64
      );

      const saved = Buffer.from(account.passwordHash, "hex");

      if (
        hash.length !== saved.length ||
        !crypto.timingSafeEqual(hash, saved)
      ) {
        return res.status(401).json({
          ok: false,
          message: "Incorrect email or password."
        });
      }
    }

    if (action === "signup") {
      await writeJSON("data/accounts.json", accounts, result.sha);
    }

    const token = createToken(normalizedEmail);

    return res.status(200).json({
      ok: true,
      token,
      account: {
        fullName: account.fullName,
        email: account.email,
        country: account.country,
        phone: account.phone,
        profileImage: account.profileImage,
        createdAt: account.createdAt
      }
    });

  } catch (error) {
    console.error("Liora authentication API error:", error);

    return res.status(500).json({
      ok: false,
      message: "Authentication failed. Please try again."
    });
  }
};
