
const crypto = require("crypto");
const { readJSON, writeJSON } = require("../github-storage");
const { verifyToken } = require("../liora-auth");

function getUser(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const session = verifyToken(token);
  return session?.email || null;
}

function getFile(email) {
  const id = crypto.createHash("sha256").update(email).digest("hex");
  return `data/earnings/${id}.json`;
}

function emptyLedger(email) {
  return {
    email,
    balances: {
      commission: 0,
      leisure: 0,
      video: 0,
      total: 0
    },
    transactions: [],
    updatedAt: new Date().toISOString()
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  try {
    const email = getUser(req);

    if (!email) {
      return res.status(401).json({
        ok: false,
        message: "Authentication required."
      });
    }

    const file = getFile(email);

    if (req.method === "GET") {
      const result = await readJSON(file, emptyLedger(email));

      return res.status(200).json({
        ok: true,
        ledger: result.data
      });
    }

    const incoming = req.body?.transactions;

    if (!Array.isArray(incoming) || incoming.length > 100) {
      return res.status(400).json({
        ok: false,
        message: "Invalid transactions."
      });
    }

    // Retry GitHub SHA conflicts.
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await readJSON(file, emptyLedger(email));
      const ledger = result.data;

      ledger.balances ||= {
        commission: 0,
        leisure: 0,
        video: 0,
        total: 0
      };

      ledger.transactions ||= [];

      const knownIds = new Set(
        ledger.transactions.map(item => item.id)
      );

      let added = 0;

      for (const tx of incoming) {
        const id = String(tx?.id || "").trim();
        const type = String(tx?.type || "");
        const amount = Number(tx?.amount);

        if (
          !id ||
          id.length > 150 ||
          !["commission", "leisure", "video"].includes(type) ||
          !Number.isFinite(amount) ||
          amount <= 0 ||
          amount > 10000000
        ) {
          return res.status(400).json({
            ok: false,
            message: "A transaction contains invalid data."
          });
        }

        if (knownIds.has(id)) continue;

        ledger.balances[type] =
          Number(ledger.balances[type] || 0) + amount;

        ledger.balances.total += amount;

        ledger.transactions.push({
          id,
          type,
          amount,
          source: String(tx.source || "unknown").slice(0, 80),
          referenceId: String(tx.referenceId || "").slice(0, 150),
          createdAt: new Date().toISOString()
        });

        knownIds.add(id);
        added++;
      }

      ledger.updatedAt = new Date().toISOString();

      // Keep the file manageable.
      if (ledger.transactions.length > 10000) {
        ledger.transactions = ledger.transactions.slice(-10000);
      }

      try {
        await writeJSON(file, ledger, result.sha);

        return res.status(200).json({
          ok: true,
          added,
          ledger
        });
      } catch (error) {
        if (error.status === 409 && attempt < 3) continue;
        throw error;
      }
    }

    throw new Error("Unable to save earnings. Please retry.");

  } catch (error) {
    console.error("Liora earnings API error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to process earnings."
    });
  }
};
