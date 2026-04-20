/**
 * test-local.js
 * Run before deploying to confirm Claude classification is working correctly.
 * Usage: node test-local.js
 */
require("dotenv").config({ path: "../.env" });
const fetch = require("node-fetch");

const TEST_CASES = [
  { msg: "Where can I buy Gental Care diapers in Ruiru?", expect: "auto_reply" },
  { msg: "How much is the 62pcs midi pants?", expect: "auto_reply" },
  { msg: "I would love to collaborate with Gental Care as an influencer", expect: "auto_reply" },
  { msg: "Are there any job openings at Bidco Africa?", expect: "auto_reply" },
  { msg: "The waistband on the diaper keeps tearing when I put it on", expect: "escalate" },
  { msg: "This diaper made my baby cry and now there is a rash", expect: "escalate" },
  { msg: "Ukiwa na hii form huwezi kosa 600shs daily gamepawa link", expect: "moderate" },
  { msg: "The best diaper in the market 💯", expect: "like" },
  { msg: "Inapatikana wapi? Sijapata Naivas", expect: "auto_reply" },
  { msg: "Can I buy online and get delivery in Mombasa?", expect: "auto_reply" },
];

const BRAND_CONTEXT = require("./server/index.js");

async function runTest(tc, i) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 400,
      system: `You are the AI backend for Gental Care ORM. Respond ONLY in JSON:
{"intent":"<stock|partnership|pricing|online_order|job|bulk|product_info|contest|whatsapp|positive|greeting|quality_complaint|spam|unknown>","sentiment":"<positive|neutral|negative>","action":"<auto_reply|escalate|moderate|like>","priority":"<high|medium|low>","reply":"<text or null>","escalation_reason":"<text or null>","escalation_tag":"<tag or null>","confidence":<0.0-1.0>}`,
      messages: [{ role: "user", content: `Message: "${tc.msg}"\nClassify and respond.` }],
    }),
  });

  const data = await resp.json();
  const text = data.content[0].text.replace(/```json|```/g, "").trim();
  const result = JSON.parse(text);
  const pass = result.action === tc.expect;

  console.log(`${pass ? "✅" : "❌"} Test ${i + 1}: ${pass ? "PASS" : "FAIL"}`);
  console.log(`   Message:  "${tc.msg.slice(0, 60)}"`);
  console.log(`   Expected: ${tc.expect} | Got: ${result.action} (${result.intent}, ${result.sentiment})`);
  if (result.reply) console.log(`   Reply:    "${result.reply.slice(0, 80)}"`);
  console.log("");
}

async function main() {
  console.log("Gental Care ORM Engine — Local Classification Tests\n");
  for (let i = 0; i < TEST_CASES.length; i++) {
    await runTest(TEST_CASES[i], i);
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log("Done.");
}

main().catch(console.error);
