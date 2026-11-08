const { readJSON, writeJSON } = require("../../lib/github-storage");

const FILE = "data/brand-status.json";

const VALID_BRANDS = new Set([
  "chowdeck",
  "opay",
  "moniepoint",
  "okash",
  "sun-king",
  "bokku",
  "indomie",
  "dangote",
  "gtbank",
  "access-bank",
  "firstbank",
  "zenith-bank",
  "uba",
  "fidelity-bank",
  "fcmb",
  "sterling-bank",
  "union-bank",
  "kuda",
  "carbon",
  "palmpay",
  "fairmoney",
  "paga",
  "interswitch",
  "flutterwave",
  "paystack",
  "remita",
  "jiji",
  "jumia",
  "konga",
  "slot",
  "tecno",
  "itel",
  "infinix",
  "mtn",
  "airtel",
  "glo",
  "9mobile",
  "showmax",
  "dstv",
  "gotv",
  "bet9ja",
  "sportybet",
  "shoprite",
  "spar",
  "foodco",
  "mcdonalds",
  "dominos",
  "coldstone",
  "rite-foods",
  "peak"
]);

function send(res, status, data) {
  return res.status(status).json(data);
}

function authenticate(req) {
  const secret = process.env.ADMIN_SECRET;

  return Boolean(
    secret &&
    req.headers.authorization === `Bearer ${secret}`
  );
}

function cleanText(value, max = 500) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

function validMediaUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  try {
    const url = new URL(value.trim());

    return ["https:", "http:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function makeId() {
  return `status_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function loadData() {
  const result = await readJSON(FILE, {
    version: 1,
    posts: []
  });

  const data = result.data || {};

  return {
    sha: result.sha,
    data: {
      version: 1,
      posts: Array.isArray(data.posts) ? data.posts : []
    }
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (!["GET", "POST", "DELETE"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST, DELETE, OPTIONS");

    return send(res, 405, {
      ok: false,
      message: "Method not allowed."
    });
  }

  if (!authenticate(req)) {
    return send(res, 401, {
      ok: false,
      message: "Unauthorized."
    });
  }

  try {
    const { sha, data } = await loadData();

    if (req.method === "GET") {
      return send(res, 200, {
        ok: true,
        posts: data.posts
      });
    }

    if (req.method === "POST") {
      const input = req.body || {};

      const brandId = cleanText(input.brandId, 100);
      const mediaType = cleanText(input.mediaType, 20).toLowerCase();
      const mediaUrl = cleanText(input.mediaUrl, 2000);
      const caption = cleanText(input.caption, 500);

      if (!VALID_BRANDS.has(brandId)) {
        return send(res, 400, {
          ok: false,
          message: "Please select a valid existing brand."
        });
      }

      if (!["image", "video"].includes(mediaType)) {
        return send(res, 400, {
          ok: false,
          message: "Media type must be image or video."
        });
      }

      if (!validMediaUrl(mediaUrl)) {
        return send(res, 400, {
          ok: false,
          message: "Please provide a valid HTTP or HTTPS media URL."
        });
      }

      const post = {
        id: makeId(),
        brandId,
        mediaType,
        mediaUrl,
        caption,
        active: true,
        createdAt: new Date().toISOString()
      };

      const updated = {
        version: 1,
        updatedAt: new Date().toISOString(),
        posts: [post, ...data.posts]
      };

      await writeJSON(FILE, updated, sha);

      return send(res, 201, {
        ok: true,
        message: "Status published successfully.",
        post
      });
    }

    if (req.method === "DELETE") {
      const postId = cleanText(
        (req.body && req.body.id) || req.query.id,
        150
      );

      if (!postId) {
        return send(res, 400, {
          ok: false,
          message: "Post ID is required."
        });
      }

      const exists = data.posts.some(post => post.id === postId);

      if (!exists) {
        return send(res, 404, {
          ok: false,
          message: "Status post not found."
        });
      }

      const updated = {
        version: 1,
        updatedAt: new Date().toISOString(),
        posts: data.posts.filter(post => post.id !== postId)
      };

      await writeJSON(FILE, updated, sha);

      return send(res, 200, {
        ok: true,
        message: "Status deleted successfully."
      });
    }

  } catch (error) {
    console.error("Admin brand status API:", error);

    return send(res, 500, {
      ok: false,
      message: "Unable to process brand status request."
    });
  }
};
