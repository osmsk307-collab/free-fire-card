const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const fs = require("fs");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  console.error("BOT_TOKEN or ADMIN_CHAT_ID missing");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const DATA_FILE = "payments.json";
const WEBSITE = "https://osmsk307-collab.github.io/free-fire-card/";

let payments = [];

if (fs.existsSync(DATA_FILE)) {
  try {
    payments = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    payments = [];
  }
}

function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(payments, null, 2));
}

function generateCode() {
  let code;

  do {
    code = Math.floor(1000000000 + Math.random() * 9000000000).toString();
  } while (payments.some(p => p.activationCode === code));

  return code;
}

function amountFor(plan) {
  return plan === "diamond" ? 1999 : 999;
}

function planName(plan) {
  return plan === "diamond"
    ? "DIAMOND CARD ACTIVATE"
    : "FREE FIRE GOLD CARD ACTIVATE";
}

bot.onText(/^\/start(?:\s+(.+))?$/, async (msg, match) => {
  const chatId = msg.chat.id;
  const payload = match && match[1] ? match[1] : "";

  if (!payload) {
    return bot.sendMessage(
      chatId,
      "💳 CARD PAYMENT\n\nWebsite se payment verification start karo."
    );
  }

  const parts = payload.split("_");

  if (parts.length !== 4 || parts[0] !== "card") {
    return bot.sendMessage(chatId, "❌ Invalid payment request.");
  }

  const plan = parts[1];
  const code = parts[2];
  const utr = parts[3];

  if (!["diamond", "gold"].includes(plan)) {
    return bot.sendMessage(chatId, "❌ Invalid card.");
  }

  if (!/^\d{10}$/.test(code)) {
    return bot.sendMessage(chatId, "❌ Activation code must be 10 digits.");
  }

  if (!/^\d{12}$/.test(utr)) {
    return bot.sendMessage(chatId, "❌ UTR must be 12 digits.");
  }

  const amount = amountFor(plan);

  const payment = {
    id: Date.now().toString(),
    userId: chatId,
    username: msg.from.username || "",
    firstName: msg.from.first_name || "",
    plan,
    planName: planName(plan),
    amount,
    activationCode: code,
    utr,
    status: "PENDING",
    createdAt: new Date().toISOString()
  };

  payments.push(payment);
  saveData();

  await bot.sendMessage(
    chatId,
    `⏳ PAYMENT RECEIVED\n\n` +
    `Card: ${payment.planName}\n` +
    `Amount: ₹${amount}\n` +
    `UTR: ${utr}\n\n` +
    `Your payment is waiting for admin approval.`
  );

  await bot.sendMessage(
    ADMIN_CHAT_ID,
    `💰 NEW PAYMENT\n\n` +
    `👤 User: ${payment.firstName}\n` +
    `🆔 Chat ID: ${chatId}\n` +
    `📦 Card: ${payment.planName}\n` +
    `💵 Amount: ₹${amount}\n` +
    `🔢 UTR: ${utr}\n` +
    `🔑 Entered Code: ${code}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ APPROVE",
              callback_data: `approve_${payment.id}`
            },
            {
              text: "❌ REJECT",
              callback_data: `reject_${payment.id}`
            }
          ]
        ]
      }
    }
  );
});

bot.on("callback_query", async (query) => {
  const data = query.data || "";
  const adminId = String(query.from.id);

  if (adminId !== String(ADMIN_CHAT_ID)) {
    return bot.answerCallbackQuery(query.id, {
      text: "Not authorized"
    });
  }

  const [action, paymentId] = data.split("_");

  const payment = payments.find(p => p.id === paymentId);

  if (!payment) {
    return bot.answerCallbackQuery(query.id, {
      text: "Payment not found"
    });
  }

  if (payment.status !== "PENDING") {
    return bot.answerCallbackQuery(query.id, {
      text: "Already processed"
    });
  }

  if (action === "approve") {
    payment.status = "APPROVED";

    const activationCode = generateCode();
    payment.activationCode = activationCode;

    saveData();

    await bot.sendMessage(
      payment.userId,
      `✅ PAYMENT APPROVED\n\n` +
      `📦 ${payment.planName}\n` +
      `💵 ₹${payment.amount}\n\n` +
      `🔑 YOUR ACTIVATION CODE\n` +
      `${activationCode}\n\n` +
      `🌐 Open Website:\n${WEBSITE}\n\n` +
      `⚠️ Save this code safely.`
    );

    await bot.editMessageText(
      `✅ PAYMENT APPROVED\n\n` +
      `User: ${payment.firstName}\n` +
      `Card: ${payment.planName}\n` +
      `Amount: ₹${payment.amount}\n` +
      `UTR: ${payment.utr}\n` +
      `Activation Code: ${activationCode}`,
      {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      }
    );

    return bot.answerCallbackQuery(query.id, {
      text: "Payment approved"
    });
  }

  if (action === "reject") {
    payment.status = "REJECTED";
    saveData();

    await bot.sendMessage(
      payment.userId,
      `❌ PAYMENT REJECTED\n\n` +
      `Your payment could not be approved.\n` +
      `Please contact support if you believe this is an error.`
    );

    await bot.editMessageText(
      `❌ PAYMENT REJECTED\n\n` +
      `User: ${payment.firstName}\n` +
      `Card: ${payment.planName}\n` +
      `Amount: ₹${payment.amount}\n` +
      `UTR: ${payment.utr}`,
      {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      }
    );

    return bot.answerCallbackQuery(query.id, {
      text: "Payment rejected"
    });
  }
});

bot.on("polling_error", (error) => {
  console.error("Telegram polling error:", error.message);
});

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Free Fire Card Payment Bot is running.");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

console.log("Free Fire Card Payment Bot started.");
