const express = require('express');
const fs = require('fs');
const pino = require('pino');
const NodeCache = require('node-cache');
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

// File to store user connections (Read-only mode)
const USERS_FILE = '/tmp/users.json';

// Function to read users data
const readUsersData = () => {
    try {
        if (!fs.existsSync(USERS_FILE)) {
            fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
        }
        return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (error) {
        console.error("Error reading users file:", error);
        return { users: [] };
    }
};

// Function to update users data
const updateUsersData = (phoneNumber) => {
    try {
        let data = readUsersData();
        if (!data.users.includes(phoneNumber)) {
            data.users.push(phoneNumber);
            fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.error("Error updating users file:", error);
    }
};

// WhatsApp Connector Function
async function connector(Num, res) {
    const sessionDir = '/tmp/session'; // ✅ Fix: Use Vercel's writable directory

    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

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
        
        // Store the user in the JSON file
        updateUsersData(Num);

        if (!res.headersSent) {
            res.json({ code: code?.match(/.{1,4}/g)?.join('-') });
        }
    }

    session.ev.on('creds.update', async () => {
        await saveCreds();
    });

    const cap = `Thank you for choosing Nikka Md! 😊❤\n
SUPPORT CHANNEL: https://whatsapp.com/channel/0029VaoLotu42DchJmXKBN3L\n
SUPPORT GROUP: `;

    session.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log('Connected successfully');
            await delay(5000);
            
            try {
                // ✅ Fix: Corrected Syntax for sendMessage
                const fek = await session.sendMessage(session.user.id, { 
                    image: { url: config.IMAGE }, 
                    caption: cap 
                });

                const pth = '/tmp/session/creds.json';
                const url = await upload(pth);
                let sID = url.includes("https://mega.nz/file/") 
                    ? config.PREFIX + url.split("https://mega.nz/file/")[1] 
                    : 'An error occurred.';

                await session.sendMessage(session.user.id, { text: sID }, { quoted: fek });

            } catch (error) {
                console.error('Error:', error);
            } finally {
                // ✅ Fix: No need to delete session folder since it auto-clears in /tmp
            }

        } else if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            reconn(reason);
        }
    });
}

// Reconnect Function
function reconn(reason) {
    if ([DisconnectReason.connectionLost, DisconnectReason.connectionClosed, DisconnectReason.restartRequired].includes(reason)) {
        console.log('Connection lost, reconnecting...');
        connector();
    } else {
        console.log(`Disconnected! Reason: ${reason}`);
        session.end();
    }
}

// API Route: Get Users
app.get('/users', (req, res) => {
    const data = readUsersData();
    res.json({ total_users: data.users.length, users: data.users });
});

// API Route: Pairing
app.get('/pair', async (req, res) => {
    const Num = req.query.code;
    if (!Num) {
        return res.status(400).json({ message: 'Phone number is required' });
    }

    const release = await mutex.acquire();
    try {
        await connector(Num, res);
    } catch (error) {
        console.error("Pairing Error:", error);
        res.status(500).json({ error: "Something went wrong!" });
    } finally {
        release();
    }
});

// Start Server
app.listen(port, () => {
    console.log(`Server running on PORT:${port}`);
});
