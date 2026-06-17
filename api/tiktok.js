const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36 Edg/149.0.0.0"
const BASE = "https://ssstik.io"

const decode = s => { try { return decodeURIComponent(escape(Buffer.from(s, "base64").toString("binary"))) } catch { return "" } }
const clean  = s => (s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim()
const pick   = (re, h) => (h.match(re) || [])[1] || ""

async function bootstrap() {
  const r = await fetch(`${BASE}/en`, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", referer: `${BASE}/` } })
  const html = await r.text()
  const tt   = pick(/s_tt\s*=\s*'([^']+)'/, html)
  const furl = pick(/s_furl\s*=\s*'([^']+)'/, html) || "abc"
  if (!tt) throw new Error("token not found")
  return { tt, furl }
}

async function trace() {
  const r = await fetch(`${BASE}/cdn-cgi/trace`, { headers: { "user-agent": UA, referer: `${BASE}/` } })
  const o = {}
  ;(await r.text()).trim().split("\n").forEach(l => { const i = l.indexOf("="); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1) })
  return o
}

function parse(html) {
  const username  = clean(pick(/<h2[^>]*>([\s\S]*?)<\/h2>/i, html))
  const caption   = clean(pick(/class="maintext"[^>]*>([\s\S]*?)<\/p>/i, html))
  const avatarRaw = pick(/class="result_author"[^>]*src="([^"]+)"/i, html)
  const avatar    = /\/a\/[A-Za-z0-9+/=]+$/.test(avatarRaw) ? decode(avatarRaw.split("/a/")[1]) || avatarRaw : avatarRaw

  const anchors = [...html.matchAll(/<a\b([^>]*?)>/gi)].map(m => m[1])
  let video = "", music = ""
  const images = []
  for (const a of anchors) {
    const cls  = pick(/class="([^"]*)"/, a)
    const href = pick(/href="([^"]*)"/, a)
    if (!/download_link|dl-button/.test(cls)) continue
    if (/music/.test(cls) && href && href !== "#") music = href
    else if (/without_watermark(?!_hd)/.test(cls) && href && href.startsWith("http")) { if (!video) video = href }
    else if (/photo|image|slide/.test(cls) && href && href.startsWith("http")) images.push(href)
  }
  if (!music) music = pick(/href="([^"]*\/m\/[A-Za-z0-9+/=]+)"/, html)
  if (!images.length) {
    for (const m of html.matchAll(/href="(https:\/\/tikcdn\.io\/ssstik\/p\/[^"]+)"/gi)) images.push(m[1])
  }
  return { username, caption, avatar, video, music, images: [...new Set(images)] }
}

async function tiktok(url) {
  if (!url || !/tiktok\.com|douyin/.test(url)) throw new Error("invalid tiktok url")
  const { tt, furl } = await bootstrap()
  const t    = await trace()
  const body = new URLSearchParams({ id: url, locale: "en", tt, debug: `ab=0&loc=${t.loc || "US"}&ip=${t.ip || ""}` })
  const r = await fetch(`${BASE}/${furl}?url=dl`, {
    method: "POST",
    headers: {
      "user-agent": UA, accept: "*/*", "accept-language": "en-US,en;q=0.9",
      "content-type": "application/x-www-form-urlencoded",
      "hx-current-url": `${BASE}/`, "hx-request": "true", "hx-target": "target", "hx-trigger": "_gcaptcha_pt",
      origin: BASE, referer: `${BASE}/`
    },
    body
  })
  const html = await r.text()
  if (/error|Cuoldn't|couldn|Wrong/i.test(html) && !/result_overlay/.test(html))
    throw new Error("ssstik error: " + clean(html).slice(0, 120))
  const data = parse(html)
  if (!data.video && !data.music && !data.images.length)
    throw new Error("no media found (private/region/expired link)")
  return { status: true, type: data.images.length && !data.video ? "image" : "video", ...data }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin",  "*")
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "GET")    return res.status(405).json({ status: false, error: "Method not allowed" })

  const url = req.query?.url
  if (!url) return res.status(400).json({ status: false, error: "Parameter ?url= is required", docs: "/docs" })

  try {
    const data = await tiktok(url)
    return res.status(200).json(data)
  } catch (err) {
    const code = err.message.includes("invalid") ? 400 : 502
    return res.status(code).json({ status: false, error: err.message })
  }
}
