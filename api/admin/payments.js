const { readJSON, writeJSON } = require("../../lib/github-storage");

const FILES = {
  payments: "data/payments.json",
  balance: "data/balance.json",
  transactions: "data/transactions.json"
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
      const counts = {
        pending: 0,
        approved: 0,
        rejected: 0
      };

      payments.forEach(payment => {
        const status = String(payment.status || "pending").toLowerCase();

        if (counts[status] !== undefined) {
          counts[status]++;
        }
      });

      return send(res, 200, {
        ok: true,
        payments,
        counts
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

    const processedAt = new Date().toISOString();

    const updatedPayments = [...payments];

    if (action === "reject") {
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
    }

    return send(res, 501, {
      ok: false,
      message: "Approvals are temporarily disabled until balance updates are made safe."
    });

  } catch (error) {
    console.error("Admin payments API:", error);

    return send(res, 500, {
      ok: false,
      message: "Payment processing failed."
    });
  }
};
