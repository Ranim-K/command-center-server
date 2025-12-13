import express from "express";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json({ limit: "20mb" }));

const PORT = 3000;
const ROOT = "./storage";
const FILES = path.join(ROOT, "files");
const META = path.join(ROOT, "meta");

fs.mkdirSync(FILES, { recursive: true });
fs.mkdirSync(META, { recursive: true });

/* ---------- RECEIVE CHUNKS ---------- */
app.post("/upload/chunk", (req, res) => {
  const { upload_id, rel_path, index, total, data } = req.body;
  if (!upload_id || index == null || !data) return res.sendStatus(400);

  const tempDir = path.join(ROOT, "tmp", upload_id);
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(path.join(tempDir, index + ".part"), Buffer.from(data, "base64"));

  if (fs.readdirSync(tempDir).length === total) {
    const finalPath = path.join(FILES, rel_path);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });

    const ws = fs.createWriteStream(finalPath);
    for (let i = 0; i < total; i++) {
      ws.write(fs.readFileSync(path.join(tempDir, i + ".part")));
    }
    ws.end();

    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  res.json({ ok: true });
});

/* ---------- BUILD FILE TREE ---------- */
function buildTree(dir, base = dir) {
  return fs.readdirSync(dir).map(name => {
    const full = path.join(dir, name);
    const rel = path.relative(base, full);
    if (fs.statSync(full).isDirectory()) {
      return { type: "dir", name, children: buildTree(full, base) };
    }
    return { type: "file", name, path: rel };
  });
}

app.get("/fs/tree", (_, res) => {
  res.json(buildTree(FILES));
});

/* ---------- DOWNLOAD FILE ---------- */
app.get("/fs/file", (req, res) => {
  const p = path.join(FILES, req.query.path);
  if (!p.startsWith(path.resolve(FILES))) return res.sendStatus(403);
  res.download(p);
});

app.listen(PORT, () => console.log("Server running on port", PORT));
