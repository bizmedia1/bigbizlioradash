
const crypto = require("crypto");
const { readJSON } = require("../../lib/github-storage");

function send(res, status, data) {
  return res.status(status).json(data);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return send(res, 405, { ok: false });
  }

  try {
    const { paymentId, statusToken } = req.body || {};

    if (!paymentId || !statusToken) {
      return send(res, 400, { ok: false });
    }

    const stored = await readJSON("data/payments.json", {
      payments: []
    });

    const payments = stored.data?.payments || [];

    const payment = payments.find(
      item => String(item.id) === String(paymentId)
    );

    if (!payment || !payment.statusTokenHash) {
      return send(res, 404, { ok: false });
    }

    const submittedHash = crypto
      .createHash("sha256")
      .update(String(statusToken))
      .digest();

    const savedHash = Buffer.from(
      payment.statusTokenHash,
      "hex"
    );

    if (
      savedHash.length !== submittedHash.length ||
      !crypto.timingSafeEqual(savedHash, submittedHash)
    ) {
      return send(res, 403, { ok: false });
    }

    const status = String(payment.status || "pending").toLowerCase();

    const response = {
      ok: true,
      status
    };

    if (status === "approved" && payment.pofPass) {
      response.pofPass = payment.pofPass;
      response.pofGeneratedAt = payment.pofGeneratedAt || payment.processedAt || null;
    }

    return send(res, 200, response);

  } catch (error) {
    console.error("[Payment Status]", error);

    return send(res, 500, { ok: false });
  }
};
