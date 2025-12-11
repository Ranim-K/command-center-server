import express from "express";
import { WebSocketServer } from "ws";

const app = express();

app.get("/", (req, res) => {
  res.send("WebSocket Relay Server is running");
});

// Create WebSocket server
const wss = new WebSocketServer({ noServer: true });

let clients = new Set();

wss.on("connection", (ws) => {
  clients.add(ws);

  ws.on("message", (msg) => {
    // broadcast message to all clients
    clients.forEach((client) => {
      if (client.readyState === 1) client.send(msg.toString());
    });
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

// Render auto-assigns PORT
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () =>
  console.log("Server running on port " + PORT)
);

// Upgrade HTTP → WS
server.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});
