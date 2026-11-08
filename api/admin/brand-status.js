
const { readJSON, writeJSON } = require("../../lib/github-storage");

const FILE = "data/brand-status.json";
const MAX_BRANDS = 50;

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

function validUrl(value, optional = false) {
  if (optional && !value) return true;

  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function cleanText(value, max = 200) {
  return typeof value === "string"
    ? value.trim().slice(0, max)
    : "";
}

function validateBrands(brands) {
  if (!Array.isArray(brands) || brands.length > MAX_BRANDS) {
    return {
      ok: false,
      message: "A maximum of 50 brands is allowed."
    };
  }

  const brandIds = new Set();

  for (const brand of brands) {
    if (!brand || typeof brand !== "object") {
      return { ok: false, message: "Invalid brand data." };
    }

    const id = cleanText(brand.id, 100);
    const name = cleanText(brand.name, 100);
    const username = cleanText(brand.username, 100);

    if (!id || !name || !username) {
      return {
        ok: false,
        message: "Every brand needs an ID, name and username."
      };
    }

    if (brandIds.has(id)) {
      return {
        ok: false,
        message: "Duplicate brand ID: " + id
      };
    }

    brandIds.add(id);

    if (
      typeof brand.active !== "boolean" ||
      !validUrl(brand.profileImage || "", true)
    ) {
      return {
        ok: false,
        message: "Invalid brand activation or profile image."
      };
    }

    const rewardMin = Number(brand.rewardMin);
    const rewardMax = Number(brand.rewardMax);

    if (
      !Number.isFinite(rewardMin) ||
      !Number.isFinite(rewardMax) ||
      rewardMin < 0 ||
      rewardMax < rewardMin
    ) {
      return {
        ok: false,
        message: "Invalid reward range for " + name + "."
      };
    }

    const statuses = brand.statuses ?? [];

    if (!Array.isArray(statuses)) {
      return {
        ok: false,
        message: "Invalid statuses for " + name + "."
      };
    }

    const statusIds = new Set();

    for (const status of statuses) {
      if (!status || typeof status !== "object") {
        return { ok: false, message: "Invalid status data." };
      }

      const statusId = cleanText(status.id, 100);

      if (!statusId || statusIds.has(statusId)) {
        return {
          ok: false,
          message: "Every status needs a unique ID."
        };
      }

      statusIds.add(statusId);

      if (
        !["image", "video"].includes(status.mediaType) ||
        !validUrl(status.mediaUrl) ||
        typeof status.active !== "boolean"
      ) {
        return {
          ok: false,
          message: "Invalid status media or activation for " + name + "."
        };
      }
    }
  }

  return { ok: true };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "PUT"].includes(req.method)) {
    res.setHeader("Allow", "GET, PUT");

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
    const current = await readJSON(FILE, {
      version: 1,
      enabled: true,
      brands: []
    });

    const data = current.data || {
      version: 1,
      enabled: true,
      brands: []
    };

    if (req.method === "GET") {
      return send(res, 200, {
        ok: true,
        settings: {
          version: data.version || 1,
          enabled: data.enabled !== false,
          brands: Array.isArray(data.brands) ? data.brands : []
        }
      });
    }

    const input = req.body || {};

    if (
      typeof input.enabled !== "boolean" ||
      !Array.isArray(input.brands)
    ) {
      return send(res, 400, {
        ok: false,
        message: "Enabled setting and brands array are required."
      });
    }

    const validation = validateBrands(input.brands);

    if (!validation.ok) {
      return send(res, 400, {
        ok: false,
        message: validation.message
      });
    }

    const updated = {
      version: 1,
      enabled: input.enabled,
      updatedAt: new Date().toISOString(),
      brands: input.brands.map(brand => ({
        id: cleanText(brand.id, 100),
        name: cleanText(brand.name, 100),
        username: cleanText(brand.username, 100),
        profileImage: cleanText(brand.profileImage, 2000),
        rewardMin: Number(brand.rewardMin),
        rewardMax: Number(brand.rewardMax),
        active: brand.active,
        statuses: (brand.statuses || []).map(status => ({
          id: cleanText(status.id, 100),
          mediaType: status.mediaType,
          mediaUrl: cleanText(status.mediaUrl, 2000),
          caption: cleanText(status.caption, 500),
          active: status.active
        }))
      }))
    };

    await writeJSON(FILE, updated, current.sha);

    return send(res, 200, {
      ok: true,
      message: "Brand status settings updated.",
      settings: updated
    });

  } catch (error) {
    console.error("Admin brand status API:", error);

    return send(res, 500, {
      ok: false,
      message: "Unable to update brand status settings."
    });
  }
};
