const { checkAuth, readBlobJson, writeBlobJson } = require("./_lib");

const STATE_PATH = "discipline/state.json";

module.exports = async (req, res) => {
  if (!checkAuth(req)) return res.status(401).json({ error: "unauthorized" });

  if (req.method === "GET") {
    const data = await readBlobJson(STATE_PATH);
    if (!data) return res.status(404).json({ error: "no cloud state saved yet" });
    return res.status(200).json(data);
  }

  if (req.method === "POST") {
    const body = req.body;
    if (!body || !Array.isArray(body.tasks)) return res.status(400).json({ error: "invalid state" });
    await writeBlobJson(STATE_PATH, body);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "method not allowed" });
};
