const express = require('express');
const fs = require('fs');
const pino = require('pino');
const NodeCache = require('node-cache');
const mongoose = require('mongoose');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    Browsers,
    makeCacheableSignalKeyStore,
    DisconnectReason
} = require('@whiskeysockets/baileys');
const { upload } = require('./mega');
const { Mutex } = require('async-mutex');
const config = require('./config');
const path = require('path');

const app = express();
const port = 3000;
let session;
const msgRetryCounterCache = new NodeCache();
const mutex = new Mutex();
app.use(express.static(path.join(__dirname, 'static')));

// Connect to MongoDB
mongoose.connect(
    'mongodb+srv://miracle32669:Iyanu1234@kordai.bip3i.mongodb.net/kordai?retryWrites=true&w=majority&appName=kordai',
    { useNewUrlParser: true, useUnifiedTopology: true }
);

// Define a User schema
const userSchema = new mongoose.Schema({
    phoneNumber: { type: String, unique: true }
});
const User = mongoose.model('User', userSchema);

async function saveUser(phoneNumber) {
    try {
        await User.updateOne({ phoneNumber }, { phoneNumber }, { upsert: true });
    } catch (err) {
        console.error('Error saving user:', err);
    }
}

async function connector(Num, res) {
    const sessionDir = './session';
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir);

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

        // Store user in MongoDB
        await saveUser(Num);

        if (!res.headersSent) {
            res.send({ code: code?.match(/.{1,4}/g)?.join('-') });
        }
    }

    session.ev.on('creds.update', async () => {
        await saveCreds();
    });

    const cap = `Thank you for choosing Nikka Md 😲❤, join our platform for updates.
SUPPORT CHANNEL: https://whatsapp.com/channel/0029VaoLotu42DchJmXKBN3L
SUPPORT GC: 
`;

    session.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('Connected successfully');
            await delay(5000);

            try {
                const fek = await session.sendMessage(session.user.id, {
                    image: { url: config.IMAGE },
                    caption: cap
                });

                const pth = './session/creds.json';
                let url = await upload(pth);
                let sID = url.includes("https://mega.nz/file/")
                    ? config.PREFIX + url.split("https://mega.nz/file/")[1]
                    : 'An error occurred, Fekd up';

                await session.sendMessage(session.user.id, { text: sID }, { quoted: fek });

            } catch (error) {
                console.error('Error:', error);
            } finally {
                if (fs.existsSync(sessionDir)) {
                    fs.rmSync(sessionDir, { recursive: true, force: true });
                }
            }

        } else if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            reconn(reason);
        }
    });
}

function reconn(reason) {
    if ([DisconnectReason.connectionLost, DisconnectReason.connectionClosed, DisconnectReason.restartRequired].includes(reason)) {
        console.log('Connection lost, reconnecting...');
        connector(null, null);
    } else {
        console.log(`Disconnected! Reason: ${reason}`);
        if (session) session.end();
    }
}

// API route to get number of users
app.get('/users', async (req, res) => {
    try {
        const users = await User.find({});
        res.json({ total_users: users.length, users });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.get('/pair', async (req, res) => {
    const Num = req.query.code;
    if (!Num) {
        return res.status(400).json({ message: 'Phone number is required' });
    }

    const release = await mutex.acquire();
    try {
        await connector(Num, res);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "Error pairing device" });
    } finally {
        release();
    }
});

app.listen(port, () => {
    console.log(`Running on PORT: ${port}`);
});
