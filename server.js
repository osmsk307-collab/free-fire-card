const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing");
  process.exit(1);
}

if (!ADMIN_CHAT_ID) {
  console.error("ADMIN_CHAT_ID missing");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true
});

const PORT = process.env.PORT || 10000;

const DATA_FILE = path.join(__dirname, "payments.json");

function loadPayments() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function savePayments(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getPlan(plan) {
  if (plan === "diamond") {
    return {
      name: "DIAMOND CARD ACTIVATE",
      amount: 1999
    };
  }

  if (plan === "gold") {
    return {
      name: "FREE FIRE GOLD CARD ACTIVATE",
      amount: 999
    };
  }

  return null;
}

// Telegram /start
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const payload = match && match[1] ? match[1].trim() : "";
  const chatId = msg.chat.id;

  if (!payload) {
    return bot.sendMessage(
      chatId,
      "👋 Welcome to Free Fire Card Payment Verification Bot.\n\nWebsite se payment verification link open karo."
    );
  }

  // Expected:
  // card_diamond_1234567890_123456789012
  // card_gold_1234567890_123456789012

  const parts = payload.split("_");

  if (parts.length !== 4 || parts[0] !== "card") {
    return bot.sendMessage(
      chatId,
      "❌ Invalid verification request."
    );
  }

  const planKey = parts[1];
  const code = parts[2];
  const utr = parts[3];

  const plan = getPlan(planKey);

  if (!plan) {
    return bot.sendMessage(chatId, "❌ Invalid card selected.");
  }

  if (!/^\d{10}$/.test(code)) {
    return bot.sendMessage(
      chatId,
      "❌ Activation code must contain exactly 10 digits."
    );
  }

  if (!/^\d{12}$/.test(utr)) {
    return bot.sendMessage(
      chatId,
      "❌ UTR must contain exactly 12 digits."
    );
  }

  const payments = loadPayments();

  const alreadySubmitted = payments.find(
    p => p.utr === utr && p.status !== "rejected"
  );

  if (alreadySubmitted) {
    return bot.sendMessage(
      chatId,
      "⚠️ This UTR has already been submitted."
    );
  }

  const payment = {
    id: Date.now().toString(),
    userId: chatId,
    username: msg.from.username || "",
    name: msg.from.first_name || "",
    plan: planKey,
    planName: plan.name,
    amount: plan.amount,
    code: code,
    utr: utr,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  payments.push(payment);
  savePayments(payments);

  await bot.sendMessage(
    chatId,
    `🧾 PAYMENT SUBMITTED\n\n` +
    `Card: ${plan.name}\n` +
    `Amount: ₹${plan.amount}\n` +
    `Activation Code: ${code}\n` +
    `UTR: ${utr}\n\n` +
    `⏳ Your payment is waiting for admin verification.`
  );

  const adminText =
    `🔔 NEW CARD PAYMENT\n\n` +
    `Card: ${plan.name}\n` +
    `Amount: ₹${plan.amount}\n` +
    `Activation Code: ${code}\n` +
    `UTR: ${utr}\n` +
    `User ID: ${chatId}\n` +
    `Username: @${msg.from.username || "N/A"}`;

  await bot.sendMessage(ADMIN_CHAT_ID, adminText, {
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
  });
});

// Admin approve/reject
bot.on("callback_query", async (query) => {
  const data = query.data || "";
  const adminId = String(query.from.id);

  if (adminId !== String(ADMIN_CHAT_ID)) {
    return bot.answerCallbackQuery(query.id, {
      text: "Not authorized",
      show_alert: true
    });
  }

  const [action, paymentId] = data.split("_");

  const payments = loadPayments();
  const payment = payments.find(p => p.id === paymentId);

  if (!payment) {
    return bot.answerCallbackQuery(query.id, {
      text: "Payment not found",
      show_alert: true
    });
  }

  if (payment.status !== "pending") {
    return bot.answerCallbackQuery(query.id, {
      text: "Already processed",
      show_alert: true
    });
  }

  if (action === "approve") {
    payment.status = "approved";
    payment.approvedAt = new Date().toISOString();

    savePayments(payments);

    await bot.sendMessage(
      payment.userId,
      `✅ PAYMENT APPROVED\n\n` +
      `${payment.planName}\n` +
      `Amount: ₹${payment.amount}\n\n` +
      `Your payment has been verified successfully.\n\n` +
      `You can now continue with the activation process.`
    );

    await bot.answerCallbackQuery(query.id, {
      text: "Payment approved"
    });

    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      }
    );
  }

  if (action === "reject") {
    payment.status = "rejected";
    payment.rejectedAt = new Date().toISOString();

    savePayments(payments);

    await bot.sendMessage(
      payment.userId,
      `❌ PAYMENT REJECTED\n\n` +
      `Your payment could not be verified.\n` +
      `Please check the payment details and contact support if needed.`
    );

    await bot.answerCallbackQuery(query.id, {
      text: "Payment rejected"
    });

    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      }
    );
  }
});

// Render health/port server
const server = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  if (req.url === "/health") {
    res.end("OK");
  } else {
    res.end("Free Fire Card Payment Bot is running.");
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`HTTP server running on port ${PORT}`);
  console.log("Telegram bot started.");
});
