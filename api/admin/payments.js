const { readJSON, writeJSON } = require("../../lib/github-storage");

const FILES = {
  payments: "data/payments.json",
  balance: "data/balance.json"
};

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

function paymentId(payment) {
  return String(payment.id || payment.reference || "");
}

function getCounts(payments) {
  const counts = {
    pending: 0,
    approved: 0,
    rejected: 0
  };

  payments.forEach(payment => {
    const status = String(payment.status || "pending").toLowerCase();

    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status]++;
    }
  });

  return counts;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!authenticate(req)) {
    return send(res, 401, {
      ok: false,
      message: "Unauthorized"
    });
  }

  try {
    const paymentFile = await readJSON(FILES.payments, {
      payments: []
    });

    const paymentData = paymentFile.data || {};
    const payments = Array.isArray(paymentData.payments)
      ? paymentData.payments
      : [];

    if (req.method === "GET") {
      const balanceFile = await readJSON(FILES.balance, {
        balance: 0,
        currency: "NGN"
      });

      const balanceData = balanceFile.data || {};

      return send(res, 200, {
        ok: true,
        payments,
        counts: getCounts(payments),
        balance: Number(balanceData.balance || 0),
        currency: balanceData.currency || "NGN"
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");

      return send(res, 405, {
        ok: false,
        message: "Method not allowed"
      });
    }

    const { id, action } = req.body || {};

    if (!id || !["approve", "reject"].includes(action)) {
      return send(res, 400, {
        ok: false,
        message: "Payment ID and valid action are required."
      });
    }

    const index = payments.findIndex(
      payment => paymentId(payment) === String(id)
    );

    if (index === -1) {
      return send(res, 404, {
        ok: false,
        message: "Payment not found."
      });
    }

    const payment = payments[index];

    if (String(payment.status || "pending").toLowerCase() !== "pending") {
      return send(res, 409, {
        ok: false,
        message: "Payment has already been processed."
      });
    }

    if (action === "approve") {
      return send(res, 501, {
        ok: false,
        message: "Payment approvals are temporarily disabled."
      });
    }

    const processedAt = new Date().toISOString();
    const updatedPayments = [...payments];

    updatedPayments[index] = {
      ...payment,
      status: "rejected",
      processedAt
    };

    await writeJSON(
      FILES.payments,
      {
        ...paymentData,
        payments: updatedPayments
      },
      paymentFile.sha
    );

    return send(res, 200, {
      ok: true,
      message: "Payment rejected.",
      payment: updatedPayments[index]
    });

  } catch (error) {
    console.error("Admin payments API:", error);

    return send(res, 500, {
      ok: false,
      message: "Payment processing failed."
    });
  }
};
