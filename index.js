const express = require("express");
const axios = require("axios");
const app = express();
app.use(express.json());

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
  GEMINI_API_KEY: "AQ.Ab8RN6JLO_ZAiAkrN0mPVHriAlxT2Opewwqz4KGVwbhQkZ8bKA",
  WHATSAPP_TOKEN: "EAAS1dn3d5ZAIBRxZC8g76uXLrSkxXSrZCXYuiPYIh5nwrKnevZAfCSZBbJu4ZBEGmaPF56JjLKd9cIV3i6wkZCenVR0q99FJOlEovJf7E0g4rTWlX97QLwdmLk9FmYVkcjZAMp7cLfRaFtpmw1T3w7NAtWtnFhJHiq8KBIsDPR5FIiIn81YsBwNo4uw2EZB3MZBUFyeHrYzlBQQ7myjOUt4rlX8Ju3tr9P5gg17B0aFGACqiGc0rUDsS41V05tZCbdJ3lNq9ev1Hgm0aM1Ioe1MgooVKJ8wcpHbUP7dLDUrlgZDZD",
  PHONE_NUMBER_ID: "1204187056108892",
  VERIFY_TOKEN: "1a2e14329da5fe321bc2621f36a43d8a",
  MAX_HISTORY: 20,
};

const SYSTEM_PROMPT = `তুমি Booeb.com এর কাস্টমার সার্ভিস সহকারী। তোমার নাম "বুয়েব সহকারী"।

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

// Memory - প্রতিটি কাস্টমারের conversation মনে রাখবে
const chatHistory = {};

// ============================================================
// Webhook Verification
// ============================================================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === CONFIG.VERIFY_TOKEN) {
    console.log("Webhook verified!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// ============================================================
// Incoming Messages
// ============================================================
app.post("/webhook", async (req, res) => {
  try {
    const messages = req.body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!messages || messages.length === 0) return res.sendStatus(200);

    const message = messages[0];
    const from = message.from;

    if (message.type !== "text") {
      await sendWhatsAppMessage(from, "দুঃখিত, আমি শুধু টেক্সট মেসেজ বুঝতে পারি। অনুগ্রহ করে লিখে জানান।");
      return res.sendStatus(200);
    }

    const userMessage = message.text.body;
    console.log(`Message from ${from}: ${userMessage}`);

    // History লোড করো
    if (!chatHistory[from]) chatHistory[from] = [];
    const history = chatHistory[from];

    // Gemini থেকে উত্তর নাও
    const aiReply = await getGeminiReply(userMessage, history);

    // History আপডেট করো
    history.push({ role: "user", parts: [{ text: userMessage }] });
    history.push({ role: "model", parts: [{ text: aiReply }] });

    // সর্বোচ্চ MAX_HISTORY রাখো
    if (history.length > CONFIG.MAX_HISTORY) {
      chatHistory[from] = history.slice(-CONFIG.MAX_HISTORY);
    }

    // WhatsApp এ reply পাঠাও
    await sendWhatsAppMessage(from, aiReply);
    res.sendStatus(200);
  } catch (error) {
    console.error("Error:", error);
    res.sendStatus(500);
  }
});

// ============================================================
// Gemini AI
// ============================================================
async function getGeminiReply(userMessage, history) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
    const contents = [...history, { role: "user", parts: [{ text: userMessage }] }];

    const response = await axios.post(url, {
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 500 },
    });

    return response.data?.candidates?.[0]?.content?.parts?.[0]?.text
      || "দুঃখিত, এই মুহূর্তে উত্তর দিতে পারছি না।";
  } catch (error) {
    console.error("Gemini Error:", error.message);
    return "দুঃখিত, একটি সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।";
  }
}

// ============================================================
// WhatsApp Message পাঠানো
// ============================================================
async function sendWhatsAppMessage(to, message) {
  await axios.post(
    `https://graph.facebook.com/v19.0/${CONFIG.PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: message },
    },
    {
      headers: {
        Authorization: `Bearer ${CONFIG.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ============================================================
// Server Start
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Booeb WhatsApp Bot running on port ${PORT}`);
});

