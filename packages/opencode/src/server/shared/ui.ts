import { Flag } from "@opencode-ai/core/flag/flag"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect, Stream } from "effect"
import { HttpBody, HttpClient, HttpClientRequest, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { Buffer } from "node:buffer"
import * as path from "node:path"
import { ProxyUtil } from "../proxy-util"

const embeddedUIPromise = Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI
  ? Promise.resolve(null)
  : // @ts-expect-error - generated file at build time
    import("opencode-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null)

const WEBGUI_MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".map": "application/json",
}

function webguiContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return WEBGUI_MIME[ext] || "application/octet-stream"
}

export const UI_UPSTREAM = new URL("https://app.opencode.ai")

export const csp = (hash = "") =>
  `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'${hash ? ` 'sha256-${hash}'` : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' data:; connect-src * data:`
export const DEFAULT_CSP = csp()

export function themePreloadHash(body: string) {
  return body.match(/<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i)
}

export function cspForHtml(body: string) {
  const match = themePreloadHash(body)
  return csp(match ? createHash("sha256").update(match[2]).digest("base64") : "")
}

function requestBody(request: HttpServerRequest.HttpServerRequest) {
  if (request.method === "GET" || request.method === "HEAD") return HttpBody.empty
  const len = request.headers["content-length"]
  return HttpBody.stream(request.stream, request.headers["content-type"], len === undefined ? undefined : Number(len))
}

function proxyResponseHeaders(headers: Record<string, string>) {
  const result = new Headers(headers)
  // FetchHttpClient exposes decoded response bodies, so forwarding upstream
  // transfer metadata makes browsers decode already-decoded assets again.
  result.delete("content-encoding")
  result.delete("content-length")
  result.delete("transfer-encoding")
  return result
}

export function upstreamURL(path: string) {
  return new URL(path, UI_UPSTREAM).toString()
}

export function embeddedUI() {
  if (Flag.OPENCODE_DISABLE_EMBEDDED_WEB_UI) return Promise.resolve(null)
  return embeddedUIPromise
}

function notFound() {
  return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
}

function embeddedUIResponse(file: string, body: Uint8Array) {
  const mime = AppFileSystem.mimeType(file)
  const headers = new Headers({ "content-type": mime })
  if (mime.startsWith("text/html")) {
    headers.set("content-security-policy", cspForHtml(new TextDecoder().decode(body)))
  }
  return HttpServerResponse.raw(body, { headers })
}

export function serveEmbeddedUIEffect(
  requestPath: string,
  fs: AppFileSystem.Interface,
  embeddedWebUI: Record<string, string>,
) {
  const file = embeddedWebUI[requestPath.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
  if (!file) return Effect.succeed(notFound())

  return fs.readFile(file).pipe(
    Effect.map((body) => embeddedUIResponse(file, body)),
    Effect.catchReason("PlatformError", "NotFound", () => Effect.succeed(notFound())),
  )
}

function resolveWebGuiRoot(): string | undefined {
  const candidates = [
    // Built binary: webgui-dist next to the binary
    path.resolve(path.dirname(process.execPath), "webgui-dist"),
    path.resolve(path.dirname(process.execPath), "../packages/opencode/webgui-dist"),
    // Dev mode: relative to CWD
    path.resolve(process.cwd(), "packages/opencode/webgui-dist"),
    path.resolve(process.cwd(), "webgui-dist"),
  ]
  for (const candidate of candidates) {
    const indexFile = path.join(candidate, "index.html")
    if (existsSync(indexFile)) return candidate
  }
  return undefined
}

function serveWebGuiFile(root: string, relativePath: string): HttpServerResponse.HttpServerResponse | undefined {
  // Prevent directory traversal
  const resolved = path.resolve(root, `.${relativePath}`)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return undefined

  if (!existsSync(resolved) || statSync(resolved).isDirectory()) return undefined

  const content = readFileSync(resolved)
  const contentType = webguiContentType(resolved)

  if (contentType.startsWith("text/html")) {
    // Inject __OPENCODE_SERVER_URL__ so the webgui knows where the REST API lives.
    // Omit the port from the URL since the webgui is served from the same origin.
    const html = content.toString("utf-8")
    const script = `<script>window.__OPENCODE_SERVER_URL__="";</script>`
    const idx = html.indexOf("<script")
    const injected = idx !== -1
      ? html.slice(0, idx) + script + "\n    " + html.slice(idx)
      : html.replace("</head>", `${script}\n</head>`)
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "no-cache",
    })
    return HttpServerResponse.raw(Buffer.from(injected), { headers })
  }

  const cacheControl = contentType.startsWith("text/html") ? "no-cache" : "public, max-age=31536000, immutable"
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
  })
  return HttpServerResponse.raw(content, { headers })
}

function serveWebGui(root: string, pathname: string): HttpServerResponse.HttpServerResponse | undefined {
  // Strip /app prefix to get the relative path within webgui-dist
  let relative = pathname.slice("/app".length)
  if (!relative || relative === "/") relative = "/index.html"

  // Try exact file match first
  const fileResponse = serveWebGuiFile(root, relative)
  if (fileResponse) return fileResponse

  // SPA fallback: serve index.html for non-asset paths
  if (!path.extname(relative)) {
    return serveWebGuiFile(root, "/index.html")
  }

  return undefined
}

export function serveUIEffect(
  request: HttpServerRequest.HttpServerRequest,
  services: { fs: AppFileSystem.Interface; client: HttpClient.HttpClient },
) {
  return Effect.gen(function* () {
    const embeddedWebUI = yield* Effect.promise(() => embeddedUI())
    const url = new URL(request.url, "http://localhost")
    const requestPath = url.pathname

    // /app paths serve the new webgui (IDE plugin companion UI)
    if (requestPath === "/app" || requestPath.startsWith("/app/")) {
      const root = resolveWebGuiRoot()
      if (root) {
        const response = serveWebGui(root, requestPath)
        if (response) return response
      }
      return HttpServerResponse.jsonUnsafe({ error: "Not Found" }, { status: 404 })
    }

    if (embeddedWebUI) return yield* serveEmbeddedUIEffect(requestPath, services.fs, embeddedWebUI)

    const response = yield* services.client.execute(
      HttpClientRequest.make(request.method)(upstreamURL(requestPath), {
        headers: ProxyUtil.headers(request.headers, { host: UI_UPSTREAM.host }),
        body: requestBody(request),
      }),
    )
    const headers = proxyResponseHeaders(response.headers)

    if (response.headers["content-type"]?.includes("text/html")) {
      const body = yield* response.text
      headers.set("Content-Security-Policy", cspForHtml(body))
      return HttpServerResponse.text(body, { status: response.status, headers })
    }

    headers.set("Content-Security-Policy", csp())
    return HttpServerResponse.stream(response.stream.pipe(Stream.catchCause(() => Stream.empty)), {
      status: response.status,
      headers,
    })
  })
}
