import defaultWorker from "./worker-v4.js";
import stableRenderer from "./worker-stable-renderer-v2.js";
import notionEmbedWorker from "./worker-notion-embed.js";
import nooxyWorker from "./worker-nooxy.js";

const PREVIEW_HOST = "bali-discount.niibet34.workers.dev";
const PRODUCTION_HOSTS = new Set(["bali.discount", "www.bali.discount"]);
const BUILD_ID = "2026-09-25-villa-telegram-leads-01";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/villa-lead") {
      return handleVillaLead(request, env);
    }

    if (url.pathname === "/__version") {
      const assetUrl = new URL("/assets/bali-desktop-road-user.webp", url.origin);
      let assetStatus = null;
      let assetType = null;
      let assetLength = null;
      try {
        const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), request));
        assetStatus = assetResponse.status;
        assetType = assetResponse.headers.get("content-type");
        assetLength = assetResponse.headers.get("content-length");
      } catch (error) {
        assetStatus = `error:${error?.message || String(error)}`;
      }

      return new Response(JSON.stringify({
        build: BUILD_ID,
        host: url.hostname,
        notionMode: "official-embed",
        asset: {
          path: "/assets/bali-desktop-road-user.webp",
          status: assetStatus,
          contentType: assetType,
          contentLength: assetLength,
        },
      }, null, 2), {
        status: 200,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname === "/en/" || url.pathname === "/ru/") {
      const target = new URL(url.toString());
      target.pathname = url.pathname.slice(0, -1);
      return Response.redirect(target.toString(), 301);
    }

    // Keep Nooxy available only on the workers.dev preview host for diagnostics.
    if (url.hostname === PREVIEW_HOST) {
      return nooxyWorker.fetch(request, env, ctx);
    }

    // Keep the custom SSR renderer as a separate fallback/test path.
    if (isBranch(url.pathname, "/stable/ru") || isBranch(url.pathname, "/stable/en")) {
      return stableRenderer.fetch(request, env, ctx);
    }

    // Production tours use Notion's own embeddable public-site runtime directly.
    // Nothing from Notion is reverse-proxied through bali.discount.
    if (
      PRODUCTION_HOSTS.has(url.hostname) &&
      (isBranch(url.pathname, "/ru") || isBranch(url.pathname, "/en"))
    ) {
      return notionEmbedWorker.fetch(request, env, ctx);
    }

    return defaultWorker.fetch(request, env, ctx);
  },
};

function isBranch(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}


async function handleVillaLead(request, env) {
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, {
      Allow: "POST",
    });
  }

  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.error("Villa lead endpoint is missing Telegram secrets.");
    return jsonResponse({ ok: false, error: "lead_service_not_configured" }, 503);
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse({ ok: false, error: "invalid_content_type" }, 415);
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 20000) {
    return jsonResponse({ ok: false, error: "payload_too_large" }, 413);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonResponse({ ok: false, error: "invalid_payload" }, 400);
  }

  // Honeypot: real visitors never fill this hidden field.
  if (cleanField(body.website, 120)) {
    return jsonResponse({ ok: true }, 200);
  }

  const lead = {
    stayType: cleanField(body.stayType, 80),
    area: cleanField(body.area, 100),
    checkIn: cleanField(body.checkIn, 32),
    checkOut: cleanField(body.checkOut, 32),
    bedrooms: cleanField(body.bedrooms, 40),
    guests: cleanField(body.guests, 16),
    budget: cleanField(body.budget, 40),
    currency: cleanField(body.currency, 12),
    requirements: cleanField(body.requirements, 1200),
    name: cleanField(body.name, 120),
    whatsapp: cleanField(body.whatsapp, 80),
    source: cleanField(body.source, 120) || "bali.discount/villas",
    createdAt: cleanField(body.createdAt, 64),
  };

  const required = ["stayType", "area", "bedrooms", "budget", "currency", "name", "whatsapp"];
  if (required.some((key) => !lead[key])) {
    return jsonResponse({ ok: false, error: "missing_required_fields" }, 400);
  }

  const message = buildTelegramVillaLead(lead);
  const telegramPayload = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };

  const threadId = Number(env.TELEGRAM_MESSAGE_THREAD_ID || "");
  if (Number.isInteger(threadId) && threadId > 0) {
    telegramPayload.message_thread_id = threadId;
  }

  const waDigits = lead.whatsapp.replace(/\D/g, "");
  if (waDigits.length >= 7 && waDigits.length <= 16) {
    telegramPayload.reply_markup = {
      inline_keyboard: [[
        {
          text: "Open WhatsApp",
          url: `https://wa.me/${waDigits}`,
        },
      ]],
    };
  }

  let telegramResponse;
  try {
    telegramResponse = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(telegramPayload),
      },
    );
  } catch (error) {
    console.error("Telegram request failed:", error?.message || String(error));
    return jsonResponse({ ok: false, error: "telegram_unreachable" }, 502);
  }

  let telegramResult = null;
  try {
    telegramResult = await telegramResponse.json();
  } catch {
    // Ignore malformed upstream JSON and handle via status below.
  }

  if (!telegramResponse.ok || !telegramResult?.ok) {
    console.error("Telegram sendMessage failed:", {
      status: telegramResponse.status,
      description: telegramResult?.description || "unknown_error",
    });
    return jsonResponse({ ok: false, error: "telegram_send_failed" }, 502);
  }

  return jsonResponse({ ok: true }, 200);
}

function buildTelegramVillaLead(lead) {
  const when = formatLeadTime(lead.createdAt);
  const lines = [
    "🏡 <b>NEW VILLA REQUEST</b>",
    "<b>Bali Discount</b>",
    "",
    `📍 <b>Area:</b> ${escapeHtml(lead.area)}`,
    `🏠 <b>Rental:</b> ${escapeHtml(lead.stayType)}`,
    `📅 <b>Check-in:</b> ${escapeHtml(lead.checkIn || "Flexible")}`,
    `📅 <b>Check-out:</b> ${escapeHtml(lead.checkOut || "Flexible")}`,
    `🛏 <b>Bedrooms:</b> ${escapeHtml(lead.bedrooms)}`,
    `👥 <b>Guests:</b> ${escapeHtml(lead.guests || "—")}`,
    `💰 <b>Budget:</b> ${escapeHtml(lead.budget)} ${escapeHtml(lead.currency)}`,
    "",
    `✨ <b>Requirements:</b> ${escapeHtml(lead.requirements || "—")}`,
    "",
    `👤 <b>Name:</b> ${escapeHtml(lead.name)}`,
    `📱 <b>WhatsApp:</b> ${escapeHtml(lead.whatsapp)}`,
    "",
    `🌐 <b>Source:</b> ${escapeHtml(lead.source)}`,
  ];

  if (when) {
    lines.push(`🕒 <b>Received:</b> ${escapeHtml(when)}`);
  }

  return lines.join("\n");
}

function cleanField(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatLeadTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Makassar",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date) + " WITA";
  } catch {
    return "";
  }
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });
}
