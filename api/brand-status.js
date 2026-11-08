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
    res.setHeader("Allow", "GET, OPTIONS");

    return res.status(405).json({
      ok: false,
      message: "Method not allowed."
    });
  }

  try {
    const result = await readJSON(FILE, {
      version: 1,
      posts: []
    });

    const data = result.data || {};
    const posts = Array.isArray(data.posts) ? data.posts : [];

    const activePosts = posts
      .filter(post =>
        post &&
        post.active !== false &&
        post.brandId &&
        ["image", "video"].includes(post.mediaType) &&
        typeof post.mediaUrl === "string" &&
        post.mediaUrl.trim()
      )
      .map(post => ({
        id: post.id,
        brandId: post.brandId,
        mediaType: post.mediaType,
        mediaUrl: post.mediaUrl,
        caption: post.caption || "",
        createdAt: post.createdAt || ""
      }));

    return res.status(200).json({
      ok: true,
      posts: activePosts
    });

  } catch (error) {
    console.error("Public brand status API:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to load brand statuses."
    });
  }
};
