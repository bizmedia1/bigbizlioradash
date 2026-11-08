
const { readJSON, writeJSON } = require("../../lib/github-storage");

const FILE = "data/brand-status.json";

const VALID_BRANDS = new Set([
  "chowdeck", "opay", "moniepoint", "okash", "sun-king",
  "bokku", "indomie", "dangote", "gtbank", "access-bank",
  "firstbank", "zenith-bank", "uba", "fidelity-bank", "fcmb",
  "sterling-bank", "union-bank", "kuda", "carbon", "palmpay",
  "fairmoney", "paga", "interswitch", "flutterwave", "paystack",
  "remita", "jiji", "jumia", "konga", "slot", "tecno", "itel",
  "infinix", "mtn", "airtel", "glo", "9mobile", "showmax",
  "dstv", "gotv", "bet9ja", "sportybet", "shoprite", "spar",
  "foodco", "mcdonalds", "dominos", "coldstone", "rite-foods",
  "peak"
]);

function validMediaUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function createId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) +
      Math.random().toString(36).slice(2, 12);
}

function getPosts(data) {
  return Array.isArray(data?.posts) ? data.posts : [];
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const secret = process.env.ADMIN_SECRET || "";
  const authorization = req.headers.authorization || "";

  if (!secret || authorization !== `Bearer ${secret}`) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized."
    });
  }

  try {
    const stored = await readJSON(FILE, {
      version: 1,
      posts: []
    });

    const data = stored.data || {};
    const posts = getPosts(data);
    const sha = stored.sha || null;

    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        posts: [...posts].sort(
          (a, b) =>
            new Date(b.createdAt || 0) -
            new Date(a.createdAt || 0)
        )
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};

      const brandId = String(body.brandId || "").trim();
      const mediaType = String(body.mediaType || "")
        .trim()
        .toLowerCase();
      const mediaUrl = String(body.mediaUrl || "").trim();
      const caption = String(body.caption || "").trim();

      if (!VALID_BRANDS.has(brandId)) {
        return res.status(400).json({
          ok: false,
          message: "Please select a valid brand."
        });
      }

      if (!["image", "video"].includes(mediaType)) {
        return res.status(400).json({
          ok: false,
          message: "Media type must be image or video."
        });
      }

      if (!validMediaUrl(mediaUrl)) {
        return res.status(400).json({
          ok: false,
          message: "Enter a valid HTTP or HTTPS media URL."
        });
      }

      if (caption.length > 500) {
        return res.status(400).json({
          ok: false,
          message: "Caption cannot exceed 500 characters."
        });
      }

      const post = {
        id: createId(),
        brandId,
        mediaType,
        mediaUrl,
        caption,
        active: true,
        createdAt: new Date().toISOString()
      };

      const updatedPosts = [post, ...posts];

      // IMPORTANT: Pass the existing GitHub SHA.
      await writeJSON(
        FILE,
        {
          version: 1,
          posts: updatedPosts
        },
        sha
      );

      return res.status(201).json({
        ok: true,
        message: "Brand status published successfully.",
        post
      });
    }

    if (req.method === "DELETE") {
      const body = req.body || {};
      const id = String(body.id || "").trim();

      if (!id) {
        return res.status(400).json({
          ok: false,
          message: "Post ID is required."
        });
      }

      if (!posts.some(post => post.id === id)) {
        return res.status(404).json({
          ok: false,
          message: "Status post not found."
        });
      }

      const updatedPosts = posts.filter(
        post => post.id !== id
      );

      // IMPORTANT: Pass the existing GitHub SHA here too.
      await writeJSON(
        FILE,
        {
          version: 1,
          posts: updatedPosts
        },
        sha
      );

      return res.status(200).json({
        ok: true,
        message: "Status post deleted successfully."
      });
    }

    return res.status(405).json({
      ok: false,
      message: "Method not allowed."
    });

  } catch (error) {
    console.error("Admin brand status API:", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to process brand status request."
    });
  }
};
