const crypto = require("crypto");

const { readJSON, writeJSON } = require("../../lib/github-storage");

module.exports.config = {

  api: {

    bodyParser: false

  }

};

const FILES = {

  payments: "data/payments.json",

  balance: "data/balance.json",

  transactions: "data/transactions.json"

};

const TIME_ZONE = "Africa/Lagos";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/* =====================================================

   RESPONSE

===================================================== */

function send(res, status, data) {

  return res.status(status).json(data);

}

/* =====================================================

   RAW BODY

===================================================== */

async function getRawBody(req) {

  const chunks = [];

  for await (const chunk of req) {

    chunks.push(

      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

    );

  }

  return Buffer.concat(chunks);

}

/* =====================================================

   SIGNATURE VERIFICATION

===================================================== */

function verifySignature(rawBody, signature, secret) {

  if (

    !signature ||

    typeof signature !== "string" ||

    !secret

  ) {

    return false;

  }

  const expected = crypto

    .createHmac("sha512", secret)

    .update(rawBody)

    .digest("hex");

  if (!/^[a-f0-9]{128}$/i.test(signature)) {

    return false;

  }

  const receivedBuffer = Buffer.from(signature, "hex");

  const expectedBuffer = Buffer.from(expected, "hex");

  return (

    receivedBuffer.length === expectedBuffer.length &&

    crypto.timingSafeEqual(

      receivedBuffer,

      expectedBuffer

    )

  );

}

/* =====================================================

   PAYMENT IDENTIFICATION

===================================================== */

function paymentId(payment) {

  return String(payment.id || payment.reference || "");

}

/* =====================================================

   POF PASS GENERATOR

   SAME FORMAT AS ADMIN PAYMENTS API

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

   MAIN WEBHOOK

===================================================== */

export default async function handler(req, res) {

  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "POST") {

    res.setHeader("Allow", "POST");

    return send(res, 405, {

      status: false,

      message: "Method not allowed."

    });

  }

  try {

    const secret = process.env.MOVANTRA_SECRET_KEY;

    if (!secret) {

      console.error("[Liora MOVANTRA] Missing secret key.");

      return send(res, 500, {

        status: false,

        message: "Webhook is not configured."

      });

    }

    /* VERIFY RAW REQUEST SIGNATURE */

    const rawBody = await getRawBody(req);

    const signature =

      req.headers["x-movantra-signature"] || "";

    if (!verifySignature(rawBody, signature, secret)) {

      console.warn("[Liora MOVANTRA] Invalid signature.");

      return send(res, 401, {

        status: false,

        message: "Invalid webhook signature."

      });

    }

    /* PARSE VERIFIED PAYLOAD */

    let payload;

    try {

      payload = JSON.parse(rawBody.toString("utf8"));

    } catch (_) {

      return send(res, 400, {

        status: false,

        message: "Invalid JSON payload."

      });

    }

    const eventName = String(

      req.headers["x-movantra-event"] ||

      payload.event ||

      ""

    ).toLowerCase();

    const supportedEvents = [

      "charge.success",

      "virtual_account.credit"

    ];

    if (!supportedEvents.includes(eventName)) {

      console.log("[Liora MOVANTRA] Ignored event:", eventName);

      return send(res, 200, {

        status: true,

        received: true,

        ignored: true,

        event: eventName

      });

    }

    const data = payload.data || {};

    const reference = String(data.reference || "").trim();

    const currency = String(data.currency || "").toUpperCase();

    const amountKobo = Number(data.amount);

    if (!reference || !Number.isSafeInteger(amountKobo) || amountKobo <= 0) {

      return send(res, 400, {

        status: false,

        message: "Invalid payment reference or amount."

      });

    }

    if (currency !== "NGN") {

      return send(res, 200, {

        status: true,

        received: true,

        ignored: true,

        reason: "Unsupported currency."

      });

    }

    /* LOAD PAYMENT RECORD */

    const paymentFile = await readJSON(FILES.payments, {

      payments: []

    });

    const paymentData = paymentFile.data || {};

    const payments = Array.isArray(paymentData.payments)

      ? paymentData.payments

      : [];

    const index = payments.findIndex(payment =>

      String(payment.reference || "").trim() === reference

    );

    if (index === -1) {

      console.warn("[Liora MOVANTRA] Payment reference not found:", reference);

      return send(res, 200, {

        status: true,

        received: true,

        ignored: true,

        reason: "Payment reference not found."

      });

    }

    const payment = payments[index];

    /* ENSURE THIS IS A MOVANTRA PAGA PAYMENT */

    if (

      String(payment.provider || "").toLowerCase() !== "movantra" ||

      String(payment.method || "").toLowerCase() !== "paga"

    ) {

      return send(res, 200, {

        status: true,

        received: true,

        ignored: true,

        reason: "Payment is not a MOVANTRA Paga payment."

      });

    }

    /* VERIFY AMOUNT AGAINST OUR ORIGINAL PAYMENT */

    const expectedKobo = Number(

      payment.amountKobo || Math.round(Number(payment.amount) * 100)

    );

    if (

      !Number.isSafeInteger(expectedKobo) ||

      expectedKobo <= 0 ||

      expectedKobo !== amountKobo

    ) {

      console.error("[Liora MOVANTRA] Amount mismatch:", {

        reference,

        expectedKobo,

        receivedKobo: amountKobo

      });

      return send(res, 400, {

        status: false,

        message: "Payment amount does not match."

      });

    }

    const currentStatus = String(

      payment.status || "pending"

    ).toLowerCase();

    if (currentStatus === "rejected") {

      return send(res, 200, {

        status: true,

        received: true,

        ignored: true,

        reason: "Payment has already been rejected."

      });

    }

    /*

      Do not interfere with a payment already approved

      through the existing manual admin approval flow.

    */

    if (

      currentStatus === "approved" &&

      payment.movantraWebhookProcessed !== true

    ) {

      return send(res, 200, {

        status: true,

        received: true,

        ignored: true,

        reason: "Payment was already approved separately."

      });

    }

    /* =================================================

       APPROVE PAYMENT AND GENERATE POF

    ================================================= */

    let approvedPayment = payment;

    if (currentStatus !== "approved") {

      const processedAt = new Date().toISOString();

      const pofPass = generateUniquePofPass(

        payment,

        processedAt,

        payments

      );

      approvedPayment = {

        ...payment,

        status: "approved",

        processedAt,

        pofPass,

        pofGeneratedAt: processedAt,

        pofUsed: false,

        pofUsedAt: null,

        approvalSource: "movantra_webhook",

        movantraWebhookProcessed: true

      };

      const updatedPayments = [...payments];

      updatedPayments[index] = approvedPayment;

      await writeJSON(

        FILES.payments,

        {

          ...paymentData,

          payments: updatedPayments

        },

        paymentFile.sha

      );

      console.log("[Liora MOVANTRA] Payment approved:", reference);

    } else {

      /*

        A retry after a partial failure reuses the

        previously generated POF pass.

      */

      approvedPayment = payment;

    }

    /* =================================================

       RECORD SUCCESSFUL TRANSACTION ONCE

    ================================================= */

    const transactionFile = await readJSON(FILES.transactions, {

      transactions: []

    });

    const transactionData = transactionFile.data || {};

    const transactions = Array.isArray(transactionData.transactions)

      ? transactionData.transactions

      : [];

    const id = paymentId(approvedPayment);

    const transactionExists = transactions.some(

      transaction =>

        String(transaction.paymentId || "") === id

    );

    let transaction = transactions.find(

      item => String(item.paymentId || "") === id

    ) || null;

    if (!transactionExists) {

      transaction = {

        id: "TXN-" + crypto.randomBytes(12).toString("hex").toUpperCase(),

        paymentId: id,

        customerName: approvedPayment.customerName || "",

        email: approvedPayment.email || "",

        amount: amountKobo / 100,

        method: approvedPayment.method || "paga",

        reference,

        type: "credit",

        status: "successful",

        description: "MOVANTRA Paga payment",

        createdAt: approvedPayment.processedAt

      };

      await writeJSON(

        FILES.transactions,

        {

          ...transactionData,

          transactions: [transaction, ...transactions]

        },

        transactionFile.sha

      );

    }

    /* =================================================

       UPDATE ADMIN AGGREGATE BALANCE ONCE

       processedPaymentIds is the idempotency marker.

       It is saved in the SAME JSON write as the balance.

    ================================================= */

    const balanceFile = await readJSON(FILES.balance, {

      balance: 0,

      currency: "NGN"

    });

    const balanceData = balanceFile.data || {};

    const currentBalance = Number(balanceData.balance || 0);

    if (!Number.isFinite(currentBalance)) {

      throw new Error("Admin aggregate balance is invalid.");

    }

    const processedPaymentIds = Array.isArray(

      balanceData.processedPaymentIds

    )

      ? balanceData.processedPaymentIds.map(String)

      : [];

    if (!processedPaymentIds.includes(id)) {

      await writeJSON(

        FILES.balance,

        {

          ...balanceData,

          balance: currentBalance + amountKobo / 100,

          currency: balanceData.currency || "NGN",

          processedPaymentIds: [

            ...processedPaymentIds,

            id

          ]

        },

        balanceFile.sha

      );

    }

    console.log("[Liora MOVANTRA] Successful payment processed:", {

      event: eventName,

      reference,

      paymentId: id,

      amount: amountKobo / 100,

      currency,

      mode: payload.mode || null

    });

    return send(res, 200, {

      status: true,

      received: true,

      verified: true,

      approved: true,

      event: eventName,

      reference,

      paymentId: id,

      pofGenerated: Boolean(approvedPayment.pofPass)

    });

  } catch (error) {

    console.error("[Liora MOVANTRA] Processing error:", error);

    return send(res, 500, {

      status: false,

      message: "Webhook processing failed."

    });

  }

}
