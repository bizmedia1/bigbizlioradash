
const crypto = require("crypto");
const { readJSON, writeJSON } = require("../github-storage");
const { verifyToken } = require("../liora-auth");

function authenticate(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;

  return verifyToken(header.slice(7))?.email || null;
}

function accountFile(email) {
  const id = crypto.createHash("sha256").update(email).digest("hex");
  return `data/earnings/${id}.json`;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    const email = authenticate(req);

    if (!email) {
      return res.status(401).json({ ok: false, message: "Authentication required." });
    }

    const { type, amount, referenceId, source } = req.body || {};

    if (
      !["commission", "leisure", "video"].includes(type) ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0 ||
      Number(amount) > 10000000 ||
      !referenceId ||
      String(referenceId).length > 150
    ) {
      return res.status(400).json({ ok: false, message: "Invalid credit details." });
    }

    // Credits must reference a server-created earning record.
    const verifiedFile = `data/verified-earnings/${crypto
      .createHash("sha256")
      .update(email + ":" + String(referenceId))
      .digest("hex")}.json`;

    const verified = await readJSON(verifiedFile, null);

    if (
      !verified.data ||
      verified.data.email !== email ||
      verified.data.type !== type ||
      Number(verified.data.amount) !== Number(amount) ||
      verified.data.status !== "approved"
    ) {
      return res.status(403).json({
        ok: false,
        message: "This earning has not been verified."
      });
    }

    const file = accountFile(email);

    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await readJSON(file, {
        email,
        balances: { commission: 0, leisure: 0, video: 0, total: 0 },
        transactions: [],
        updatedAt: new Date().toISOString()
      });

      const ledger = result.data;
      ledger.balances ||= { commission: 0, leisure: 0, video: 0, total: 0 };
      ledger.transactions ||= [];

      const id = String(referenceId);

      if (ledger.transactions.some(tx => tx.id === id)) {
        return res.status(200).json({
          ok: true,
          duplicate: true,
          ledger
        });
      }

      ledger.balances[type] =
        Number(ledger.balances[type] || 0) + Number(amount);

      ledger.balances.total += Number(amount);

      ledger.transactions.push({
        id,
        type,
        amount: Number(amount),
        source: String(source || verified.data.source || "verified").slice(0, 80),
        referenceId: id,
        createdAt: new Date().toISOString()
      });

      ledger.updatedAt = new Date().toISOString();

      try {
        await writeJSON(file, ledger, result.sha);

        return res.status(200).json({
          ok: true,
          duplicate: false,
          ledger
        });
      } catch (error) {
        if (error.status === 409 && attempt < 3) continue;
        throw error;
      }
    }

    throw new Error("Unable to save verified earning.");

  } catch (error) {
    console.error("Liora earnings credit error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to credit this earning."
    });
  }
};
