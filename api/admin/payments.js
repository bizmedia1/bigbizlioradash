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
  const auth = req.headers.authorization || "";
  const secret = process.env.ADMIN_SECRET;

  return Boolean(secret && auth === `Bearer ${secret}`);
}

function getPaymentId(payment) {
  return String(payment.id || payment.reference || "");
}

function getAmount(payment) {
  const amount = Number(payment.amount ?? payment.paymentAmount ?? 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  return amount;
}

module.exports = async function handler(req, res) {
  if (!authenticate(req)) {
    return send(res, 401, {
      ok: false,
      message: "Unauthorized"
    });
  }

  try {
    if (req.method === "GET") {
      const payments = await readJSON(FILES.payments, []);
      const list = Array.isArray(payments) ? payments : [];

      const counts = {
        pending: 0,
        approved: 0,
        rejected: 0
      };

      for (const payment of list) {
        const status = String(payment.status || "pending").toLowerCase();

        if (Object.prototype.hasOwnProperty.call(counts, status)) {
          counts[status]++;
        }
      }

      return send(res, 200, {
        ok: true,
        payments: list,
        counts
      });
    }

    if (req.method === "POST") {
      const { id, action } = req.body || {};

      if (!id || !["approve", "reject"].includes(action)) {
        return send(res, 400, {
          ok: false,
          message: "A payment ID and valid action are required."
        });
      }

      const payments = await readJSON(FILES.payments, []);
      const list = Array.isArray(payments) ? payments : [];

      const index = list.findIndex(
        payment => getPaymentId(payment) === String(id)
      );

      if (index === -1) {
        return send(res, 404, {
          ok: false,
          message: "Payment request not found."
        });
      }

      const payment = list[index];
      const currentStatus = String(
        payment.status || "pending"
      ).toLowerCase();

      if (currentStatus !== "pending") {
        return send(res, 409, {
          ok: false,
          message: "This payment has already been processed.",
          payment
        });
      }

      if (action === "reject") {
        list[index] = {
          ...payment,
          status: "rejected",
          processedAt: new Date().toISOString()
        };

        await writeJSON(FILES.payments, list);

        return send(res, 200, {
          ok: true,
          message: "Payment rejected.",
          payment: list[index]
        });
      }

      const amount = getAmount(payment);

      if (!amount) {
        return send(res, 400, {
          ok: false,
          message: "This payment has an invalid amount."
        });
      }

      const balanceData = await readJSON(FILES.balance, {
        balance: 0
      });

      const currentBalance = Number(
        balanceData.balance ?? balanceData.amount ?? 0
      );

      if (!Number.isFinite(currentBalance) || currentBalance < 0) {
        return send(res, 500, {
          ok: false,
          message: "The stored balance is invalid."
        });
      }

      const transactions = await readJSON(FILES.transactions, []);
      const transactionList = Array.isArray(transactions)
        ? transactions
        : [];

      const processedAt = new Date().toISOString();

      list[index] = {
        ...payment,
        status: "approved",
        processedAt
      };

      const updatedBalance = {
        ...balanceData,
        balance: currentBalance + amount,
        updatedAt: processedAt
      };

      transactionList.push({
        id: `approval_${getPaymentId(payment)}`,
        paymentId: getPaymentId(payment),
        type: "payment_approval",
        amount,
        status: "completed",
        createdAt: processedAt
      });

      await writeJSON(FILES.payments, list);
      await writeJSON(FILES.balance, updatedBalance);
      await writeJSON(FILES.transactions, transactionList);

      return send(res, 200, {
        ok: true,
        message: "Payment approved and balance updated.",
        payment: list[index],
        balance: updatedBalance.balance
      });
    }

    res.setHeader("Allow", ["GET", "POST"]);

    return send(res, 405, {
      ok: false,
      message: "Method not allowed."
    });

  } catch (error) {
    console.error("Admin payments API error:", error);

    return send(res, 500, {
      ok: false,
      message: "Unable to process payment request."
    });
  }
};
