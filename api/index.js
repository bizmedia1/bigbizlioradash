
const handlers = {
  "admin/brand-status": require("../lib/api-handlers/admin/brand-status"),
  "admin/payments": require("../lib/api-handlers/admin/payments"),
  "admin/recommendations": require("../lib/api-handlers/admin/recommendations"),
  "admin/settings": require("../lib/api-handlers/admin/settings"),

  "payments/proof": require("../lib/api-handlers/payments/proof"),
  "payments/status": require("../lib/api-handlers/payments/status"),
  "payments/submit": require("../lib/api-handlers/payments/submit"),

  "v2/movantra-webhook": require("../lib/api-handlers/v2/movantra-webhook"),

  "auth": require("../lib/api-handlers/auth"),
  "brand-status": require("../lib/api-handlers/brand-status"),
  "create-mvntpaga": require("../lib/api-handlers/create-mvntpaga"),
  "earnings-credit": require("../lib/api-handlers/earnings-credit"),
  "earnings": require("../lib/api-handlers/earnings"),
  "health": require("../lib/api-handlers/health"),
  "recommendations": require("../lib/api-handlers/recommendations"),
  "settings": require("../lib/api-handlers/settings")
};

async function readRawBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    );
  }

  return Buffer.concat(chunks);
}

async function handler(req, res) {
  try {
    const routeValue = req.query?.route;

    const route = Array.isArray(routeValue)
      ? routeValue.join("/")
      : String(routeValue || "").replace(/^\/+|\/+$/g, "");

    const selectedHandler = handlers[route];

    if (!selectedHandler) {
      return res.status(404).json({
        ok: false,
        error: "API route not found"
      });
    }

    req.rawBody = await readRawBody(req);

    if (route !== "v2/movantra-webhook") {
      if (req.rawBody.length) {
        try {
          req.body = JSON.parse(
            req.rawBody.toString("utf8")
          );
        } catch {
          return res.status(400).json({
            ok: false,
            error: "Invalid JSON body"
          });
        }
      } else {
        req.body = {};
      }
    }

    return await selectedHandler(req, res);

  } catch (error) {
    console.error("[LIORA API ROUTER]", error);

    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        error: "Internal server error"
      });
    }
  }
}

handler.config = {
  api: {
    bodyParser: false
  }
};

module.exports = handler;
