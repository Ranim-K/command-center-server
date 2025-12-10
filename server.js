const express = require('express');
const WebSocket = require('ws');

const app = express();
app.use(express.json());

const wss = new WebSocket.Server({ port: process.env.PORT || 8081 });

let clients = [];

wss.on('connection', ws => {
    clients.push(ws);
    ws.on('close', () => {
        clients = clients.filter(c => c !== ws);
    });
});

app.post('/command', (req, res) => {
    const cmd = req.body.command;
    clients.forEach(ws => ws.send(cmd));
    res.json({ status: "sent", command: cmd });
});

app.listen(process.env.PORT || 8080, () => console.log("Control server running"));
