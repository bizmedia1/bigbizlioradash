const { readJSON } = require("../lib/github-storage");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
  }

  try {
    const result = await readJSON("data/settings.json");
    const settings = result.data;

    if (!settings) {
      throw new Error("Payment settings were not found.");
    }

    return res.status(200).json({
      ok: true,
      paymentAmount: settings.paymentAmount,
      paymentMethods: settings.paymentMethods,
      manualBank: settings.manualBank
    });

  } catch (error) {
    console.error("Public settings API error:", error);

    return res.status(500).json({
      ok: false,
      message: error.message || "Unable to load payment settings"
    });
  }
};
