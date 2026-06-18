// ============================================================
// Booeb.com WhatsApp AI Bot - Cloudflare Worker
// ============================================================

// ✅ তোমার API Keys এখানে আছে
const CONFIG = {
  GEMINI_API_KEY: "AQ.Ab8RN6JLO_ZAiAkrN0mPVHriAlxT2Opewwqz4KGVwbhQkZ8bKA",
  WHATSAPP_TOKEN: "EAAS1dn3d5ZAIBRxZC8g76uXLrSkxXSrZCXYuiPYIh5nwrKnevZAfCSZBbJu4ZBEGmaPF56JjLKd9cIV3i6wkZCenVR0q99FJOlEovJf7E0g4rTWlX97QLwdmLk9FmYVkcjZAMp7cLfRaFtpmw1T3w7NAtWtnFhJHiq8KBIsDPR5FIiIn81YsBwNo4uw2EZB3MZBUFyeHrYzlBQQ7myjOUt4rlX8Ju3tr9P5gg17B0aFGACqiGc0rUDsS41V05tZCbdJ3lNq9ev1Hgm0aM1Ioe1MgooVKJ8wcpHbUP7dLDUrlgZDZD",
  PHONE_NUMBER_ID: "1204187056108892",
  VERIFY_TOKEN: "1a2e14329da5fe321bc2621f36a43d8a",

  // Bot এর ব্যক্তিত্ব
  BOT_NAME: "বুয়েব সহকারী",
  BUSINESS_NAME: "Booeb.com",

  // Memory settings
  MAX_HISTORY: 20, // কতটি মেসেজ মনে রাখবে
  MEMORY_TTL: 2592000, // ৩০ দিন (seconds)
};

// ============================================================
// System Prompt - Bot কীভাবে কথা বলবে
// ============================================================
const SYSTEM_PROMPT = `তুমি Booeb.com এর কাস্টমার সার্ভিস সহকারী। তোমার নাম "${CONFIG.BOT_NAME}"।

Booeb.com হলো একটি বাংলাদেশি বই অর্ডার সার্ভিস যেটি Rokomari থেকে বই সংগ্রহ করে কাস্টমারদের কাছে পৌঁছে দেয়।

তোমার কাজ:
- কাস্টমারের প্রশ্নের সদয় ও সহায়ক উত্তর দেওয়া
- বই অর্ডার, ডেলিভারি, মূল্য সম্পর্কিত প্রশ্নের উত্তর দেওয়া
- কাস্টমারকে অর্ডার করতে সাহায্য করা
- সমস্যা সমাধানে সাহায্য করা

নিয়ম:
- সবসময় বাংলায় কথা বলবে
- ভদ্র ও বন্ধুত্বপূর্ণ থাকবে
- সংক্ষিপ্ত ও স্পষ্ট উত্তর দেবে
- কাস্টমারের আগের কথোপকথন মনে রেখে প্রাসঙ্গিক উত্তর দেবে
- যদি কোনো প্রশ্নের উত্তর না জানো, সৎভাবে বলবে এবং মালিকের সাথে যোগাযোগ করতে বলবে`;

// ============================================================
// Main Handler
// ============================================================
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Webhook Verification (GET)
    if (request.method === "GET") {
      return handleVerification(url);
    }

    // Incoming Messages (POST)
    if (request.method === "POST") {
      return handleMessage(request, env);
    }

    return new Response("Method not allowed", { status: 405 });
  },
};

// ============================================================
// WhatsApp Webhook Verification
// ============================================================
function handleVerification(url) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === CONFIG.VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

// ============================================================
// Handle Incoming WhatsApp Message
// ============================================================
async function handleMessage(request, env) {
  try {
    const body = await request.json();

    // Message extract করা
    const entry = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return new Response("OK", { status: 200 });
    }

    const message = messages[0];
    const from = message.from; // কাস্টমারের নম্বর
    const messageType = message.type;

    // শুধু text message handle করব
    if (messageType !== "text") {
      await sendWhatsAppMessage(
        from,
        "দুঃখিত, আমি শুধু টেক্সট মেসেজ বুঝতে পারি। অনুগ্রহ করে লিখে জানান।"
      );
      return new Response("OK", { status: 200 });
    }

    const userMessage = message.text.body;

    // কাস্টমারের conversation history লোড করা
    const history = await loadHistory(env, from);

    // Gemini AI থেকে উত্তর নেওয়া
    const aiReply = await getGeminiReply(userMessage, history);

    // History আপডেট করা
    history.push({ role: "user", parts: [{ text: userMessage }] });
    history.push({ role: "model", parts: [{ text: aiReply }] });

    // সর্বোচ্চ MAX_HISTORY টি মেসেজ রাখা
    const trimmedHistory = history.slice(-CONFIG.MAX_HISTORY);
    await saveHistory(env, from, trimmedHistory);

    // WhatsApp এ reply পাঠানো
    await sendWhatsAppMessage(from, aiReply);

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("Error:", error);
    return new Response("Error", { status: 500 });
  }
}

// ============================================================
// Gemini AI - উত্তর তৈরি করা
// ============================================================
async function getGeminiReply(userMessage, history) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

    // Conversation history তৈরি
    const contents = [
      ...history,
      { role: "user", parts: [{ text: userMessage }] },
    ];

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        },
      }),
    });

    const data = await response.json();

    if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text;
    }

    return "দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না। একটু পরে আবার চেষ্টা করুন।";
  } catch (error) {
    console.error("Gemini Error:", error);
    return "দুঃখিত, একটি সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।";
  }
}

// ============================================================
// WhatsApp Message পাঠানো
// ============================================================
async function sendWhatsAppMessage(to, message) {
  const url = `https://graph.facebook.com/v19.0/${CONFIG.PHONE_NUMBER_ID}/messages`;

  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: message },
    }),
  });
}

// ============================================================
// Conversation History - KV Storage থেকে লোড করা
// ============================================================
async function loadHistory(env, phone) {
  try {
    const key = `chat_${phone}`;
    const data = await env.CHAT_HISTORY.get(key);
    if (data) {
      return JSON.parse(data);
    }
    return [];
  } catch {
    return [];
  }
}

// ============================================================
// Conversation History - KV Storage তে সেভ করা
// ============================================================
async function saveHistory(env, phone, history) {
  try {
    const key = `chat_${phone}`;
    await env.CHAT_HISTORY.put(key, JSON.stringify(history), {
      expirationTtl: CONFIG.MEMORY_TTL,
    });
  } catch (error) {
    console.error("KV Save Error:", error);
  }
}
