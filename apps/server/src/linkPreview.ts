// @effect-diagnostics nodeBuiltinImport:off - each connection's DNS answer is checked through
// Node's lookup hook, which HttpClient does not expose.
// @effect-diagnostics globalDate:off - a wall-clock cache TTL outside any Effect.
import * as NodeDns from "node:dns";
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodeNet from "node:net";

import type { LinkPreview } from "@t3tools/contracts";

const TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 60 * 60_000;
const CACHE_SIZE = 500;

const blocked = new NodeNet.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 127],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");

const isBlocked = (address: string) =>
  blocked.check(address, NodeNet.isIPv6(address) ? "ipv6" : "ipv4");

const lookup = ((
  hostname: string,
  options: NodeDns.LookupOptions,
  callback: (
    error: Error | null,
    address: string | NodeDns.LookupAddress[],
    family?: number,
  ) => void,
) =>
  NodeDns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    const first = addresses[0];
    if (!first || addresses.some((entry) => isBlocked(entry.address)))
      return callback(new Error("Refused a private address."), "");
    if (options.all) callback(null, addresses);
    else callback(null, first.address, first.family);
  })) as NodeNet.LookupFunction;

const fetchHtml = (url: URL, redirects = 0): Promise<{ url: URL; html: string }> =>
  new Promise((resolve, reject) => {
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return reject(new Error("Only http(s) links."));
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (NodeNet.isIP(host) && isBlocked(host))
      return reject(new Error("Refused a private address."));
    const request = (url.protocol === "https:" ? NodeHttps : NodeHttp).get(
      url,
      {
        lookup,
        timeout: TIMEOUT_MS,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; OziLinkPreview/1.0)",
          accept: "text/html,application/xhtml+xml",
        },
      },
      (response) => {
        const location = response.headers.location;
        if (
          response.statusCode &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          location
        ) {
          response.resume();
          if (redirects >= MAX_REDIRECTS) return reject(new Error("Too many redirects."));
          return resolve(fetchHtml(new URL(location, url), redirects + 1));
        }
        if (response.statusCode !== 200 || !/html/i.test(response.headers["content-type"] ?? "")) {
          response.resume();
          return reject(new Error("Not an HTML page."));
        }
        let html = "";
        let size = 0;
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          size += chunk.length;
          html += chunk;
          if (size >= MAX_BYTES || /<\/head>/i.test(chunk)) response.destroy();
        });
        response.on("close", () => resolve({ url, html }));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("Timed out.")));
    request.on("error", reject);
  });

const decodeEntities = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

function parse(url: URL, html: string): LinkPreview {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attr = (name: string) =>
      tag
        .match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"))
        ?.slice(1)
        .find((value) => value !== undefined);
    const key = (attr("property") ?? attr("name"))?.toLowerCase();
    const content = attr("content");
    if (key && content && !meta.has(key)) meta.set(key, decodeEntities(content));
  }
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const image = meta.get("og:image") ?? meta.get("twitter:image");
  const imageUrl = image ? URL.parse(image, url.href) : null;
  return {
    url: url.href,
    title:
      meta.get("og:title") ?? meta.get("twitter:title") ?? (title ? decodeEntities(title) : null),
    description:
      meta.get("og:description") ??
      meta.get("twitter:description") ??
      meta.get("description") ??
      null,
    image: imageUrl && /^https?:$/.test(imageUrl.protocol) ? imageUrl.href : null,
    site: meta.get("og:site_name") ?? url.hostname.replace(/^www\./, ""),
  };
}

const cache = new Map<string, { at: number; value: Promise<LinkPreview> }>();

export function linkPreview(href: string): Promise<LinkPreview> {
  const hit = cache.get(href);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const url = URL.parse(href);
  const empty = {
    url: href,
    title: null,
    description: null,
    image: null,
    site: url?.hostname ?? null,
  };
  const value = url
    ? fetchHtml(url).then(
        (page) => parse(page.url, page.html),
        () => empty,
      )
    : Promise.resolve(empty);
  cache.delete(href);
  cache.set(href, { at: Date.now(), value });
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return value;
}
