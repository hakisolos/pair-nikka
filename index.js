require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const pino = require('pino');
const NodeCache = require('node-cache');
const { Mutex } = require('async-mutex');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const { upload } = require('./mega');
const config = require('./config');

const app = express();
const port = 3000;
let session;
const msgRetryCounterCache = new NodeCache();
const mutex = new Mutex();
app.use(express.json());

// ✅ MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://miracle32669:Iyanu1234@kordai.bip3i.mongodb.net/?retryWrites=true&w=majority&appName=kordai";

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// ✅ MongoDB Schema for Users
const userSchema = new mongoose.Schema({ phone: String });
const User = mongoose.model('User', userSchema);

// ✅ Function to Store User in MongoDB
const updateUsersData = async (phoneNumber) => {
    try {
        let existingUser = await User.findOne({ phone: phoneNumber });
        if (!existingUser) {
            await new User({ phone: phoneNumber }).save();
        }
    } catch (error) {
        console.error("❌ Error updating users in DB:", error);
    }
};

// ✅ WhatsApp Connector Function (MongoDB for Sessions)
async function connector(Num, res) {
    const sessionDir = './session'; // Local fallback for testing

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    session = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' }))
        },
        printQRInTerminal: false,
        logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
        browser: Browsers.macOS("Safari"),
        markOnlineOnConnect: true,
        msgRetryCounterCache
    });

    if (!session.authState.creds.registered) {
        await delay(1500);
        Num = Num.replace(/[^0-9]/g, '');
        const code = await session.requestPairingCode(Num);
        
        // ✅ Store user in MongoDB
        await updateUsersData(Num);

        if (!res.headersSent) {
            res.json({ code: code?.match(/.{1,4}/g)?.join('-') });
        }
    }

    session.ev.on('creds.update', async () => {
        await saveCreds();
    });

    session.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('✅ Connected to WhatsApp');
            await delay(5000);

            try {
                const fek = await session.sendMessage(session.user.id, { 
                    image: { url: config.IMAGE }, 
                    caption: "Thank you for choosing Nikka Md! 😊❤\nSUPPORT: https://whatsapp.com/channel/0029VaoLotu42DchJmXKBN3L"
                });

                const pth = './session/creds.json';
                const url = await upload(pth);
                let sID = url.includes("https://mega.nz/file/") 
                    ? config.PREFIX + url.split("https://mega.nz/file/")[1] 
                    : 'An error occurred.';

                await session.sendMessage(session.user.id, { text: sID }, { quoted: fek });

            } catch (error) {
                console.error('❌ Error:', error);
            }
        } else if (connection === 'close') {
            reconn(lastDisconnect?.error?.output?.statusCode);
        }
    });
}

// ✅ Reconnect Function
function reconn(reason) {
    if ([DisconnectReason.connectionLost, DisconnectReason.connectionClosed, DisconnectReason.restartRequired].includes(reason)) {
        console.log('⚠️ Connection lost, reconnecting...');
        connector();
    } else {
        console.log(`❌ Disconnected! Reason: ${reason}`);
        session.end();
    }
}

// ✅ API: Get Users
app.get('/users', async (req, res) => {
    try {
        const users = await User.find();
        res.json({ total_users: users.length, users: users.map(user => user.phone) });
    } catch (error) {
        console.error("❌ Error fetching users:", error);
        res.status(500).json({ error: "Something went wrong!" });
    }
});

// ✅ API: Pairing
app.get('/pair', async (req, res) => {
    const Num = req.query.code;
    if (!Num) {
        return res.status(400).json({ message: 'Phone number is required' });
    }

    const release = await mutex.acquire();
    try {
        await connector(Num, res);
    } catch (error) {
        console.error("❌ Pairing Error:", error);
        res.status(500).json({ error: "Something went wrong!" });
    } finally {
        release();
    }
});

// ✅ Start Server
app.listen(port, () => {
    console.log(`🚀 Server running on PORT:${port}`);
});
