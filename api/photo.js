const { put, get } = require("@vercel/blob");
const { checkAuth } = require("./_lib");

const PHOTO_PREFIX = "discipline/photos/";

// Photos are stored privately like everything else, but they need to render
// in a plain <img src="..."> tag, which can't send the x-app-secret header.
// So GET here takes the secret as a query param instead and proxies the
// private blob's bytes straight through.
async function handleView(req, res) {
  const { path, key } = req.query || {};
  if (!key || key !== process.env.APP_SECRET) return res.status(401).json({ error: "unauthorized" });
  if (!path || !path.startsWith(PHOTO_PREFIX)) return res.status(400).json({ error: "invalid path" });

  try {
    const result = await get(path, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN });
    if (!result || result.statusCode !== 200) return res.status(404).json({ error: "photo not found" });
    const buf = Buffer.from(await new Response(result.stream).arrayBuffer());
    res.setHeader("Content-Type", result.blob.contentType || "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=86400");
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: "photo view crashed", detail: String((e && e.message) || e) });
  }
}

async function handleUpload(req, res) {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  const { taskId, date, image } = req.body || {};
  if (!taskId || !date || !image) return res.status(400).json({ error: "missing taskId, date, or image" });

  const match = /^data:image\/(\w+);base64,(.+)$/.exec(image);
  if (!match) return res.status(400).json({ error: "invalid image data URL" });
  const ext = match[1] === "jpeg" ? "jpg" : match[1];
  const buffer = Buffer.from(match[2], "base64");

  const safeTaskId = String(taskId).replace(/[^a-zA-Z0-9_-]/g, "");
  const safeDate = String(date).replace(/[^0-9-]/g, "");
  const pathname = `${PHOTO_PREFIX}${safeTaskId}-${safeDate}.${ext}`;

  try {
    await put(pathname, buffer, {
      access: "private",
      contentType: `image/${match[1]}`,
      addRandomSuffix: false,
      allowOverwrite: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    const viewUrl = `/api/photo?path=${encodeURIComponent(pathname)}&key=${encodeURIComponent(process.env.APP_SECRET)}`;
    return res.status(200).json({ url: viewUrl });
  } catch (e) {
    return res.status(500).json({ error: "photo upload crashed", detail: String((e && e.message) || e) });
  }
}

module.exports = async (req, res) => {
  if (req.method === "GET") return handleView(req, res);
  if (req.method === "POST") return handleUpload(req, res);
  return res.status(405).json({ error: "method not allowed" });
};
