import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";
import { parse } from "https://deno.land/std@0.224.0/csv/parse.ts";

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  const parts = header.split("; ");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx > -1) {
      const k = part.slice(0, idx);
      const v = part.slice(idx + 1);
      result[k] = v;
    }
  }
  return result;
}

async function getSessionUserId(req) {
  const cookies = parseCookies(req.headers.get("cookie"));
  const sid = cookies["sid"];
  if (!sid) return null;
  const kv = await Deno.openKv();
  const session = await kv.get(["session", sid]);
  if (session.value && session.value.userId) {
    return session.value.userId;
  }
  return null;
}

function buildSetCookie(name, value, options = {}) {
  const attrs = [`${name}=${value}`];
  if (options.path) attrs.push(`Path=${options.path}`);
  if (options.httpOnly) attrs.push("HttpOnly");
  if (options.sameSite) attrs.push(`SameSite=${options.sameSite}`);
  if (options.secure) attrs.push("Secure");
  if (options.maxAge !== undefined) attrs.push(`Max-Age=${options.maxAge}`);
  if (options.expires) attrs.push(`Expires=${options.expires.toUTCString()}`);
  return attrs.join("; ");
}

function pad2(n) {
  return n.toString().padStart(2, "0");
}

function normalizeAmount(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parsePaypayDate(value) {
  if (!value) return null;
  const s = String(value).trim().replace(/[.\/]/g, "-");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

async function geocodePlaceName(placeName) {
  const q = String(placeName || "").trim();
  if (!q) return null;
  const kv = await Deno.openKv();
  const cacheKey = ["geocode", "jp", q];
  const cached = await kv.get(cacheKey);
  if (cached.value) return cached.value;
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("countrycodes", "jp");
  url.searchParams.set("limit", "1");
  const res = await fetch(String(url), {
    headers: {
      "User-Agent": "jig-intern-public/1.0 (+https://github.com/2gPigeon/jig-intern-public)",
      "Accept-Language": "ja",
    },
  });
  if (!res.ok) return null;
  const arr = await res.json().catch(() => []);
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const hit = arr[0];
  const result = { lat: Number(hit.lat), lon: Number(hit.lon), display_name: hit.display_name };
  await kv.set(cacheKey, result);
  return result;
}

Deno.serve(async (req) => {
  const pathname = new URL(req.url).pathname;
  console.log(pathname);

  // --- Auth endpoints ---
  if (req.method === "POST" && pathname === "/login") {
    const { username } = await req.json().catch(() => ({ username: null }));
    if (!username || typeof username !== "string") {
      return new Response("invalid username", { status: 400 });
    }
    const kv = await Deno.openKv();
    const sid = crypto.randomUUID();
    await kv.set(["session", sid], { userId: username, createdAt: Date.now() });
    const isSecure = new URL(req.url).protocol === "https:";
    const setCookie = buildSetCookie("sid", sid, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: isSecure,
      maxAge: 60 * 60 * 24 * 7,
    });
    return new Response(JSON.stringify({ userId: username }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": setCookie,
      },
    });
  }

  if (req.method === "POST" && pathname === "/logout") {
    const cookies = parseCookies(req.headers.get("cookie"));
    const sid = cookies["sid"];
    const kv = await Deno.openKv();
    if (sid) {
      await kv.delete(["session", sid]);
    }
    const expired = buildSetCookie("sid", "", {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: new URL(req.url).protocol === "https:",
      maxAge: 0,
      expires: new Date(0),
    });
    return new Response(null, { headers: { "Set-Cookie": expired } });
  }

  if (req.method === "GET" && pathname === "/me") {
    const userId = await getSessionUserId(req);
    if (!userId) return new Response(null, { status: 401 });
    return new Response(JSON.stringify({ userId }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "POST" && pathname === "/submit-data") {
    const userId = await getSessionUserId(req);
    if (!userId) return new Response(null, { status: 401 });
    const { data, latitude, longitude } = await req.json();
    console.log("Received data:", { data, latitude, longitude });
    const kv = await Deno.openKv();
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const Y = d.getFullYear().toString();
    const M = pad(d.getMonth() + 1);
    const D = pad(d.getDate());
    const h = pad(d.getHours());
    const m = pad(d.getMinutes());
    const s = pad(d.getSeconds());
    const key = ["user", userId, `${Y}-${M}`, D, `${h}:${m}:${s}`];
    const exists = await kv.get(key);
    if (exists.value) {
      console.log("[submit-data] skip duplicate:", key);
      return new Response();
    }
    await kv.set(key,{"data":data,"latitude":latitude,"longitude":longitude});
    return new Response();
  }

  if (req.method === "GET" && pathname === "/get-data") {
    const userId = await getSessionUserId(req);
    if (!userId) return new Response(null, { status: 401 });
    const kv = await Deno.openKv();
    const data = [];
    for await (const entry of kv.list({ prefix: ["user", userId] })) {
      data.push(entry.value);
    }
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method === "GET" && pathname === "/get-search-data") {
    const userId = await getSessionUserId(req);
    if (!userId) return new Response(null, { status: 401 });
    const param = new URL(req.url).searchParams.get("YYYY-MM");
    const kv = await Deno.openKv();
    const data = [];
    for await (const entry of kv.list({ prefix: ["user", userId, param] })) {
      data.push(entry.value);
    }
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // CSV upload endpoint
  if (req.method === "POST" && pathname === "/upload-csv") {
    console.log("[upload-csv] called");
    const userId = await getSessionUserId(req);
    if (!userId) return new Response("unauthorized", { status: 401 });

    // multipart/form-data を受け取る
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) {
      return new Response("invalid content type", { status: 400 });
    }
    try {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return new Response("file is required", { status: 400 });
      }
      const text = await file.text();
      console.log("[upload-csv] filename=", file.name, "size=", file.size, "user=", userId);

      // CSVを解析して支払いのみ取り込み（原文保存はスキップ）
      const rows = await parse(text);
      console.log("[upload-csv] rows=", Array.isArray(rows) ? rows.length : rows);
      let header = null;
      let startIndex = 0;
      if (rows.length > 0 && Array.isArray(rows[0])) {
        header = rows[0];
        startIndex = 1;
      }
      console.log("[upload-csv] header=", header);
      const idx = (name) => header ? header.indexOf(name) : -1;
      const iContent = idx("取引内容");
      const iDate = idx("取引日");
      const iAmount = idx("出金金額（円）");
      const iPlace = idx("取引先");
      console.log("[upload-csv] indexes:", { iContent, iDate, iAmount, iPlace });

      if (iContent === -1 || iDate === -1 || iAmount === -1 || iPlace === -1) {
        return new Response(JSON.stringify({ ok: true, imported: 0, reason: "header not found" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const kv = await Deno.openKv();
      let imported = 0;
      let skipped = 0;
      for (let r = startIndex; r < rows.length; r++) {
        const row = rows[r];
        if (!Array.isArray(row)) continue;
        const content = row[iContent];
        if (String(content).trim() !== "支払い") continue;
        const date = parsePaypayDate(row[iDate]);
        const amount = normalizeAmount(row[iAmount]);
        const place = row[iPlace] ? String(row[iPlace]).trim() : "";
        if (!date || amount == null || !place) continue;

        const geo = await geocodePlaceName(place);
        if (!geo || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lon)) {
          console.log("[upload-csv] geocode miss:", { place, date, amount });
          // 未解決として保存（後で手動で緯度経度を入力）
          const unresolvedId = crypto.randomUUID();
          const YYu = date.getFullYear().toString();
          const MMu = pad2(date.getMonth() + 1);
          const DDu = pad2(date.getDate());
          const hhu = pad2(date.getHours());
          const mmu = pad2(date.getMinutes());
          const ssu = pad2(date.getSeconds());
          const unresolvedKey = ["unresolved", userId, unresolvedId];
          await kv.set(unresolvedKey, {
            id: unresolvedId,
            place,
            amount,
            dateISO: date.toISOString(),
            dateParts: { Y: YYu, M: MMu, D: DDu, h: hhu, m: mmu, s: ssu },
          });
          continue;
        }

        const YY = date.getFullYear().toString();
        const MM = pad2(date.getMonth() + 1);
        const DD = pad2(date.getDate());
        const hh = pad2(date.getHours());
        const mm = pad2(date.getMinutes());
        const ss = pad2(date.getSeconds());
        const key = ["user", userId, `${YY}-${MM}`, DD, `${hh}:${mm}:${ss}`];
        const exists = await kv.get(key);
        if (exists.value) {
          skipped++;
        } else {
          console.log("[upload-csv] save:", { key, amount, lat: geo.lat, lon: geo.lon, place });
          await kv.set(key, { data: amount, latitude: geo.lat, longitude: geo.lon });
          imported++;
        }
        // レート制限対策
        await new Promise((res) => setTimeout(res, 1100));
      }

      return new Response(JSON.stringify({ ok: true, imported, skipped }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      console.error("[upload-csv] error", e);
      return new Response("upload failed", { status: 500 });
    }
  }
  
  // 未解決一覧取得
  if (req.method === "GET" && pathname === "/unresolved") {
    const userId = await getSessionUserId(req);
    if (!userId) return new Response(null, { status: 401 });
    const kv = await Deno.openKv();
    const items = [];
    for await (const entry of kv.list({ prefix: ["unresolved", userId] })) {
      items.push(entry.value);
    }
    return new Response(JSON.stringify(items), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // 未解決の解決（緯度経度を与えて本保存）
  if (req.method === "POST" && pathname === "/resolve-unresolved") {
    const userId = await getSessionUserId(req);
    if (!userId) return new Response(null, { status: 401 });
    const { id, latitude, longitude } = await req.json().catch(() => ({}));
    if (!id || typeof latitude !== "number" || typeof longitude !== "number") {
      return new Response("invalid body", { status: 400 });
    }
    const kv = await Deno.openKv();
    const unresolvedKey = ["unresolved", userId, id];
    const rec = await kv.get(unresolvedKey);
    if (!rec.value) return new Response("not found", { status: 404 });
    const { amount, dateParts, place } = rec.value;
    const key = ["user", userId, `${dateParts.Y}-${dateParts.M}`, dateParts.D, `${dateParts.h}:${dateParts.m}:${dateParts.s}`];
    const exists = await kv.get(key);
    if (!exists.value) {
      await kv.set(key, { data: amount, latitude, longitude });
    }
    // 手動解決の結果をグローバルキャッシュにも保存（次回以降は即解決）
    const q = String(place || "").trim();
    if (q) {
      const cacheKey = ["geocode", "jp", q];
      await kv.set(cacheKey, { lat: latitude, lon: longitude, display_name: `manual:${q}` });
    }
    await kv.delete(unresolvedKey);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }
  return serveDir(req, {
    fsRoot: "public",
    urlRoot: "",
    showDirListing: true,
    enableCors: true,
  });
});
