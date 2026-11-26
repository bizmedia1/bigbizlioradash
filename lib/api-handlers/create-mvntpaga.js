
const crypto = require("crypto");
const {
  readJSON,
  writeJSON
} = require("../github-storage");

const PAYMENTS_FILE = "data/payments.json";

function send(res, status, data) {
  return res.status(status).json(data);
}

function makeReference() {
  return (
    "lp_" +
    Date.now() +
    "_" +
    crypto.randomBytes(5).toString("hex")
  ).slice(0, 32);
}

function makePaymentId() {
  return "PAY-PAGA-" + crypto.randomBytes(12).toString("hex");
}

function makeStatusToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto
    .createHash("sha256")
    .update(String(token))
    .digest("hex");
}

module.exports = async function handler(req, res) {

  /* =====================================================
     CORS
  ===================================================== */

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return send(res, 405, {
      status: false,
      message: "Method not allowed."
    });
  }

  try {

    /* ===================================================
       MOVANTRA SECRET
    =================================================== */

    const secretKey = process.env.MOVANTRA_SECRET_KEY;

    if (!secretKey) {
      console.error("MOVANTRA_SECRET_KEY is not configured.");

      return send(res, 500, {
        status: false,
        message: "Payment service is not configured."
      });
    }

    /* ===================================================
       REQUEST BODY
    =================================================== */

    const body = req.body || {};

    const {
      amount,
      amount_kobo,
      name,
      customer_name,
      email,
      customer_email,
      phone,
      customer_phone,
      expiry_minutes,
      callback_url
    } = body;

    /* ===================================================
       AMOUNT
    =================================================== */

    let finalAmountKobo;

    if (amount_kobo !== undefined && amount_kobo !== null) {
      finalAmountKobo = Number(amount_kobo);

    } else if (amount !== undefined && amount !== null) {
      const nairaAmount = Number(amount);

      if (!Number.isFinite(nairaAmount) || nairaAmount <= 0) {
        return send(res, 400, {
          status: false,
          message: "Invalid amount."
        });
      }

      finalAmountKobo = Math.round(nairaAmount * 100);

    } else {
      return send(res, 400, {
        status: false,
        message: "amount or amount_kobo is required."
      });
    }

    if (!Number.isSafeInteger(finalAmountKobo)) {
      return send(res, 400, {
        status: false,
        message: "Amount must be a valid integer."
      });
    }

    if (finalAmountKobo < 10000) {
      return send(res, 400, {
        status: false,
        code: "amount_too_low",
        message: "Minimum amount is NGN 100."
      });
    }

    /* ===================================================
       CUSTOMER DETAILS
    =================================================== */

    const finalCustomerName = String(
      customer_name || name || ""
    ).trim();

    const finalCustomerEmail = String(
      customer_email || email || ""
    ).trim().toLowerCase();

    const finalCustomerPhone = String(
      customer_phone || phone || ""
    ).trim();

    if (!finalCustomerName) {
      return send(res, 400, {
        status: false,
        message: "customer_name is required."
      });
    }

    if (
      !finalCustomerEmail ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(finalCustomerEmail)
    ) {
      return send(res, 400, {
        status: false,
        message: "A valid customer email is required."
      });
    }

    /* ===================================================
       UNIQUE PROVIDER REFERENCE
    =================================================== */

    const finalReference = makeReference();

    /* ===================================================
       EXPIRY
    =================================================== */

    let finalExpiry = 30;

    if (
      expiry_minutes !== undefined &&
      expiry_minutes !== null &&
      expiry_minutes !== ""
    ) {
      finalExpiry = Number(expiry_minutes);
    }

    if (
      !Number.isInteger(finalExpiry) ||
      finalExpiry < 5 ||
      finalExpiry > 60
    ) {
      return send(res, 400, {
        status: false,
        message: "expiry_minutes must be between 5 and 60."
      });
    }

    /* ===================================================
       MOVANTRA REQUEST
    =================================================== */

    const movantraBody = {
      amount_kobo: finalAmountKobo,
      customer_name: finalCustomerName,
      reference: finalReference,
      expiry_minutes: finalExpiry
    };

    if (finalCustomerEmail) {
      movantraBody.customer_email = finalCustomerEmail;
    }

    if (finalCustomerPhone) {
      movantraBody.customer_phone = finalCustomerPhone;
    }

    const finalCallbackUrl =
      process.env.PAGA_CALLBACK_URL ||
      callback_url ||
      "";

    if (finalCallbackUrl) {
      movantraBody.callback_url = finalCallbackUrl;
    }

    /* ===================================================
       CALL MOVANTRA
    =================================================== */

    const providerResponse = await fetch(
      "https://api.movantrapay.com/v1/paga/dynamic-accounts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(movantraBody)
      }
    );

    let result;

    try {
      result = await providerResponse.json();
    } catch (error) {
      console.error("Invalid Movantra response:", error);

      return send(res, 502, {
        status: false,
        message: "Invalid response from payment provider."
      });
    }

    /* ===================================================
       MOVANTRA ERROR
    =================================================== */

    if (
      !providerResponse.ok ||
      !result ||
      result.status !== true
    ) {
      console.error("Movantra Paga error:", result);

      return send(
        res,
        providerResponse.status >= 400 &&
        providerResponse.status < 600
          ? providerResponse.status
          : 502,
        {
          status: false,
          code: result?.code || "paga_account_error",
          message:
            result?.message ||
            "Unable to create Paga dynamic account."
        }
      );
    }

    /* ===================================================
       VALIDATE ACCOUNT RESPONSE
    =================================================== */

    if (
      !result.account_number ||
      !result.account_name ||
      !result.bank_name
    ) {
      console.error("Incomplete Paga account response:", result);

      return send(res, 502, {
        status: false,
        message: "Paga returned an incomplete account."
      });
    }

    const providerReference = String(
      result.reference || finalReference
    ).trim();

    if (!providerReference) {
      return send(res, 502, {
        status: false,
        message: "Paga returned an invalid payment reference."
      });
    }

    /* ===================================================
       CREATE SECURE PAYMENT TRACKING
    =================================================== */

    const paymentId = makePaymentId();
    const statusToken = makeStatusToken();
    const createdAt = new Date().toISOString();

    const paymentRecord = {
      id: paymentId,
      customerName: finalCustomerName,
      email: finalCustomerEmail,
      phone: finalCustomerPhone,
      amount: finalAmountKobo / 100,
      amountKobo: finalAmountKobo,
      method: "paga",
      reference: providerReference,
      provider: "movantra",
      status: "pending",
      statusTokenHash: hashToken(statusToken),
      createdAt,
      processedAt: null,
      pofPass: null,
      pofGeneratedAt: null,
      pofUsed: false,
      pofUsedAt: null
    };

    /* ===================================================
       SAVE PAYMENT RECORD
    =================================================== */

    const paymentFile = await readJSON(
      PAYMENTS_FILE,
      { payments: [] }
    );

    const paymentData = paymentFile.data || {};

    const payments = Array.isArray(paymentData.payments)
      ? paymentData.payments
      : [];

    const duplicateReference = payments.some(
      payment =>
        String(payment.reference || "") === providerReference
    );

    if (duplicateReference) {
      console.error(
        "[LIORA PAGA] Duplicate provider reference:",
        providerReference
      );

      return send(res, 409, {
        status: false,
        message: "Payment reference already exists."
      });
    }

    await writeJSON(
      PAYMENTS_FILE,
      {
        ...paymentData,
        payments: [paymentRecord, ...payments]
      },
      paymentFile.sha
    );

    /* ===================================================
       LOG ACCOUNT CREATION
    =================================================== */

    console.log("[LIORA PAGA ACCOUNT CREATED]", {
      paymentId,
      reference: providerReference,
      amount: finalAmountKobo,
      email: finalCustomerEmail,
      account_number: result.account_number,
      bank_name: result.bank_name
    });

    /* ===================================================
       RETURN TO CARRD
    =================================================== */

    return send(res, 200, {
      status: true,

      paymentId,
      statusToken,

      reference: providerReference,

      account_number: result.account_number,
      account_name: result.account_name,
      bank_name: result.bank_name,

      amount_kobo:
        result.amount_kobo || finalAmountKobo,

      fee_kobo: result.fee_kobo ?? null,
      net_kobo: result.net_kobo ?? null,

      status_text: result.status_text || "pending",
      expires_at: result.expires_at || null,
      mode: result.mode || null
    });

  } catch (error) {

    console.error("[LIORA PAGA BACKEND]", error);

    return send(res, 500, {
      status: false,
      message: "Unable to create Paga payment account."
    });
  }
};
