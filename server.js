import express from "express";
import { WebSocketServer } from "ws";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const COMMAND_FILE = "./commands.json";

let targets = { targets: {} };

try {
    if (fs.existsSync(COMMAND_FILE)) {
        targets = JSON.parse(fs.readFileSync(COMMAND_FILE));
    }
} catch (err) {
    console.error("Failed to read commands.json:", err);
}

function saveCommands() {
    fs.writeFileSync(COMMAND_FILE, JSON.stringify(targets, null, 2));
}

const wss = new WebSocketServer({ noServer: true });

const clients = new Map();   // client machines
const controls = new Set();  // control interfaces

wss.on("connection", (ws) => {
    let targetName = null;
    let role = null;

    ws.on("message", (msg) => {
        let data = JSON.parse(msg);

        // Registration
        if (data.type === "register") {
            role = data.role || "client";

            if (role === "control") {
                controls.add(ws);
                console.log("🟡 Control connected");
                return;
            }

            if (role === "client") {
                targetName = data.name;
                clients.set(targetName, ws);
                console.log(`🟢 Client connected: ${targetName}`);

                // Send pending commands
                if (targets.targets[targetName]) {
                    targets.targets[targetName].forEach(cmd => {
                        if (cmd.status === "pending") ws.send(JSON.stringify(cmd));
                    });
                }
                return;
            }
        }

        // Client sends back results
        if (role === "client" && data.type === "response") {
            // update command status
            const arr = targets.targets[targetName] || [];
            const cmd = arr.find(c => c.id === data.id);
            if (cmd) cmd.status = "done";
            saveCommands();

            // Forward to all controls
            controls.forEach(c => {
                if (c.readyState === 1) {
                    c.send(JSON.stringify({
                        type: "client_response",
                        client: targetName,
                        payload: data
                    }));
                }
            });
        }

        // Control sends file-explorer commands
        if (role === "control" && data.type === "command") {
            const target = data.target;
            const command = data.command;
            const args = data.args || "";

            if (!targets.targets[target]) targets.targets[target] = [];

            const cmd = {
                id: uuidv4(),
                type: command,
                value: args,
                status: "pending"
            };

            targets.targets[target].push(cmd);
            saveCommands();

            // Send to client
            const cli = clients.get(target);
            if (cli && cli.readyState === 1) {
                cli.send(JSON.stringify(cmd));
            }
        }
    });

    ws.on("close", () => {
        if (role === "control") controls.delete(ws);
        if (role === "client" && targetName) clients.delete(targetName);
    });
});

const server = app.listen(PORT, () => {
    console.log("File Explorer Server running on port", PORT);
});

server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, ws => {
        wss.emit("connection", ws);
    });
});
