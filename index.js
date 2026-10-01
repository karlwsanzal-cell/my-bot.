const {
    default: makeWASocket,
    useMultiFileAuthState,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    delay
} = require('@whiskeysockets/baileys');
const TelegramBot = require('node-telegram-bot-api');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

const BOT_CONFIG = {
    telegramToken: '8850843532:AAFyZTGKF1ZM8CxBrX1nfpdmChQl2vy269k',
    developerName: 'المطور',
    developerUsername: 'my_bridge_99_bot',
    channelUrl: 'https://t.me/your_channel',
    groupUrl: 'https://t.me/your_group'
};

const tgBot = new TelegramBot(BOT_CONFIG.telegramToken, { polling: true });

tgBot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const captionText = `
🔥 *${BOT_CONFIG.developerName}* 🔥
🚨 مرحباً بك في بوت الربط والأتمتة

👇 *للحصول على كود الربط، أرسل رقمك مع رمز الدولة:*
مثال: \`/connect 967700000000\`
    `;
    const replyMarkup = {
        inline_keyboard: [
            [
                { text: '📢 CHANNEL', url: BOT_CONFIG.channelUrl },
                { text: '👥 GROUP', url: BOT_CONFIG.groupUrl }
            ]
        ]
    };
    tgBot.sendMessage(chatId, captionText, { parse_mode: 'Markdown', reply_markup: replyMarkup });
});

tgBot.onText(/\/connect (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    let phoneNumber = match[1].replace(/[^0-9]/g, '');

    if (!phoneNumber) {
        return tgBot.sendMessage(chatId, '❌ *يرجى كتابة الرقم بشكل صحيح مع رمز الدولة.*\nمثال: `/connect 967700000000`', { parse_mode: 'Markdown' });
    }

    const waitMsg = await tgBot.sendMessage(chatId, '⏳ *جاري الاتصال بالسيرفر وإنشاء كود الربط...*', { parse_mode: 'Markdown' });

    try {
        const sessionFolder = path.join(__dirname, 'sessions', `session_${phoneNumber}`);
        const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);

        const sock = makeWASocket({
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
            },
            browser: ["Ubuntu", "Chrome", "20.0.04"]
        });

        sock.ev.on('creds.update', saveCreds);

        if (!sock.authState.creds.registered) {
            await delay(3000);
            let pairingCode = await sock.requestPairingCode(phoneNumber);
            pairingCode = pairingCode?.match(/.{1,4}/g)?.join('-') || pairingCode;

            const codeText = `
✅ *تم إنشاء كود الربط بنجاح*

📞 *الرقم:* \`${phoneNumber}\`
🔑 *كود الربط:* \`${pairingCode}\`

⚠ *ملاحظة:* أدخل الكود في تطبيق الواتساب خلال 30 ثانية.
            `;
            tgBot.editMessageText(codeText, {
                chat_id: chatId,
                message_id: waitMsg.message_id,
                parse_mode: 'Markdown'
            });
        }

        sock.ev.on('connection.update', (update) => {
            const { connection } = update;
            if (connection === 'open') {
                tgBot.sendMessage(chatId, '🟢 *تم ربط الواتساب بنجاح!* افتح الواتساب الآن واكتب `.menu` لاختبار البوت.', { parse_mode: 'Markdown' });
            }
        });

        sock.ev.on('messages.upsert', async (chatUpdate) => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek.message || mek.key.fromMe) return;

                const from = mek.key.remoteJid;
                const type = Object.keys(mek.message)[0];
                const body = type === 'conversation' ? mek.message.conversation :
                             type === 'extendedTextMessage' ? mek.message.extendedTextMessage.text : '';

                if (body === '.menu' || body === 'منيو') {
                    const menuText = `
🤖 *قائمة الأوامر الشغالة:*

• *.ping* : فحص سرعة استجابة البوت
• *.info* : عرض معلومات الحساب
• *.time* : عرض الوقت والتاريخ الحالي
• *.owner* : عرض معلومات المطور
• *.echo [النص]* : إعادة إرسال النص
                    `;
                    await sock.sendMessage(from, { text: menuText }, { quoted: mek });
                }

                if (body === '.ping') {
                    await sock.sendMessage(from, { text: '⚡ البوت متصل ويعمل بسرعة ممتازة!' }, { quoted: mek });
                }

                if (body === '.info') {
                    const infoText = `
ℹ️ *معلومات النظام:*
- الحالة: متصل 🟢
- المكتبة: Baileys v6
- المشغل: Node.js
                    `;
                    await sock.sendMessage(from, { text: infoText }, { quoted: mek });
                }

                if (body === '.time') {
                    const now = new Date().toLocaleString('ar-EG', { timeZone: 'Asia/Riyadh' });
                    await sock.sendMessage(from, { text: `🕒 الوقت الحالي: ${now}` }, { quoted: mek });
                }

                if (body.startsWith('.echo ')) {
                    const textToRepeat = body.replace('.echo ', '');
                    await sock.sendMessage(from, { text: `الرسالة: ${textToRepeat}` }, { quoted: mek });
                }

            } catch (err) {
                console.error("خطأ في تنفيذ الأمر:", err);
            }
        });

    } catch (err) {
        tgBot.sendMessage(chatId, `❌ *حدث خطأ أثناء الاتصال:* ${err.message}`, { parse_mode: 'Markdown' });
    }
});
