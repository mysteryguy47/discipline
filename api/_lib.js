const { get, put } = require("@vercel/blob");

function checkAuth(req) {
  const secret = req.headers["x-app-secret"];
  return Boolean(secret) && secret === process.env.APP_SECRET;
}

// The Blob store is private (auth required for every read), so reads go
// through get() with the read-write token rather than a plain fetch() of
// a public URL.
async function readBlobJson(pathname) {
  const result = await get(pathname, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN });
  if (!result || result.statusCode !== 200) return null;
  const text = await new Response(result.stream).text();
  return JSON.parse(text);
}

async function writeBlobJson(pathname, data) {
  return put(pathname, JSON.stringify(data), {
    access: "private",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
}

module.exports = { checkAuth, readBlobJson, writeBlobJson };
