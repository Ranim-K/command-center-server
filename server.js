import express from "express";
import { WebSocketServer } from "ws";
import cors from "cors";

const app = express();
app.use(cors());

// HTTP test route
app.get("/", (req, res) => {
  res.send("WebSocket server running");
});

// Create WebSocket server
const wss = new WebSocketServer({ noServer: true });
const clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);

  ws.on("message", (msg) => {
    // Broadcast message to all connected clients
    clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(msg.toString());
      }
    });
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

// Render will set the correct PORT automatically
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

// Upgrade HTTP → WebSocket
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});
