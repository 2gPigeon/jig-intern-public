import { serveDir } from "https://deno.land/std@0.224.0/http/file_server.ts";

Deno.serve(async (req) => {
  const pathname = new URL(req.url).pathname;
  console.log(pathname);

  if (req.method === "POST" && pathname === "/submit-data") {
    const { data, latitude, longitude } = await req.json();
    console.log("Received data:", { data, latitude, longitude });
    const kv = await Deno.openKv();
    const myUUID = crypto.randomUUID();
    const key = ["pin",myUUID];
    await kv.set(key,{"data":data,"latitude":latitude,"longitude":longitude});
    return new Response();
  }

  if (req.method === "GET" && pathname === "/get-data") {
    const kv = await Deno.openKv();
    const data = [];
    for await (const entry of kv.list({ prefix: ["pin"] })) {
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
