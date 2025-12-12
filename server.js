import express from "express";
import { WebSocketServer } from "ws";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const COMMAND_FILE = "./commands.json";

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
const clients = new Map(); // targetName -> ws
const controls = new Set(); // all connected controls

wss.on("connection", (ws, req) => {
  let targetName = null;
  let role = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      // Registration
      if (data.type === "register") {
        role = data.role || "client";

        if (role === "control") {
          controls.add(ws);
          console.log(`🟡 Control connected`);
        } else {
          targetName = data.name;
          clients.set(targetName, ws);
          console.log(`🟢 Client connected: ${targetName}`);

          // Send pending commands
          if (targets.targets[targetName]) {
            targets.targets[targetName].forEach(cmd => {
              if (cmd.status === "pending") ws.send(JSON.stringify(cmd));
            });
          }
        }
        return;
      }

      // Client response
      if (role === "client" && data.type === "response" && targetName) {
        // Update commands.json
        if (targets.targets[targetName]) {
          const cmd = targets.targets[targetName].find(c => c.id === data.id);
          if (cmd) cmd.status = data.status || "executed";
          saveCommands();
        }

        // Forward to all controls
        controls.forEach(ctrl => {
          if (ctrl.readyState === 1) {
            ctrl.send(JSON.stringify({
              type: "client_response",
              client: targetName,
              payload: data
            }));
          }
        });
        return;
      }

      // Optionally: control can send commands via WS
      if (role === "control" && data.type === "command") {
        const target = data.target;
        const type_ = data.command;
        const value = data.args || "";

        if (!target || !type_) return;

        if (!targets.targets[target]) targets.targets[target] = [];

        const cmd = {
          id: uuidv4(),
          type: type_,
          value: value,
          status: "pending",
          timestamp: Date.now()
        };

        targets.targets[target].push(cmd);
        saveCommands();

        const wsTarget = clients.get(target);
        if (wsTarget && wsTarget.readyState === 1) {
          wsTarget.send(JSON.stringify(cmd));
        }
        return;
      }

    } catch (err) {
      console.error("Invalid message:", message);
    }
  });

  ws.on("close", () => {
    if (role === "control") {
      controls.delete(ws);
      console.log("❌ Control disconnected");
    } else if (targetName) {
      clients.delete(targetName);
      console.log(`❌ Client disconnected: ${targetName}`);
    }
  });
});

// HTTP routes for control (optional) yes
app.post("/send", (req, res) => {
  const { target, type, value } = req.body;
  if (!target || !type) return res.status(400).send({ error: "Missing fields" });

  if (!targets.targets[target]) targets.targets[target] = [];

  const cmd = { id: uuidv4(), type, value: value || "", status: "pending", timestamp: Date.now() };
  targets.targets[target].push(cmd);
  saveCommands();

  const ws = clients.get(target);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(cmd));

  res.send({ success: true, id: cmd.id });
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
