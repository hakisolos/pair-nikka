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

var app = express();
var port = 3000;
var session;
const msgRetryCounterCache = new NodeCache();
const mutex = new Mutex();
app.use(express.static(path.join(__dirname, 'static')));

// File to store user connections
const USERS_FILE = './users.json';

// Function to read users data
const readUsersData = () => {
    if (!fs.existsSync(USERS_FILE)) {
        fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2));
    }
    return JSON.parse(fs.readFileSync(USERS_FILE, { encoding: 'utf8' }));
};

// Function to update users data
const updateUsersData = (phoneNumber) => {
    let data = readUsersData();
    if (!data.users.includes(phoneNumber)) {
        data.users.push(phoneNumber);
        fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
    }
};

async function connector(Num, res) {
    var sessionDir = './session';
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir);
    }
    var { state, saveCreds } = await useMultiFileAuthState(sessionDir);

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
        var code = await session.requestPairingCode(Num);
        
        // Store the user in the JSON file
        updateUsersData(Num);

        if (!res.headersSent) {
            res.send({ code: code?.match(/.{1,4}/g)?.join('-') });
        }
    }

    session.ev.on('creds.update', async () => {
        await saveCreds();
    });

    const cap = `Thank you for choosing Nikka Md 😲❤, join our platform for updates,
SUPPORT CHANNEL: https://whatsapp.com/channel/0029VaoLotu42DchJmXKBN3L

SUPPORT GC: 
`;

    session.ev.on('connection.update', async (update) => {
        var { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('Connected successfully');
            await delay(5000);

            var fek = await session.sendMessage(session.user.id, {
                image: { url: `${config.IMAGE}` },
                caption: cap
            });

            var pth = './session/creds.json';
            try {
                var url = await upload(pth);
                var sID;
                if (url.includes("https://mega.nz/file/")) {
                    sID = config.PREFIX + url.split("https://mega.nz/file/")[1];
                } else {
                    sID = 'An error occurred';
                }
                await session.sendMessage(session.user.id, { text: `${sID}` }, { quoted: fek });
            } catch (error) {
                console.error('Error:', error);
            } finally {
                if (fs.existsSync(path.join(__dirname, './session'))) {
                    fs.rmSync(path.join(__dirname, './session'), { recursive: true, force: true });
                }
            }
        } else if (connection === 'close') {
            var reason = lastDisconnect?.error?.output?.statusCode;
            reconn(reason);
        }
    });
}

function reconn(reason) {
    if ([DisconnectReason.connectionLost, DisconnectReason.connectionClosed, DisconnectReason.restartRequired].includes(reason)) {
        console.log('Connection lost, reconnecting...');
        connector(undefined, undefined);
    } else {
        console.log(`Disconnected! reason: ${reason}`);
        session.ws.close();
    }
}

// API route to get number of users
app.get('/users', (req, res) => {
    let data = readUsersData();
    res.json({ total_users: data.users.length, users: data.users });
});

app.get('/pair', async (req, res) => {
    var Num = req.query.code;
    if (!Num) {
        return res.status(418).json({ message: 'Phone number is required' });
    }

    var release = await mutex.acquire();
    try {
        await connector(Num, res);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: "An error occurred" });
    } finally {
        release();
    }
});

app.listen(port, () => {
    console.log(`Running on PORT:${port}`);
});
