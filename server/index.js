const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const crypto  = require("crypto");
const fetch   = require("node-fetch");
require("dotenv").config({ path: "../.env" });

const app = express();

app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

// ── Supabase client ──────────────────────────────────────────────────
const supabase = process.env.SUPABASE_URL
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

function log(level, msg, data = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...data }));
}

// ── Save message to Supabase ─────────────────────────────────────────
async function saveMessage(message, context, classification, outcome, extras = {}) {
  if (!supabase) return;
  try {
    const { data, error } = await supabase.from("messages").insert({
      brand: context.brand || "Gental Care",
      platform: context.platform,
      type: context.type,
      sender_id: context.senderId,
      sender_name: context.senderName,
      message_text: message,
      intent: classification.intent,
      sentiment: classification.sentiment,
      action_taken: outcome || classification.action,
      reply_sent: classification.reply,
      confidence: classification.confidence,
      escalation_tag: classification.escalation_tag,
      escalation_reason: classification.escalation_reason,
      zoho_ticket_id: extras.zohoTicketId || null,
    }).select();
    if (error) log("warn", "Supabase message insert failed", { error: error.message });
    return data?.[0];
  } catch (err) {
    log("warn", "Supabase error", { error: err.message });
  }
}

// ── Save escalation to Supabase ──────────────────────────────────────
async function saveEscalation(message, context, classification, messageId) {
  if (!supabase) return;
  try {
    await supabase.from("escalations").insert({
      message_id: messageId,
      brand: context.brand || "Gental Care",
      platform: context.platform,
      sender_name: context.senderName,
      message_text: message,
      tag: classification.escalation_tag,
      priority: classification.priority,
      status: "open",
    });
  } catch (err) {
    log("warn", "Supabase escalation insert failed", { error: err.message });
  }
}

// ── Update daily sentiment ───────────────────────────────────────────
async function updateSentiment(sentiment, brand = "Gental Care") {
  if (!supabase) return;
  try {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("sentiment_daily")
      .select("*")
      .eq("brand", brand)
      .eq("date", today)
      .single();

    if (data) {
      const pos = data.positive_count + (sentiment === "positive" ? 1 : 0);
      const neu = data.neutral_count  + (sentiment === "neutral"  ? 1 : 0);
      const neg = data.negative_count + (sentiment === "negative" ? 1 : 0);
      const total = pos + neu + neg;
      const score = total > 0 ? Math.round(((pos * 100) + (neu * 50)) / total) : 0;
      await supabase.from("sentiment_daily").update({
        positive_count: pos, neutral_count: neu, negative_count: neg,
        total_count: total, score
      }).eq("id", data.id);
    } else {
      const pos = sentiment === "positive" ? 1 : 0;
      const neu = sentiment === "neutral"  ? 1 : 0;
      const neg = sentiment === "negative" ? 1 : 0;
      await supabase.from("sentiment_daily").insert({
        brand, date: today,
        positive_count: pos, neutral_count: neu, negative_count: neg,
        total_count: 1,
        score: sentiment === "positive" ? 100 : sentiment === "neutral" ? 50 : 0
      });
    }
  } catch (err) {
    log("warn", "Supabase sentiment update failed", { error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────
// BRAND KNOWLEDGE BASE
// ─────────────────────────────────────────────────────────────────────
const BRAND_CONTEXT = `You are the AI backend for Gental Care's automated social media response system.
Gental Care is a brand by Bidco Africa (Kenya) making baby diaper pants, fabric softeners, liquid detergents, and machine wash powder.

SOCIAL HANDLES:
- Facebook: https://www.facebook.com/GentalCareKE
- Instagram: @gental_careke

PRODUCTS & PRICING:
- Diaper Pants: Sizes S, M, L, XL, XXL (up to Size 6 / XXL for 15-25 kg babies)
  Economy Pack ~KES 610 | Jumbo Pack ~KES 805
- Fabric softeners, liquid detergents, machine wash powder
- All available at: Quickmart, Eastmatt, Powerstar, Khetia, Mathai supermarkets
- Online: shop.bidcoafrica.com

KEY CONTACTS:
- Collaborations / PR / sponsorships: ccpr@bidcoafrica.com
- Sales / stock location: sales@bidcoafrica.com
- Bulk / wholesale: purchase@bidcoafrica.com
- Careers / internships: careers@bidcoafrica.com or hr@bidcoafrica.com
- Product quality / complaints: happy@bidcoafrica.com
- WhatsApp community: https://chat.whatsapp.com/H9jkMiJZ3i4D6ZT6epiFIw

BRAND TONE: Warm, approachable, caring. Short sentences. No corporate jargon.
Light emoji where natural. Sign off as "Team Gental Care" in DMs.

TRAINED RESPONSES:
1. STOCK / WHERE TO BUY -> "Hi! Gental Care products are available at Quickmart, Eastmatt, Powerstar, Khetia, and Mathai supermarkets. Also online at shop.bidcoafrica.com for doorstep delivery! Nearest store: sales@bidcoafrica.com"
2. PARTNERSHIP / INFLUENCER -> "Thank you for reaching out! Please send your proposal to ccpr@bidcoafrica.com and our team will review it."
3. PRICING -> "Hi! Current prices at shop.bidcoafrica.com. Economy Pack ~KES 610, Jumbo Pack ~KES 805. Bulk: sales@bidcoafrica.com"
4. ONLINE ORDER -> "Yes! Order at shop.bidcoafrica.com for doorstep delivery across Kenya."
5. JOB / INTERNSHIP -> "Thank you for your interest! Email your resume to careers@bidcoafrica.com or hr@bidcoafrica.com"
6. BULK / WHOLESALE -> "For bulk and wholesale, contact purchase@bidcoafrica.com"
7. PRODUCT INFO / SIZES -> "Gental Care Pants: S, M, L, XL, XXL (Size 6 for babies up to 25 kg). Full range at shop.bidcoafrica.com"
8. CONTEST -> "The contest is now closed and winners have been announced. Stay tuned for more giveaways!"
9. WHATSAPP COMMUNITY -> "Join here: https://chat.whatsapp.com/H9jkMiJZ3i4D6ZT6epiFIw"
10. POSITIVE / PRAISE -> Short warm acknowledgement, max 10 words.
11. GREETING -> "Hi! Thank you for reaching out to Gental Care. How can we help?"

ALWAYS ESCALATE (do NOT auto-reply):
- Product quality issues (tears, leak, defect, rash, waistband tearing)
- Child safety (hurt, injury, hospital)
- Strong negative emotion ("made me cry", "disgusting", "worst ever")
- Legal threats (sue, lawyer, report)
- Refund requests with strong emotion
- Missing prize or undelivered hamper

AUTO-MODERATE (hide, no reply):
- Betting, casino, aviator, data bundle spam
- Unrelated promotions, suspicious external URLs

Respond ONLY in this exact JSON (no markdown, no backticks):
{
  "intent": "<stock|partnership|pricing|online_order|job|bulk|product_info|contest|whatsapp|positive|greeting|quality_complaint|spam|unknown>",
  "sentiment": "<positive|neutral|negative>",
  "action": "<auto_reply|escalate|moderate|like>",
  "priority": "<high|medium|low>",
  "reply": "<reply text or null>",
  "escalation_reason": "<one sentence or null>",
  "escalation_tag": "<QUALITY|SAFETY|LEGAL|COMPLAINT|NEGATIVE|UNKNOWN or null>",
  "confidence": 0.0
}`;

// ─────────────────────────────────────────────────────────────────────
// CLAUDE CLASSIFIER
// ─────────────────────────────────────────────────────────────────────
async function classifyWithClaude(message, context = {}) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: BRAND_CONTEXT,
      messages: [{
        role: "user",
        content: `Platform: ${context.platform || "unknown"}\nType: ${context.type || "comment"}\nFrom: ${context.senderName || "unknown"}\nMessage: "${message}"\nClassify and respond.`
      }]
    })
  });

  if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
  const data = await resp.json();
  const text = data.content[0].text.replace(/```json|```/g, "").trim();
  return JSON.parse(text);
}

// ─────────────────────────────────────────────────────────────────────
// MANYCHAT API LAYER
// ─────────────────────────────────────────────────────────────────────
const MC_BASE = "https://api.manychat.com";

async function mcPost(path, body) {
  const resp = await fetch(`${MC_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.MANYCHAT_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (data.status !== "success") throw new Error(`ManyChat ${path}: ${JSON.stringify(data)}`);
  return data;
}

async function resolveSubscriber(psid, platform) {
  const field = platform === "Instagram" ? "ig_id" : "fb_psid";
  const resp = await fetch(
    `${MC_BASE}/fb/subscriber/findBySystemField?field_name=${field}&field_value=${psid}`,
    { headers: { "Authorization": `Bearer ${process.env.MANYCHAT_API_KEY}` } }
  );
  const data = await resp.json();
  if (data.status !== "success" || !data.data?.id) throw new Error(`Subscriber not found: ${psid}`);
  return data.data.id;
}

async function sendDM(subscriberId, text) {
  return mcPost("/fb/sending/sendContent", {
    subscriber_id: subscriberId,
    data: { version: "v2", content: { type: "instagram", messages: [{ type: "text", text }] } },
    message_tag: "ACCOUNT_UPDATE",
  });
}

async function replyToComment(commentId, text) {
  return mcPost("/fb/commenting/replyToComment", {
    comment_id: commentId, message: text, page_id: process.env.META_PAGE_ID,
  });
}

async function hideComment(commentId) {
  return mcPost("/fb/commenting/hideComment", {
    comment_id: commentId, page_id: process.env.META_PAGE_ID,
  });
}

async function tagSubscriber(subscriberId, tagName) {
  return mcPost("/fb/subscriber/addTag", { subscriber_id: subscriberId, tag_name: tagName }).catch(() => {});
}

async function triggerFlow(subscriberId, flowNs) {
  return mcPost("/fb/sending/sendFlow", { subscriber_id: subscriberId, flow_ns: flowNs });
}

// ─────────────────────────────────────────────────────────────────────
// DIRECT META FALLBACKS
// ─────────────────────────────────────────────────────────────────────
async function directMetaLike(commentId) {
  const resp = await fetch(`https://graph.facebook.com/v20.0/${commentId}/likes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token: process.env.META_PAGE_ACCESS_TOKEN })
  });
  return resp.json();
}

async function directMetaDM(recipientId, text) {
  const resp = await fetch("https://graph.facebook.com/v20.0/me/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: recipientId },
      message: { text },
      access_token: process.env.META_PAGE_ACCESS_TOKEN
    })
  });
  return resp.json();
}

// ─────────────────────────────────────────────────────────────────────
// ZOHO DESK
// ─────────────────────────────────────────────────────────────────────
async function createZohoTicket({ message, classification, context }) {
  if (!process.env.ZOHO_OAUTH_TOKEN) return null;
  const resp = await fetch("https://desk.zoho.com/api/v1/tickets", {
    method: "POST",
    headers: {
      "Authorization": `Zoho-oauthtoken ${process.env.ZOHO_OAUTH_TOKEN}`,
      "Content-Type": "application/json",
      "orgId": process.env.ZOHO_ORG_ID,
    },
    body: JSON.stringify({
      subject: `[${classification.priority.toUpperCase()}] ${classification.escalation_tag} - Gental Care - ${context.platform}`,
      description: `Platform: ${context.platform}\nType: ${context.type}\nSender: ${context.senderName || "unknown"}\nMessage: "${message}"\nIntent: ${classification.intent}\nSentiment: ${classification.sentiment}\nReason: ${classification.escalation_reason}`,
      departmentId: process.env.ZOHO_DEPARTMENT_ID,
      priority: classification.priority === "high" ? "High" : "Medium",
      channel: "Social",
    })
  });
  const data = await resp.json();
  if (data.errorCode) throw new Error(`Zoho: ${JSON.stringify(data)}`);
  return data;
}

// ─────────────────────────────────────────────────────────────────────
// CORE PROCESSOR
// ─────────────────────────────────────────────────────────────────────
async function processMessage({ message, context }) {
  log("info", "Incoming", { platform: context.platform, type: context.type, snippet: message.slice(0, 60) });

  let classification;
  try {
    classification = await classifyWithClaude(message, context);
    log("info", "Classified", { action: classification.action, intent: classification.intent, sentiment: classification.sentiment });
  } catch (err) {
    log("error", "Claude failed", { error: err.message });
    classification = {
      intent: "unknown", sentiment: "neutral", action: "escalate", priority: "medium",
      reply: null, escalation_reason: "Claude error — manual review needed.",
      escalation_tag: "UNKNOWN", confidence: 0
    };
  }

  const result = { classification, context, message, ts: new Date().toISOString() };

  try {
    switch (classification.action) {

      case "auto_reply": {
        if (!classification.reply) break;
        if (context.type === "dm" || context.type === "message") {
          try {
            const subId = await resolveSubscriber(context.senderId, context.platform);
            await sendDM(subId, classification.reply);
            await tagSubscriber(subId, `ORM_${classification.intent.toUpperCase()}`);
            log("info", "DM sent via ManyChat", { intent: classification.intent });
          } catch {
            log("warn", "ManyChat subscriber not found, falling back to direct Meta");
            await directMetaDM(context.senderId, classification.reply);
          }
        } else {
          await replyToComment(context.sourceId, classification.reply);
          log("info", "Comment reply via ManyChat", { commentId: context.sourceId, intent: classification.intent });
        }
        result.outcome = "replied";
        break;
      }

      case "like": {
        if (context.type !== "dm") {
          await directMetaLike(context.sourceId);
          log("info", "Comment liked", { commentId: context.sourceId });
        }
        result.outcome = "liked";
        break;
      }

      case "moderate": {
        if (context.type !== "dm") {
          await hideComment(context.sourceId);
          log("info", "Comment hidden via ManyChat", { commentId: context.sourceId });
        }
        result.outcome = "moderated";
        break;
      }

      case "escalate": {
        const ticket = await createZohoTicket({ message, classification, context });
        if (ticket) {
          result.zohoTicketId = ticket.id;
          log("info", "Zoho ticket created", { ticketId: ticket.id });
        }
        if ((context.type === "dm" || context.type === "message") && context.senderId) {
          const holdMsg = "Hi! Thank you for reaching out to Gental Care. We have received your message and our team is looking into this right now. We will get back to you shortly. Regards, Team Gental Care";
          try {
            const subId = await resolveSubscriber(context.senderId, context.platform);
            await sendDM(subId, holdMsg);
            await tagSubscriber(subId, `ORM_ESCALATED_${classification.escalation_tag}`);
            if (process.env.MANYCHAT_ESCALATION_FLOW_NS) await triggerFlow(subId, process.env.MANYCHAT_ESCALATION_FLOW_NS);
          } catch (err) {
            log("warn", "Could not send holding DM", { error: err.message });
          }
        }
        result.outcome = "escalated";

        // Save escalation to Supabase
        const saved = await saveMessage(message, context, classification, "escalated", { zohoTicketId: result.zohoTicketId });
        if (saved) await saveEscalation(message, context, classification, saved.id);
        await updateSentiment(classification.sentiment, context.brand || "Gental Care");
        return result;
      }
    }
  } catch (err) {
    log("error", "Action failed", { action: classification.action, error: err.message });
    result.outcome = "action_failed";
    result.error = err.message;
  }

  // Save all messages to Supabase
  await saveMessage(message, context, classification, result.outcome, { zohoTicketId: result.zohoTicketId });
  await updateSentiment(classification.sentiment, context.brand || "Gental Care");

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────
app.get("/webhook/meta", (req, res) => {
  const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    log("info", "Meta webhook verified");
    return res.send(challenge);
  }
  res.sendStatus(403);
});

app.post("/webhook/meta", async (req, res) => {
  res.sendStatus(200);
  const sig = req.headers["x-hub-signature-256"];
  if (sig && process.env.META_APP_SECRET) {
    const expected = "sha256=" + crypto.createHmac("sha256", process.env.META_APP_SECRET).update(req.rawBody).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      log("warn", "Meta signature mismatch");
      return;
    }
  }
  const body = req.body;
  if (body.object !== "page" && body.object !== "instagram") return;

  for (const entry of body.entry || []) {
    const pageId = entry.id;
    for (const msg of entry.messaging || []) {
      if (!msg.message || msg.message.is_echo || !msg.message.text) continue;
      await processMessage({ message: msg.message.text, context: { platform: "Facebook", type: "dm", senderId: msg.sender.id, senderName: null, sourceId: msg.message.mid, pageId } });
    }
    for (const change of entry.changes || []) {
      const v = change.value;
      if (!v) continue;
      if (change.field === "feed" && v.item === "comment" && v.verb === "add") {
        if (v.from?.id === pageId || !v.message) continue;
        await processMessage({ message: v.message, context: { platform: "Facebook", type: v.post_id?.includes("_") ? "ad_comment" : "comment", senderId: v.from?.id, senderName: v.from?.name, sourceId: v.comment_id, postId: v.post_id, pageId } });
      }
      if (change.field === "comments") {
        if (!v.text || v.from?.id === pageId) continue;
        await processMessage({ message: v.text, context: { platform: "Instagram", type: "comment", senderId: v.from?.id, senderName: v.from?.username, sourceId: v.id, mediaId: v.media?.id, pageId } });
      }
      if (change.field === "messages") {
        const m = v.message;
        if (!m || m.is_echo || !m.text) continue;
        await processMessage({ message: m.text, context: { platform: "Instagram", type: "dm", senderId: v.sender?.id, senderName: null, sourceId: m.mid, pageId } });
      }
      if (change.field === "mention") {
        const text = v.comment_text || v.post?.message;
        if (!text) continue;
        await processMessage({ message: text, context: { platform: "Facebook", type: "mention", senderId: v.sender_id, senderName: null, sourceId: v.comment_id || v.post_id, pageId } });
      }
    }
  }
});

app.all("/webhook/manychat", async (req, res) => {
  res.sendStatus(200);
  const message = req.body?.message || req.query?.message;
  const subscriber_id = req.body?.subscriber_id || req.query?.subscriber_id;
  const platform = req.body?.platform || req.query?.platform || "Facebook";
  const type = req.body?.type || req.query?.type || "dm";
  log("info", "ManyChat webhook received", { subscriber_id, message_snippet: message?.slice(0,30), platform, type });
  if (!message || !subscriber_id) { log("warn", "Missing message or subscriber_id", { subscriber_id, has_message: !!message }); return; }
  await processMessage({ message, context: { platform, type, senderId: subscriber_id, sourceId: subscriber_id } });
});

app.post("/webhook/tiktok", async (req, res) => {
  res.sendStatus(200);
  if (req.body.challenge) return res.json({ challenge: req.body.challenge });
  for (const event of req.body.events || []) {
    if (event.event_type !== "comment.create") continue;
    const text = event.content?.text;
    const commentId = event.content?.comment_id;
    if (!text || !commentId) continue;
    const result = await processMessage({ message: text, context: { platform: "TikTok", type: "comment", senderId: event.user?.open_id, senderName: event.user?.nickname, sourceId: commentId, videoId: event.content?.video_id } });
    if (result.classification?.action === "auto_reply" && result.classification?.reply) {
      fetch("https://open.tiktokapis.com/v2/comment/reply/create/", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.TIKTOK_ACCESS_TOKEN}` },
        body: JSON.stringify({ video_id: event.content?.video_id, comment_id: commentId, text: result.classification.reply })
      }).catch(err => log("error", "TikTok reply failed", { error: err.message }));
    }
  }
});

// ── Stats API for dashboard ──────────────────────────────────────────
app.get("/api/stats", async (req, res) => {
  if (!supabase) return res.json({ error: "Supabase not configured" });
  try {
    const { count: total } = await supabase.from("messages").select("*", { count: "exact", head: true });
    const { count: replied } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("action_taken", "replied");
    const { count: escalated } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("action_taken", "escalated");
    const { count: moderated } = await supabase.from("messages").select("*", { count: "exact", head: true }).eq("action_taken", "moderated");
    const { data: recent } = await supabase.from("messages").select("*").order("created_at", { ascending: false }).limit(20);
    const { data: openEsc } = await supabase.from("escalations").select("*").eq("status", "open").order("created_at", { ascending: false });
    const { data: sentiment } = await supabase.from("sentiment_daily").select("*").order("date", { ascending: false }).limit(30);
    res.json({ total, replied, escalated, moderated, recent, escalations: openEsc, sentiment });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// ── Resolve escalation ───────────────────────────────────────────────
app.post("/api/escalations/:id/resolve", async (req, res) => {
  if (!supabase) return res.json({ error: "Supabase not configured" });
  const { id } = req.params;
  await supabase.from("escalations").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", id);
  res.json({ success: true });
});

// ── Health ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "Gental Care ORM Engine",
    reply_layer: "ManyChat (BSP)",
    ts: new Date().toISOString(),
    config: {
      claude:    !!process.env.ANTHROPIC_API_KEY,
      manychat:  !!process.env.MANYCHAT_API_KEY,
      meta:      !!process.env.META_PAGE_ACCESS_TOKEN,
      zoho:      !!process.env.ZOHO_OAUTH_TOKEN,
      tiktok:    !!process.env.TIKTOK_ACCESS_TOKEN,
      supabase:  !!process.env.SUPABASE_URL,
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log("info", "Gental Care ORM Engine running", { port: PORT, replyLayer: "ManyChat", storage: supabase ? "Supabase" : "none" }));
