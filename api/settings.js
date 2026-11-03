const { readJSON } = require("../lib/github-storage");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
  }

  try {
    const result = await readJSON("data/settings.json");
    const settings = result.data;

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
      message: "Unable to load payment settings"
    });
  }
};
