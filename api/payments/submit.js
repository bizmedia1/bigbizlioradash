const crypto = require("crypto");

const {
  readJSON,
  writeJSON,
  writeFile
} = require("../../lib/github-storage");

const ALLOWED_ORIGIN = "*";

function setCors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
  res.setHeader("Cache-Control", "no-store");
}

function send(res, status, data) {
  return res.status(status).json(data);
}

module.exports = async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");

    return send(res, 405, {
      ok: false,
      message: "Method not allowed"
    });
  }

  try {
    const {
      customerName,
      email,
      phone,
      amount,
      method,
      reference,
      fileName,
      fileType,
      fileData
    } = req.body || {};

    if (
      !customerName ||
      !email ||
      !amount ||
      !method ||
      !fileName ||
      !fileType ||
      !fileData
    ) {
      return send(res, 400, {
        ok: false,
        message: "Please provide your details and payment receipt."
      });
    }

    const allowedExtensions = [
      "jpg", "jpeg", "png", "webp",
      "pdf", "doc", "docx"
    ];

    const extension = String(fileName)
      .split(".")
      .pop()
      .toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      return send(res, 400, {
        ok: false,
        message: "Unsupported receipt file."
      });
    }

    const base64 = String(fileData)
      .replace(/^data:[^;]+;base64,/, "");

    if (!base64 || base64.length > 4 * 1024 * 1024) {
      return send(res, 413, {
        ok: false,
        message: "Receipt must not exceed 3 MB."
      });
    }

    const buffer = Buffer.from(base64, "base64");

    if (buffer.length > 3 * 1024 * 1024) {
      return send(res, 413, {
        ok: false,
        message: "Receipt must not exceed 3 MB."
      });
    }

    const paymentId =
      "PAY-" +
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 8).toUpperCase();

    // Generate a private token for customer-side payment tracking.
    const statusToken = crypto.randomBytes(32).toString("hex");

    const statusTokenHash = crypto
      .createHash("sha256")
      .update(statusToken)
      .digest("hex");

    const safeName = String(fileName)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-100);

    const proofPath =
      `uploads/payment-proofs/${paymentId}-${safeName}`;

    await writeFile(proofPath, base64);

    const stored = await readJSON("data/payments.json", {
      payments: []
    });

    const paymentData = stored.data || {};

    const payments = Array.isArray(paymentData.payments)
      ? paymentData.payments
      : [];

    const payment = {
      id: paymentId,
      customerName: String(customerName).trim(),
      email: String(email).trim().toLowerCase(),
      phone: String(phone || "").trim(),
      amount: Number(amount),
      method: String(method),
      reference: String(reference || ""),
      proofPath,
      proofFileName: safeName,
      proofFileType: String(fileType),
      statusTokenHash,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    payments.unshift(payment);

    await writeJSON(
      "data/payments.json",
      {
        ...paymentData,
        payments
      },
      stored.sha
    );

    return send(res, 201, {
      ok: true,
      message: "Payment proof submitted successfully.",
      paymentId,
      statusToken
    });

  } catch (error) {
    console.error("[Payment Submission]", error);

    return send(res, 500, {
      ok: false,
      message: "Unable to submit payment proof. Please try again."
    });
  }
};
