// Cloudflare Pages Function — chạy trước khi trả HTML cho mọi request.
// Khi URL có ?ma=<mã khách>, tra Google Sheet và chèn lại <title>/og:/twitter:
// theo đúng tên khách, để Zalo/Facebook/iMessage... quét preview ra tên riêng
// thay vì "Quý khách" mặc định. Nếu có bất kỳ lỗi nào (sheet lỗi, không tìm
// thấy khách...) thì trả nguyên trang gốc, không làm hỏng trang.

const SHEET_ID = "1hGbvLvaqIb6AZ8hXIcubp4t8tz70TIfxBCiqnxtfjwk";
const SHEET_NAME = "Khách mời";
const PARAM = "ma";
const GROOM_SHORT = "Hoàng Phi";
const BRIDE_SHORT = "Kiều My";
const EVENT = "Lễ Tân Hôn";

function parseCSV(t) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}

const norm = s => s.trim().toLowerCase().normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/\s+/g, "_");

async function fetchSheetCSV(waitUntil) {
  const cache = caches.default;
  const cacheKey = new Request("https://internal.cache/thiep-guest-sheet");
  const cached = await cache.match(cacheKey);
  if (cached) return cached.text();

  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("sheet HTTP " + res.status);
  const text = await res.text();
  const toCache = new Response(text, { headers: { "Cache-Control": "max-age=120" } });
  waitUntil(cache.put(cacheKey, toCache));
  return text;
}

async function findGuestName(ma, waitUntil) {
  const csv = await fetchSheetCSV(waitUntil);
  const rows = parseCSV(csv).filter(r => r.some(c => c.trim()));
  if (!rows.length) return null;
  const head = rows[0].map(norm);
  const maIdx = head.indexOf("ma");
  const xungHoIdx = head.indexOf("xung_ho");
  const tenIdx = head.indexOf("ten");
  if (maIdx === -1) return null;
  const found = rows.slice(1).find(r => (r[maIdx] || "").trim().toLowerCase() === ma);
  if (!found) return null;
  const name = [xungHoIdx > -1 ? found[xungHoIdx] : "", tenIdx > -1 ? found[tenIdx] : ""]
    .map(s => (s || "").trim()).filter(Boolean).join(" ");
  return name || null;
}

const setContent = (content) => ({
  element(el) { el.setInnerContent(content); }
});
const setAttr = (attr, value) => ({
  element(el) { el.setAttribute(attr, value); }
});

export async function onRequest(context) {
  const { request, next, waitUntil } = context;
  const response = await next();

  const url = new URL(request.url);
  const ma = (url.searchParams.get(PARAM) || "").trim().toLowerCase();
  const ct = response.headers.get("content-type") || "";
  if (!ma || !ct.includes("text/html")) return response;

  let name = null;
  try { name = await findGuestName(ma, waitUntil); }
  catch (e) { return response; }
  if (!name) return response;

  const title = `Kính mời ${name} — Thiệp mời ${GROOM_SHORT} & ${BRIDE_SHORT}`;
  const desc = `Trân trọng kính mời ${name} đến chung vui cùng gia đình trong ${EVENT} của ${GROOM_SHORT} & ${BRIDE_SHORT}.`;

  return new HTMLRewriter()
    .on("title", setContent(title))
    .on('meta[name="description"]', setAttr("content", desc))
    .on('meta[property="og:title"]', setAttr("content", title))
    .on('meta[property="og:description"]', setAttr("content", desc))
    .on('meta[property="og:url"]', setAttr("content", url.href))
    .on('meta[name="twitter:title"]', setAttr("content", title))
    .on('meta[name="twitter:description"]', setAttr("content", desc))
    .transform(response);
}
