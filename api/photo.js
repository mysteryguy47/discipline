const { put } = require("@vercel/blob");
const { checkAuth } = require("./_lib");

module.exports = async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const { taskId, date, image } = req.body || {};
  if (!taskId || !date || !image) return res.status(400).json({ error: "missing taskId, date, or image" });

  const match = /^data:image\/(\w+);base64,(.+)$/.exec(image);
  if (!match) return res.status(400).json({ error: "invalid image data URL" });
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const buffer = Buffer.from(match[2], "base64");

  const safeTaskId = String(taskId).replace(/[^a-zA-Z0-9_-]/g, "");
  const safeDate = String(date).replace(/[^0-9-]/g, "");
  const pathname = `discipline/photos/${safeTaskId}-${safeDate}.${ext}`;

  const blob = await put(pathname, buffer, {
    access: "public",
    contentType: `image/${match[1]}`,
    addRandomSuffix: false,
    allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return res.status(200).json({ url: blob.url });
};
