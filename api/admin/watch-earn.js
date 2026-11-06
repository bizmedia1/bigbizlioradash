
const { readJSON, writeJSON } = require("../../lib/github-storage");

const FILE = "data/watch-earn.json";

function isAuthorized(req) {
  const token = process.env.ADMIN_SECRET;

  return Boolean(
    token &&
    req.headers.authorization === `Bearer ${token}`
  );
}

function validateContent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid Watch & Earn content.");
  }

  const { creators, categories, stories, labels } = input;

  if (!Array.isArray(creators) || creators.length > 10) {
    throw new Error("A maximum of 10 creator profiles is allowed.");
  }

  if (!Array.isArray(categories) || categories.length > 20) {
    throw new Error("Invalid categories.");
  }

  if (!Array.isArray(stories) || stories.length > 200) {
    throw new Error("A maximum of 200 stories is allowed.");
  }

  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    throw new Error("Invalid display labels.");
  }

  const cleanCreators = creators.map((creator, index) => {
    if (!creator || typeof creator !== "object") {
      throw new Error(`Invalid creator at position ${index + 1}.`);
    }

    return {
      id: String(creator.id || `creator-${index + 1}`).slice(0, 80),
      name: String(creator.name || "").trim().slice(0, 60),
      imageUrl: String(creator.imageUrl || "").trim().slice(0, 2000),
      verified: Boolean(creator.verified),
      active: creator.active !== false
    };
  });

  const cleanCategories = categories.map(category => {
    const name = String(category || "").trim().slice(0, 60);

    if (!name) {
      throw new Error("Category names cannot be empty.");
    }

    return name;
  });

  const cleanStories = stories.map((story, index) => {
    if (!story || typeof story !== "object") {
      throw new Error(`Invalid story at position ${index + 1}.`);
    }

    const reward = Number(story.reward);
    const duration = Number(story.duration);
    const views = Number(story.views || 0);

    if (!Number.isFinite(reward) || reward < 0 || reward > 10000000) {
      throw new Error(`Invalid reward for story ${index + 1}.`);
    }

    if (!Number.isInteger(duration) || duration < 1 || duration > 3600) {
      throw new Error(`Invalid duration for story ${index + 1}.`);
    }

    if (!Number.isFinite(views) || views < 0) {
      throw new Error(`Invalid views count for story ${index + 1}.`);
    }

    return {
      id: String(story.id || `story-${index + 1}`).slice(0, 100),
      category: String(story.category || "").trim().slice(0, 60),
      creatorId: String(story.creatorId || "").slice(0, 80),
      title: String(story.title || "").trim().slice(0, 150),
      caption: String(story.caption || "").slice(0, 1000),
      videoUrl: String(story.videoUrl || "").trim().slice(0, 2000),
      videoFormat: story.videoFormat === "portrait" ? "portrait" : "landscape",
      thumbnail: String(story.thumbnail || "").trim().slice(0, 2000),
      reward,
      duration,
      views: Math.floor(views),
      time: String(story.time || "").slice(0, 60),
      active: story.active !== false
    };
  });

  const cleanLabels = {};

  for (const [key, value] of Object.entries(labels)) {
    if (typeof value === "string") {
      cleanLabels[key.slice(0, 60)] = value.slice(0, 120);
    }
  }

  return {
    version: 1,
    enabled: input.enabled !== false,
    creators: cleanCreators,
    categories: cleanCategories,
    stories: cleanStories,
    labels: cleanLabels,
    updatedAt: new Date().toISOString()
  };
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
    const current = await readJSON(FILE, {
      version: 1,
      enabled: true,
      creators: [],
      categories: [],
      stories: [],
      labels: {}
    });

    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        content: current.data
      });
    }

    const updated = validateContent(req.body);

    await writeJSON(FILE, updated, current.sha);

    return res.status(200).json({
      ok: true,
      message: "Watch & Earn content saved successfully.",
      content: updated
    });

  } catch (error) {
    console.error("Watch & Earn admin API error:", error);

    const status = error.status === 409 ? 409 : 400;

    return res.status(status).json({
      ok: false,
      message: error.message || "Unable to process Watch & Earn content."
    });
  }
};
