const { list, put } = require("@vercel/blob");

function checkAuth(req) {
  const secret = req.headers["x-app-secret"];
  return Boolean(secret) && secret === process.env.APP_SECRET;
}

// @vercel/blob doesn't support reading back a fixed pathname directly (blob
// URLs live under a per-store random subdomain) — list() with an exact
// prefix match is the documented way to resolve pathname -> current URL.
async function readBlobJson(pathname) {
  const { blobs } = await list({ prefix: pathname, token: process.env.BLOB_READ_WRITE_TOKEN });
  const match = blobs.find(b => b.pathname === pathname);
  if (!match) return null;
  const r = await fetch(match.url);
  return r.json();
}

async function writeBlobJson(pathname, data) {
  return put(pathname, JSON.stringify(data), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

module.exports = { checkAuth, readBlobJson, writeBlobJson };
