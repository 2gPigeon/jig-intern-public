import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

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
    const myUUID = crypto.randomUUID();
    const d = new Date();
    const pad = (n) => n.toString().padStart(2, "0");
    const Y = d.getFullYear().toString();
    const M = pad(d.getMonth() + 1);
    const D = pad(d.getDate());
    const h = pad(d.getHours());
    const m = pad(d.getMinutes());
    const s = pad(d.getSeconds());
    const key = ["user", userId, `${Y}-${M}`, D, `${h}:${m}:${s}`, myUUID];
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
  return serveDir(req, {
    fsRoot: "public",
    urlRoot: "",
    showDirListing: true,
    enableCors: true,
  });
});
