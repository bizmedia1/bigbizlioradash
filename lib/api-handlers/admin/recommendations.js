const {
  readJSON,
  writeJSON,
  writeFile,
  deleteFile
} = require("../../github-storage");

const { randomUUID } = require("crypto");

const DATA_FILE = "data/recommendations.json";
const MAX_IMAGE_SIZE = 1400000;

const CREATORS = {
  "creator-1": "Mr Babs",
  "creator-2": "Purple Speedy",
  "creator-3": "Two Glazzes",
  "creator-4": "Smart BM",
  "creator-5": "Luta Editz"
};

function isAuthorized(req) {
  const token = process.env.ADMIN_SECRET;

  return Boolean(
    token &&
    req.headers.authorization === `Bearer ${token}`
  );
}

function validateImage(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} image is required`);
  }

  const match = value.match(
    /^data:(image\/jpeg|image\/png|image\/webp);base64,([A-Za-z0-9+/=]+)$/
  );

  if (!match) {
    throw new Error(`${label} must be a JPEG, PNG or WebP image`);
  }

  const buffer = Buffer.from(match[2], "base64");

  if (!buffer.length || buffer.length > MAX_IMAGE_SIZE) {
    throw new Error(`${label} image must be smaller than 1.4 MB`);
  }

  return {
    mime: match[1],
    base64: match[2],
    extension: {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    }[match[1]]
  };
}

function validateText(value, label) {
  const text = String(value || "").trim();

  if (!text || text.length > 100) {
    throw new Error(`${label} is required (maximum 100 characters)`);
  }

  return text;
}

async function loadData() {
  const result = await readJSON(DATA_FILE, {});
  return {
    data: result.data || {},
    sha: result.sha
  };
}

async function removeOldImages(recommendation) {
  const images = recommendation?.products || [];

  for (const product of images) {
    const path = product?.imagePath;

    if (
      typeof path === "string" &&
      path.startsWith("uploads/recommendations/")
    ) {
      try {
        await deleteFile(path);
      } catch (error) {
        if (error.status !== 404) {
          console.error("Recommendation image cleanup failed:", error);
        }
      }
    }
  }
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!["GET", "POST", "DELETE"].includes(req.method)) {
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
    const current = await loadData();

    if (req.method === "GET") {
      return res.status(200).json({
        ok: true,
        recommendations: current.data
      });
    }

    const input = req.body || {};
    const creatorId = String(input.creatorId || "");

    if (!Object.prototype.hasOwnProperty.call(CREATORS, creatorId)) {
      return res.status(400).json({
        ok: false,
        message: "Select a valid creator"
      });
    }

    if (req.method === "DELETE") {
      const existing = current.data[creatorId];

      if (!existing) {
        return res.status(404).json({
          ok: false,
          message: "Recommendation not found"
        });
      }

      const updated = { ...current.data };
      delete updated[creatorId];

      await writeJSON(DATA_FILE, updated, current.sha);
      await removeOldImages(existing);

      return res.status(200).json({
        ok: true,
        message: "Recommendation deleted",
        recommendations: updated
      });
    }

    const productOneName = validateText(
      input.productOneName,
      "Product 1 name"
    );

    const productTwoName = validateText(
      input.productTwoName,
      "Product 2 name"
    );

    const reward = Number(input.reward);

    if (
      !Number.isSafeInteger(reward) ||
      reward < 1 ||
      reward > 100000000
    ) {
      return res.status(400).json({
        ok: false,
        message: "Enter a valid reward amount"
      });
    }

    const imageOne = validateImage(input.productOneImage, "Product 1");
    const imageTwo = validateImage(input.productTwoImage, "Product 2");

    const uploadId = randomUUID();

    const pathOne =
      `uploads/recommendations/${creatorId}-${uploadId}-product-1.${imageOne.extension}`;

    const pathTwo =
      `uploads/recommendations/${creatorId}-${uploadId}-product-2.${imageTwo.extension}`;

    const uploadedOne = await writeFile(pathOne, imageOne.base64);
    const uploadedTwo = await writeFile(pathTwo, imageTwo.base64);

    const previous = current.data[creatorId];

    const updated = {
      ...current.data,
      [creatorId]: {
        creatorId,
        creatorName: CREATORS[creatorId],
        products: [
          {
            name: productOneName,
            image: uploadedOne.content.download_url,
            imagePath: pathOne
          },
          {
            name: productTwoName,
            image: uploadedTwo.content.download_url,
            imagePath: pathTwo
          }
        ],
        reward,
        updatedAt: new Date().toISOString()
      }
    };

    await writeJSON(DATA_FILE, updated, current.sha);

    if (previous) {
      await removeOldImages(previous);
    }

    return res.status(200).json({
      ok: true,
      message: "Recommendation saved successfully",
      recommendations: updated
    });

  } catch (error) {
    console.error("Recommendations admin API error:", error);

    return res.status(error.status === 409 ? 409 : 400).json({
      ok: false,
      message: error.message || "Unable to process recommendation"
    });
  }
};
