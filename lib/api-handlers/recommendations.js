const { readJSON } = require("../github-storage");

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
    const result = await readJSON("data/recommendations.json", {});

    const recommendations = {};

    for (const [creatorId, item] of Object.entries(result.data || {})) {
      if (
        !item ||
        !Array.isArray(item.products) ||
        item.products.length !== 2
      ) {
        continue;
      }

      const reward = Number(item.reward);

      if (!Number.isSafeInteger(reward) || reward < 1) {
        continue;
      }

      recommendations[creatorId] = {
        creatorId,
        creatorName: item.creatorName,
        reward,
        products: item.products.map(product => ({
          name: String(product.name || ""),
          image: String(product.image || "")
        }))
      };
    }

    return res.status(200).json({
      ok: true,
      recommendations
    });

  } catch (error) {
    console.error("Public recommendations API error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to load recommendations"
    });
  }
};
