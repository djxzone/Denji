// وسيط بين الموقع (https) وبوت الاستضافة (http://IP:PORT)
// لتغيير العنوان لاحقاً: Vercel > Settings > Environment Variables > BOT_ORIGIN
// (لو أضفت BOT_ORIGIN هناك سابقاً فهو يتغلّب على العنوان الافتراضي تحت، حدّثه أو احذفه)
const { Readable } = require("stream");

const ORIGIN = (process.env.BOT_ORIGIN || "http://176.100.37.77:30283").replace(/\/+$/, "");
const CHUNK = 3.5 * 1024 * 1024; // أقصى حجم لكل طلب صوت (حد Vercel للرد ~4.5MB)

// بثّ الصوت (مع Range) لمشغل الموقع
async function stream(req, res) {
  let range = String(req.headers.range || "bytes=0-");
  const m = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (m && m[1] !== "") {
    const s = Number(m[1]);
    const e = m[2] === "" ? s + CHUNK - 1 : Math.min(Number(m[2]), s + CHUNK - 1);
    range = `bytes=${s}-${e}`;
  }
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 28000);
  try {
    const r = await fetch(ORIGIN + req.url, {
      method: req.method === "HEAD" ? "HEAD" : "GET",
      headers: { Range: range },
      signal: ctl.signal,
    });
    if (!r.ok && r.status !== 206) {
      clearTimeout(t);
      res.setHeader("Content-Type", "application/json");
      return res.status(r.status === 404 ? 404 : 502).send(JSON.stringify({ error: "الأغنية غير جاهزة." }));
    }
    res.statusCode = r.status;
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = r.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (req.method === "HEAD" || !r.body) { clearTimeout(t); return res.end(); }
    const rd = Readable.fromWeb(r.body);
    rd.on("end", () => clearTimeout(t));
    rd.on("error", () => { clearTimeout(t); res.destroy(); });
    res.on("close", () => { clearTimeout(t); rd.destroy(); });
    rd.pipe(res);
  } catch (e) {
    clearTimeout(t);
    if (!res.headersSent) {
      res.setHeader("Content-Type", "application/json");
      res.status(502).send(JSON.stringify({ error: "تعذّر الوصول للبوت، حاول بعد قليل." }));
    } else res.destroy();
  }
}

module.exports = async (req, res) => {
  if (/^\/api\/stream(\?|$)/.test(req.url || "")) return stream(req, res);

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  try {
    const ctl = new AbortController();
    // البحث ممكن ياخذ وقت أطول من باقي الطلبات
    const t = setTimeout(() => ctl.abort(), /^\/api\/search(\?|$)/.test(req.url || "") ? 25000 : 9000);
    const isPost = req.method === "POST";
    const body = isPost
      ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body || {}))
      : undefined;
    const r = await fetch(ORIGIN + req.url, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body,
      signal: ctl.signal,
    });
    clearTimeout(t);
    res.status(r.status).send(await r.text());
  } catch (e) {
    res.status(502).send(JSON.stringify({ error: "تعذّر الوصول للبوت، حاول بعد قليل." }));
  }
};
