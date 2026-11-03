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
  if (!authenticate(req)) {
    return send(res, 401, { ok: false, message: "Unauthorized" });
  }

  try {
    const paymentFile = await readJSON(FILES.payments, []);
    const payments = Array.isArray(paymentFile.data)
      ? paymentFile.data
      : [];

    if (req.method === "GET") {
      const counts = { pending: 0, approved: 0, rejected: 0 };

      payments.forEach(payment => {
        const status = String(payment.status || "pending").toLowerCase();
        if (counts[status] !== undefined) counts[status]++;
      });

      return send(res, 200, { ok: true, payments, counts });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return send(res, 405, { ok: false, message: "Method not allowed" });
    }

    const { id, action } = req.body || {};

    if (!id || !["approve", "reject"].includes(action)) {
      return send(res, 400, {
        ok: false,
        message: "Payment ID and valid action are required."
      });
    }

    const index = payments.findIndex(p => paymentId(p) === String(id));

    if (index < 0) {
      return send(res, 404, { ok: false, message: "Payment not found." });
    }

    const payment = payments[index];

    if (String(payment.status || "pending").toLowerCase() !== "pending") {
      return send(res, 409, {
        ok: false,
        message: "Payment has already been processed."
      });
    }

    const processedAt = new Date().toISOString();

    if (action === "reject") {
      payments[index] = {
        ...payment,
        status: "rejected",
        processedAt
      };

      await writeJSON(FILES.payments, payments, paymentFile.sha);

      return send(res, 200, {
        ok: true,
        message: "Payment rejected.",
        payment: payments[index]
      });
    }

    const amount = Number(payment.amount ?? payment.paymentAmount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return send(res, 400, {
        ok: false,
        message: "Invalid payment amount."
      });
    }

    const balanceFile = await readJSON(FILES.balance, { balance: 0 });
    const currentBalance = Number(
      balanceFile.data.balance ?? balanceFile.data.amount ?? 0
    );

    if (!Number.isFinite(currentBalance) || currentBalance < 0) {
      return send(res, 500, {
        ok: false,
        message: "Invalid stored balance."
      });
    }

    const transactionFile = await readJSON(FILES.transactions, []);
    const transactions = Array.isArray(transactionFile.data)
      ? transactionFile.data
      : [];

    payments[index] = {
      ...payment,
      status: "approved",
      processedAt
    };

    const updatedBalance = {
      ...balanceFile.data,
      balance: currentBalance + amount,
      updatedAt: processedAt
    };

    transactions.push({
      id: `approval_${paymentId(payment)}`,
      paymentId: paymentId(payment),
      type: "payment_approval",
      amount,
      status: "completed",
      createdAt: processedAt
    });

    await writeJSON(FILES.payments, payments, paymentFile.sha);
    await writeJSON(FILES.balance, updatedBalance, balanceFile.sha);
    await writeJSON(FILES.transactions, transactions, transactionFile.sha);

    return send(res, 200, {
      ok: true,
      message: "Payment approved.",
      payment: payments[index],
      balance: updatedBalance.balance
    });

  } catch (error) {
    console.error("Admin payments API:", error);

    return send(res, 500, {
      ok: false,
      message: "Payment processing failed."
    });
  }
};
