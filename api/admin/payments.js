
const crypto = require("crypto");
const { readJSON, writeJSON } = require("../../lib/github-storage");

const FILES = {
  payments: "data/payments.json",
  balance: "data/balance.json",
  transactions: "data/transactions.json"
};

const TIME_ZONE = "Africa/Lagos";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

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

/* =====================================================
   POF PASS GENERATOR
===================================================== */

function getLagosApprovalParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "long"
  }).formatToParts(date);

  const values = {};

  parts.forEach(part => {
    values[part.type] = part.value;
  });

  return {
    time: `${values.hour}${values.minute}`,
    day: String(values.weekday).slice(0, 4).toUpperCase()
  };
}

function hashLetters(seed) {
  const hash = crypto
    .createHash("sha256")
    .update(String(seed))
    .digest();

  return Array.from(hash.slice(0, 4))
    .map(byte => ALPHABET[byte % 26])
    .join("");
}

function getNameLetters(name, paymentKey) {
  const cleanName = String(name || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();

  let letters = cleanName.slice(0, 4);

  if (letters.length < 4) {
    const fallback = hashLetters(
      `${cleanName}|${paymentKey}`
    );

    letters = (letters + fallback).slice(0, 4);
  }

  return letters;
}

function assemblePofPass(nameLetters, time, day) {
  /*
    Exact arrangement:

    Name: RSIA
    Time: 1145
    Day:  TUES

    Result: RS11IAES45UT
  */

  return (
    nameLetters[0] +
    nameLetters[1] +
    time[0] +
    time[1] +
    nameLetters[2] +
    nameLetters[3] +
    day[2] +
    day[3] +
    time[2] +
    time[3] +
    day[0] +
    day[1]
  );
}

function generateUniquePofPass(payment, processedAt, payments) {
  const date = new Date(processedAt);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid POF approval timestamp.");
  }

  const { time, day } = getLagosApprovalParts(date);

  const key = paymentId(payment);

  const existingPasses = new Set(
    payments
      .map(item => String(item.pofPass || "").toUpperCase())
      .filter(Boolean)
  );

  const originalLetters = getNameLetters(
    payment.customerName,
    key
  );

  for (let attempt = 0; attempt < 10000; attempt++) {
    let letters = originalLetters;

    if (attempt > 0) {
      letters = hashLetters(
        `${payment.customerName}|${key}|${attempt}`
      );
    }

    const pass = assemblePofPass(letters, time, day);

    if (!existingPasses.has(pass)) {
      return pass;
    }
  }

  throw new Error("Unable to generate a unique POF pass.");
}

/* =====================================================
   MAIN HANDLER
===================================================== */

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
        message: "Method not allowed."
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

    /* =================================================
       REJECT PAYMENT
    ================================================= */

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

    /* =================================================
       APPROVE PAYMENT
    ================================================= */

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

    /* Generate the pass before saving approval */

    const pofPass = generateUniquePofPass(
      payment,
      processedAt,
      payments
    );

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
      processedAt,
      pofPass,
      pofGeneratedAt: processedAt,
      pofUsed: false,
      pofUsedAt: null
    };

    /* Save transaction */

    await writeJSON(
      FILES.transactions,
      {
        ...transactionData,
        transactions: [transaction, ...transactions]
      },
      transactionFile.sha
    );

    /* Update balance */

    await writeJSON(
      FILES.balance,
      {
        ...balanceData,
        balance: currentBalance + amount,
        currency: balanceData.currency || "NGN"
      },
      balanceFile.sha
    );

    /* Save approved payment and POF pass */

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
      message: "Payment approved and POF pass generated.",
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
