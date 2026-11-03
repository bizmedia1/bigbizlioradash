const { readJSON, writeJSON } = require("../../lib/github-storage");

function isAuthorized(req) {
  const token = process.env.ADMIN_SECRET;

  return Boolean(
    token &&
    req.headers.authorization === `Bearer ${token}`
  );
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "PUT"].includes(req.method)) {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
  }

  if (!isAuthorized(req)) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized"
    });
  }

  try {
    const filePath = "data/settings.json";

    if (req.method === "GET") {
      const result = await readJSON(filePath);

      return res.status(200).json({
        ok: true,
        settings: result.data
      });
    }

    const current = await readJSON(filePath);

    const input = req.body || {};
    const old = current.data;

    const amount = Number(input.paymentAmount ?? old.paymentAmount);

    if (!Number.isFinite(amount) || amount < 100) {
      return res.status(400).json({
        ok: false,
        message: "Payment amount must be at least ₦100"
      });
    }

    const methods = {
      paga: input.paymentMethods?.paga ?? old.paymentMethods.paga,
      manualBank:
        input.paymentMethods?.manualBank ??
        old.paymentMethods.manualBank
    };

    if (
      typeof methods.paga !== "boolean" ||
      typeof methods.manualBank !== "boolean"
    ) {
      return res.status(400).json({
        ok: false,
        message: "Invalid payment method settings"
      });
    }

    if (!methods.paga && !methods.manualBank) {
      return res.status(400).json({
        ok: false,
        message: "At least one payment method must remain enabled"
      });
    }

    const bank = {
      accountNumber:
        input.manualBank?.accountNumber ??
        old.manualBank.accountNumber,
      bankName:
        input.manualBank?.bankName ??
        old.manualBank.bankName,
      accountName:
        input.manualBank?.accountName ??
        old.manualBank.accountName
    };

    if (
      typeof bank.accountNumber !== "string" ||
      typeof bank.bankName !== "string" ||
      typeof bank.accountName !== "string"
    ) {
      return res.status(400).json({
        ok: false,
        message: "Invalid bank details"
      });
    }

    const updated = {
      ...old,
      paymentAmount: amount,
      paymentMethods: methods,
      manualBank: bank,
      adminName:
        typeof input.adminName === "string"
          ? input.adminName.trim().slice(0, 60)
          : old.adminName
    };

    await writeJSON(filePath, updated, current.sha);

    return res.status(200).json({
      ok: true,
      message: "Settings updated",
      settings: updated
    });
  } catch (error) {
    console.error("Settings API error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to process settings"
    });
  }
};
