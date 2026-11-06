
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
    const result = await readJSON("data/watch-earn.json", {
      version: 1,
      enabled: true,
      creators: [],
      categories: [],
      stories: [],
      labels: {}
    });

    const content = result.data;

    return res.status(200).json({
      ok: true,
      enabled: content.enabled !== false,
      content: {
        version: content.version || 1,
        enabled: content.enabled !== false,
        creators: (content.creators || []).filter(item => item.active !== false),
        categories: content.categories || [],
        stories: (content.stories || []).filter(item => item.active !== false),
        labels: content.labels || {},
        updatedAt: content.updatedAt || null
      }
    });

  } catch (error) {
    console.error("Public Watch & Earn API error:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to load Watch & Earn content."
    });
  }
};
