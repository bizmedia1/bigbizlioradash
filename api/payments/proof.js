const { readFile } = require("../../lib/github-storage");

function getMimeType(path) {
  const extension = path.split(".").pop().toLowerCase();

  const mimeTypes = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };

  return mimeTypes[extension] || "application/octet-stream";
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const secret = process.env.ADMIN_SECRET;
  const auth = req.headers.authorization || "";

  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({
      ok: false,
      message: "Unauthorized"
    });
  }

  if (req.method !== "GET") {
    return res.status(405).json({
      ok: false,
      message: "Method not allowed"
    });
  }

  const path = req.query.path;

  if (
    typeof path !== "string" ||
    !/^uploads\/payment-proofs\/PAY-[A-Z0-9-]+-[a-zA-Z0-9._-]+$/.test(path)
  ) {
    return res.status(400).json({
      ok: false,
      message: "Invalid receipt path"
    });
  }

  try {
    const file = await readFile(path);
    const content = Buffer.from(file.content, "base64");

    res.setHeader("Content-Type", getMimeType(path));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Content-Length", content.length);
    res.setHeader("X-Content-Type-Options", "nosniff");

    return res.status(200).send(content);

  } catch (error) {
    console.error("[Payment Proof]", error);

    return res.status(404).json({
      ok: false,
      message: "Receipt not found"
    });
  }
};
