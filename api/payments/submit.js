const { readJSON, writeJSON, writeFile } = require("../../lib/github-storage");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {
    return res.status(405).json({
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

    if (!customerName || !email || !amount || !method ||
        !fileName || !fileType || !fileData) {
      return res.status(400).json({
        ok: false,
        message: "Please provide your details and payment receipt."
      });
    }

    const allowedExtensions = [
      "jpg", "jpeg", "png", "webp",
      "pdf", "doc", "docx"
    ];

    const extension = String(fileName).split(".").pop().toLowerCase();

    if (!allowedExtensions.includes(extension)) {
      return res.status(400).json({
        ok: false,
        message: "Unsupported receipt file."
      });
    }

    const base64 = String(fileData).replace(/^data:[^;]+;base64,/, "");

    if (!base64 || base64.length > 4 * 1024 * 1024) {
      return res.status(413).json({
        ok: false,
        message: "Receipt must not exceed 3 MB."
      });
    }

    const buffer = Buffer.from(base64, "base64");

    if (buffer.length > 3 * 1024 * 1024) {
      return res.status(413).json({
        ok: false,
        message: "Receipt must not exceed 3 MB."
      });
    }

    const paymentId =
      "PAY-" + Date.now() + "-" +
      Math.random().toString(36).slice(2, 8).toUpperCase();

    const safeName = String(fileName)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(-100);

    const proofPath =
      `uploads/payment-proofs/${paymentId}-${safeName}`;

    await writeFile(proofPath, base64);

    const stored = await readJSON("data/payments.json", {
      payments: []
    });

    const payments = Array.isArray(stored.data.payments)
      ? stored.data.payments
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
      status: "pending",
      createdAt: new Date().toISOString()
    };

    payments.unshift(payment);

    await writeJSON(
      "data/payments.json",
      { ...stored.data, payments },
      stored.sha
    );

    return res.status(201).json({
      ok: true,
      message: "Payment proof submitted successfully.",
      paymentId
    });

  } catch (error) {
    console.error("[Payment Submission]", error);

    return res.status(500).json({
      ok: false,
      message: "Unable to submit payment proof. Please try again."
    });
  }
};
