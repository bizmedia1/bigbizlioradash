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

    const amount = Number(payment.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      return send(res, 400, {
        ok: false,
        message: "Invalid payment amount."
      });
    }

    const balanceFile = await readJSON(FILES.balance, {
      balance: 0,
      currency: "NGN"
    });

    const balanceData = balanceFile.data || {};
    const currentBalance = Number(balanceData.balance || 0);

    if (!Number.isFinite(currentBalance)) {
      return send(res, 500, {
        ok: false,
        message: "Wallet balance data is invalid."
      });
    }

    const transactionFile = await readJSON(FILES.transactions, {
      transactions: []
    });

    const transactionData = transactionFile.data || {};
    const transactions = Array.isArray(transactionData.transactions)
      ? transactionData.transactions
      : [];

    const transactionExists = transactions.some(
      transaction =>
        transaction.paymentId === paymentId(payment)
    );

    if (transactionExists) {
      return send(res, 409, {
        ok: false,
        message: "A transaction already exists for this payment."
      });
    }

    const transaction = {
      id: "TXN-" + Date.now(),
      paymentId: paymentId(payment),
      customerName: payment.customerName || "",
      email: payment.email || "",
      amount,
      method: payment.method || "",
      reference: payment.reference || "",
      type: "credit",
      status: "successful",
      description: "Approved customer payment",
      createdAt: processedAt
    };

    updatedPayments[index] = {
      ...payment,
      status: "approved",
      processedAt
    };

    await writeJSON(
      FILES.transactions,
      {
        ...transactionData,
        transactions: [transaction, ...transactions]
      },
      transactionFile.sha
    );

    await writeJSON(
      FILES.balance,
      {
        ...balanceData,
        balance: currentBalance + amount,
        currency: balanceData.currency || "NGN"
      },
      balanceFile.sha
    );

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
      message: "Payment approved and wallet balance updated.",
      payment: updatedPayments[index],
      transaction,
      balance: currentBalance + amount
    });

  } catch (error) {
    console.error("Admin payments API:", error);

    return send(res, 500, {
      ok: false,
      message: "Payment processing failed."
    });
  }
};
