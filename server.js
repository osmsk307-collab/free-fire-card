const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const fs = require("fs");

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
  console.error("BOT_TOKEN or ADMIN_CHAT_ID missing");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: true
});

const DATA_FILE = "payments.json";
const WEBSITE =
  "https://osmsk307-collab.github.io/free-fire-card/";

const PLANS = {
  diamond: {
    name: "DIAMOND CC ACTIVATION",
    amount: 999
  },

  gold: {
    name: "FREE FIRE GOLD CC ACTIVATION",
    amount: 499
  }
};

let payments = [];


// ==========================================
// LOAD DATA
// ==========================================

if (fs.existsSync(DATA_FILE)) {
  try {
    payments = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );
  } catch {
    payments = [];
  }
}


// ==========================================
// SAVE DATA
// ==========================================

function saveData() {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(payments, null, 2)
  );
}


// ==========================================
// UNIQUE ACTIVATION CODE
// ==========================================

function generateCode() {

  let code;

  do {

    code = Math.floor(
      1000000000 +
      Math.random() * 9000000000
    ).toString();

  } while (
    payments.some(
      p => p.activationCode === code
    )
  );

  return code;
}


// ==========================================
// START
// ==========================================

bot.onText(
  /^\/start(?:\s+(.+))?$/,
  async (msg, match) => {

    try {

      const chatId = msg.chat.id;

      const payload =
        match && match[1]
          ? match[1]
          : "";


      // --------------------------------------
      // NO PAYLOAD
      // --------------------------------------

      if (!payload) {

        return bot.sendMessage(
          chatId,

          `💳 CC ACTIVATION\n\n` +
          `Please open the activation website first.\n\n` +
          `${WEBSITE}`
        );

      }


      // --------------------------------------
      // PAYLOAD
      // card_diamond_activation_UTR
      // card_gold_activation_UTR
      // --------------------------------------

      const parts =
        payload.split("_");


      if (
        parts.length !== 4 ||
        parts[0] !== "card" ||
        parts[2] !== "activation"
      ) {

        return bot.sendMessage(
          chatId,
          "❌ Invalid payment request."
        );

      }


      const plan =
        parts[1];

      const utr =
        parts[3];


      // --------------------------------------
      // PLAN
      // --------------------------------------

      if (!PLANS[plan]) {

        return bot.sendMessage(
          chatId,
          "❌ Invalid card selected."
        );

      }


      // --------------------------------------
      // UTR
      // --------------------------------------

      if (!/^\d{12}$/.test(utr)) {

        return bot.sendMessage(
          chatId,
          "❌ UTR must be exactly 12 digits."
        );

      }


      // --------------------------------------
      // DUPLICATE UTR
      // --------------------------------------

      const duplicate =
        payments.find(
          p =>
            p.utr === utr &&
            p.status !== "REJECTED"
        );


      if (duplicate) {

        return bot.sendMessage(
          chatId,

          `⚠️ This UTR has already been submitted.\n\n` +
          `Please use the UTR from your new activation payment.`
        );

      }


      const planData =
        PLANS[plan];


      // --------------------------------------
      // CREATE PAYMENT
      // --------------------------------------

      const payment = {

        id:
          Date.now().toString(),

        userId:
          chatId,

        username:
          msg.from.username || "",

        firstName:
          msg.from.first_name || "",

        plan,

        planName:
          planData.name,

        amount:
          planData.amount,

        utr,

        screenshotFileId:
          null,

        activationCode:
          null,

        status:
          "WAITING_SCREENSHOT",

        createdAt:
          new Date().toISOString(),

        approvedAt:
          null

      };


      payments.push(payment);

      saveData();


      // --------------------------------------
      // ASK USER FOR SCREENSHOT
      // --------------------------------------

      await bot.sendMessage(
        chatId,

        `⏳ PAYMENT DETAILS RECEIVED\n\n` +

        `📦 Card: ${payment.planName}\n` +
        `💵 Amount: ₹${payment.amount}\n` +
        `🔢 UTR: ${payment.utr}\n\n` +

        `🖼️ NOW SEND PAYMENT SCREENSHOT\n\n` +

        `Apne payment ka screenshot isi chat mein bhejein.\n\n` +

        `Screenshot receive hone ke baad admin verification ke liye submit kiya jayega.`
      );

    } catch (error) {

      console.error(
        "Start error:",
        error
      );

    }

  }
);


// ==========================================
// SCREENSHOT RECEIVE
// ==========================================

bot.on(
  "photo",
  async (msg) => {

    try {

      const chatId =
        msg.chat.id;


      const payment =
        payments.find(
          p =>
            String(p.userId) === String(chatId) &&
            p.status === "WAITING_SCREENSHOT"
        );


      if (!payment) {

        return bot.sendMessage(
          chatId,

          `⚠️ No pending payment found.\n\n` +
          `Please start from the activation website.`
        );

      }


      const photos =
        msg.photo || [];


      if (!photos.length) {
        return;
      }


      const photo =
        photos[photos.length - 1];


      payment.screenshotFileId =
        photo.file_id;

      payment.status =
        "PENDING";


      payment.screenshotReceivedAt =
        new Date().toISOString();


      saveData();


      // --------------------------------------
      // USER CONFIRMATION
      // --------------------------------------

      await bot.sendMessage(
        chatId,

        `🖼️ SCREENSHOT RECEIVED ✅\n\n` +

        `📦 ${payment.planName}\n` +
        `💵 ₹${payment.amount}\n` +
        `🔢 UTR: ${payment.utr}\n\n` +

        `⏳ Payment is now waiting for admin approval.`
      );


      // --------------------------------------
      // ADMIN DETAILS
      // --------------------------------------

      await bot.sendMessage(
        ADMIN_CHAT_ID,

        `💰 NEW CC ACTIVATION PAYMENT\n\n` +

        `👤 User: ${payment.firstName}\n` +
        `🆔 Chat ID: ${payment.userId}\n` +
        `👤 Username: @${payment.username || "N/A"}\n\n` +

        `📦 Card: ${payment.planName}\n` +
        `💵 Amount: ₹${payment.amount}\n` +
        `🔢 UTR: ${payment.utr}\n\n` +

        `⏳ Status: PENDING`,

        {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "✅ APPROVE",
                  callback_data:
                    `approve_${payment.id}`
                },
                {
                  text: "❌ REJECT",
                  callback_data:
                    `reject_${payment.id}`
                }
              ]
            ]
          }
        }
      );


      // --------------------------------------
      // ADMIN SCREENSHOT
      // --------------------------------------

      await bot.sendPhoto(
        ADMIN_CHAT_ID,
        payment.screenshotFileId,
        {
          caption:
            `🖼️ PAYMENT SCREENSHOT\n\n` +

            `📦 ${payment.planName}\n` +
            `💵 Amount: ₹${payment.amount}\n` +
            `🔢 UTR: ${payment.utr}\n` +
            `👤 User: ${payment.firstName}\n` +
            `🆔 Chat ID: ${payment.userId}`
        }
      );

    } catch (error) {

      console.error(
        "Screenshot error:",
        error
      );

    }

  }
);


// ==========================================
// APPROVE / REJECT
// ==========================================

bot.on(
  "callback_query",
  async (query) => {

    try {

      const data =
        query.data || "";

      const adminId =
        String(query.from.id);


      // --------------------------------------
      // ADMIN CHECK
      // --------------------------------------

      if (
        adminId !==
        String(ADMIN_CHAT_ID)
      ) {

        return bot.answerCallbackQuery(
          query.id,
          {
            text: "Not authorized"
          }
        );

      }


      const parts =
        data.split("_");

      const action =
        parts[0];

      const paymentId =
        parts.slice(1).join("_");


      const payment =
        payments.find(
          p => p.id === paymentId
        );


      if (!payment) {

        return bot.answerCallbackQuery(
          query.id,
          {
            text:
              "Payment not found"
          }
        );

      }


      if (
        payment.status !==
        "PENDING"
      ) {

        return bot.answerCallbackQuery(
          query.id,
          {
            text:
              "Already processed"
          }
        );

      }


      // ======================================
      // APPROVE
      // ======================================

      if (action === "approve") {

        const newCode =
          generateCode();


        payment.status =
          "APPROVED";

        payment.activationCode =
          newCode;

        payment.approvedAt =
          new Date().toISOString();


        saveData();


        // ------------------------------------
        // USER
        // ------------------------------------

        await bot.sendMessage(
          payment.userId,

          `✅ PAYMENT APPROVED\n\n` +

          `📦 ${payment.planName}\n` +
          `💵 ₹${payment.amount}\n\n` +

          `🎫 YOUR ACTIVATION CODE\n` +
          `${newCode}\n\n` +

          `⚠️ Please save this code safely.\n\n` +

          `🌐 Open Activation Website:\n` +
          `${WEBSITE}\n\n` +

          `➡️ Next step: Enter your Free Fire UID and continue the activation process.`
        );


        // ------------------------------------
        // ADMIN
        // ------------------------------------

        await bot.editMessageText(

          `✅ PAYMENT APPROVED\n\n` +

          `👤 User: ${payment.firstName}\n` +
          `🆔 Chat ID: ${payment.userId}\n\n` +

          `📦 Card: ${payment.planName}\n` +
          `💵 Amount: ₹${payment.amount}\n` +
          `🔢 UTR: ${payment.utr}\n\n` +

          `🎫 Activation Code: ${newCode}\n\n` +

          `Status: APPROVED`,

          {
            chat_id:
              query.message.chat.id,

            message_id:
              query.message.message_id
          }

        );


        return bot.answerCallbackQuery(
          query.id,
          {
            text:
              "Payment approved"
          }
        );

      }


      // ======================================
      // REJECT
      // ======================================

      if (action === "reject") {

        payment.status =
          "REJECTED";


        saveData();


        await bot.sendMessage(
          payment.userId,

          `❌ PAYMENT REJECTED\n\n` +

          `📦 ${payment.planName}\n\n` +

          `Your activation payment could not be approved.\n\n` +

          `Please contact support if you believe this is an error.`
        );


        await bot.editMessageText(

          `❌ PAYMENT REJECTED\n\n` +

          `👤 User: ${payment.firstName}\n` +
          `📦 Card: ${payment.planName}\n` +
          `💵 Amount: ₹${payment.amount}\n` +
          `🔢 UTR: ${payment.utr}\n\n` +

          `Status: REJECTED`,

          {
            chat_id:
              query.message.chat.id,

            message_id:
              query.message.message_id
          }

        );


        return bot.answerCallbackQuery(
          query.id,
          {
            text:
              "Payment rejected"
          }
        );

      }

    } catch (error) {

      console.error(
        "Callback error:",
        error
      );

    }

  }
);


// ==========================================
// POLLING ERROR
// ==========================================

bot.on(
  "polling_error",
  error => {

    console.error(
      "Telegram polling error:",
      error.message
    );

  }
);


// ==========================================
// HTTP SERVER
// ==========================================

const PORT =
  process.env.PORT || 10000;

http.createServer(
  (req, res) => {

    res.writeHead(
      200,
      {
        "Content-Type":
          "text/plain"
      }
    );

    res.end(
      "Free Fire Card Payment Bot is running."
    );

  }
).listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

  }
);


console.log(
  "Free Fire Card Payment Bot started."
);
