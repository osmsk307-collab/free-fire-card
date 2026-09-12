const TelegramBot = require("node-telegram-bot-api");
const fs = require("fs");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  console.error("BOT_TOKEN or ADMIN_CHAT_ID missing");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

const file = "payments.json";

if (!fs.existsSync(file)) {
  fs.writeFileSync(file, JSON.stringify({}, null, 2));
}

function loadPayments() {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function savePayments(data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const payload = match && match[1] ? match[1] : "";

  if (!payload.startsWith("card_")) {
    return bot.sendMessage(
      chatId,
      "👋 Welcome to SUNNY 999 BOT\n\nPlease open the verification link from the Card Activation website."
    );
  }

  const parts = payload.split("_");

  if (parts.length !== 4) {
    return bot.sendMessage(chatId, "❌ Invalid verification request.");
  }

  const plan = parts[1];
  const code = parts[2];
  const utr = parts[3];

  if (!/^\d{10}$/.test(code)) {
    return bot.sendMessage(chatId, "❌ Invalid 10-digit activation code.");
  }

  if (!/^\d{12}$/.test(utr)) {
    return bot.sendMessage(chatId, "❌ Invalid 12-digit UTR.");
  }

  const amount = plan === "diamond" ? 1999 : 999;

  const payments = loadPayments();
  const paymentId = Date.now().toString();

  payments[paymentId] = {
    paymentId,
    telegramUserId: chatId,
    username: msg.from.username || "",
    plan,
    amount,
    code,
    utr,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  savePayments(payments);

  await bot.sendMessage(
    chatId,
    `✅ Verification request received.\n\n` +
    `Card: ${plan === "diamond" ? "DIAMOND CARD" : "FREE FIRE GOLD CARD"}\n` +
    `Amount: ₹${amount}\n` +
    `UTR: ${utr}\n\n` +
    `⏳ Your payment is waiting for manual verification.`
  );

  await bot.sendMessage(
    ADMIN_CHAT_ID,
    `💳 NEW CARD PAYMENT\n\n` +
    `Card: ${plan === "diamond" ? "DIAMOND CARD" : "FREE FIRE GOLD CARD"}\n` +
    `Amount: ₹${amount}\n` +
    `Code: ${code}\n` +
    `UTR: ${utr}\n` +
    `User ID: ${chatId}\n` +
    `Username: @${msg.from.username || "N/A"}\n\n` +
    `Payment ID: ${paymentId}`,
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "✅ APPROVE",
              callback_data: `approve_${paymentId}`
            },
            {
              text: "❌ REJECT",
              callback_data: `reject_${paymentId}`
            }
          ]
        ]
      }
    }
  );
});

bot.on("callback_query", async (query) => {
  if (String(query.from.id) !== String(ADMIN_CHAT_ID)) {
    return bot.answerCallbackQuery(query.id, {
      text: "Not authorized."
    });
  }

  const data = query.data;
  const payments = loadPayments();

  if (data.startsWith("approve_")) {
    const id = data.replace("approve_", "");
    const payment = payments[id];

    if (!payment) {
      return bot.answerCallbackQuery(query.id, {
        text: "Payment not found."
      });
    }

    payment.status = "approved";
    payment.approvedAt = new Date().toISOString();
    savePayments(payments);

    await bot.sendMessage(
      payment.telegramUserId,
      `✅ PAYMENT APPROVED\n\n` +
      `Your payment has been manually verified.\n\n` +
      `You can now continue to the next activation step.`
    );

    await bot.answerCallbackQuery(query.id, {
      text: "Payment approved."
    });

    await bot.editMessageText(
      `✅ APPROVED\n\nPayment ID: ${id}\nCard: ${payment.plan}\nAmount: ₹${payment.amount}\nUTR: ${payment.utr}`,
      {
        chat_id: ADMIN_CHAT_ID,
        message_id: query.message.message_id
      }
    );
  }

  if (data.startsWith("reject_")) {
    const id = data.replace("reject_", "");
    const payment = payments[id];

    if (!payment) {
      return bot.answerCallbackQuery(query.id, {
        text: "Payment not found."
      });
    }

    payment.status = "rejected";
    payment.rejectedAt = new Date().toISOString();
    savePayments(payments);

    await bot.sendMessage(
      payment.telegramUserId,
      `❌ PAYMENT REJECTED\n\n` +
      `Your payment could not be approved. Please contact the administrator.`
    );

    await bot.answerCallbackQuery(query.id, {
      text: "Payment rejected."
    });

    await bot.editMessageText(
      `❌ REJECTED\n\nPayment ID: ${id}\nCard: ${payment.plan}\nAmount: ₹${payment.amount}\nUTR: ${payment.utr}`,
      {
        chat_id: ADMIN_CHAT_ID,
        message_id: query.message.message_id
      }
    );
  }
});

console.log("Free Fire Card Payment Bot is running...");
