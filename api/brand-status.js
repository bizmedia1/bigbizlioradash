
const { readJSON } = require("../lib/github-storage");

const FILE = "data/brand-status.json";

module.exports = async function handler(req, res) {
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
      message: "Method not allowed."
    });
  }

  try {
    const result = await readJSON(FILE, {
      version: 1,
      enabled: true,
      brands: []
    });

    const data = result.data || {};

    if (data.enabled === false) {
      return res.status(200).json({
        ok: true,
        enabled: false,
        brands: []
      });
    }

    const brands = Array.isArray(data.brands)
      ? data.brands
      : [];

    const activeBrands = brands
      .filter(brand => brand && brand.active === true)
      .map(brand => ({
        id: brand.id,
        name: brand.name,
        username: brand.username,
        profileImage: brand.profileImage || "",
        rewardMin: Number(brand.rewardMin || 0),
        rewardMax: Number(brand.rewardMax || 0),
        statuses: (Array.isArray(brand.statuses)
          ? brand.statuses
          : []
        )
          .filter(status => status && status.active === true)
          .map(status => ({
            id: status.id,
            mediaType: status.mediaType,
            mediaUrl: status.mediaUrl,
            caption: status.caption || ""
          }))
      }));

    return res.status(200).json({
      ok: true,
      enabled: true,
      brands: activeBrands
    });

  } catch (error) {
    console.error("Public brand status API:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to load brand statuses."
    });
  }
};
