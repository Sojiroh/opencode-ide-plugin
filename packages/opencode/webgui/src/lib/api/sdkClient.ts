/**
 * OpenCode SDK client instance
 * Configured to connect to the OpenCode server at the default location.
 *
 * When `window.__OPENCODE_SERVER_URL__` is set (e.g. injected by the VS Code
 * gui-only plugin), all API requests target that absolute URL.  When absent,
 * relative URLs are used — identical to the original behaviour.
 */

import { createOpencodeClient } from "@opencode-ai/sdk/client"
import { ideBridge } from "../ideBridge"

export const serverBase: string =
  ((globalThis as any).__OPENCODE_SERVER_URL__ as string | undefined)?.replace(/\/$/, "") || ""

let serverDirectory: string | undefined

function requestHeaders(headers?: HeadersInit) {
  const next = new Headers(headers)
  if (serverDirectory && !next.has("x-opencode-directory")) {
    next.set("x-opencode-directory", serverDirectory)
  }
  return next
}

function serverFetch(path: string, init?: RequestInit) {
  return fetch(`${serverBase}${path}`, {
    ...init,
    headers: requestHeaders(init?.headers),
  })
}

const baseClient = createOpencodeClient({
  baseUrl: serverBase || "/",
  fetch: (request: Request) => {
    ;(request as any).timeout = false
    return fetch(new Request(request, { headers: requestHeaders(request.headers) }))
  },
})

export function setServerDirectory(directory: string | null | undefined) {
  serverDirectory = directory || undefined
}

interface ModelEntry {
  providerID: string
  modelID: string
}

interface ModelPreferences {
  recent: ModelEntry[]
  favorite: ModelEntry[]
  variant?: Record<string, string>
}

interface PathResponse {
  state: string
  config: string
  worktree: string
  directory: string
}

/**
 * Extended SDK client with state management methods
 * TODO: Remove once SDK is regenerated with Stainless
 */
export const sdk = {
  ...baseClient,
  session: Object.assign(baseClient.session, {
    retry: async (options: { path: { sessionID: string } }) => {
      try {
        const response = await serverFetch(`/app/api/session/${options.path.sessionID}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })

        if (!response.ok) {
          return { error: { message: "Failed to retry session" }, data: null }
        }

        const data = await response.json()
        return { data, error: null }
      } catch (error) {
        return {
          error: { message: error instanceof Error ? error.message : "Unknown error" },
          data: null,
        }
      }
    },
  }) as (typeof baseClient.session) & {
    retry: (options: { path: { sessionID: string } }) => Promise<any>
  },
  config: {
    get: baseClient.config.get.bind(baseClient.config),
    update: baseClient.config.update.bind(baseClient.config),
    providers: baseClient.config.providers.bind(baseClient.config),
  },
  path: {
    get: async () => {
      try {
        const response = await serverFetch("/path", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        })

        if (!response.ok) {
          return {
            error: { message: "Failed to fetch path" },
            data: null as PathResponse | null,
          }
        }

        const data = (await response.json()) as PathResponse
        return { data, error: null as { message: string } | null }
      } catch (error) {
        return {
          error: { message: error instanceof Error ? error.message : "Unknown error" },
          data: null as PathResponse | null,
        }
      }
    },
  },
  auth: {
    set: async (provider: string, value: any) => {
      const res = await serverFetch("/app/api/auth/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, value }),
      })
      if (!res.ok) throw new Error(await res.text())
    },
    list: async () => {
      const res = await serverFetch("/app/api/auth/list")
      return res.json() as Promise<Record<string, any>>
    },
    remove: async (provider: string) => {
      await serverFetch("/app/api/auth/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      })
    },
    methods: async (provider: string) => {
      const res = await serverFetch(`/app/api/auth/methods?provider=${provider}`)
      return res.json() as Promise<
        Array<{
          label: string
          type: "oauth" | "api"
          prompts?: any[]
        }>
      >
    },
    start: async (provider: string, methodIndex: number, inputs: any) => {
      const res = await serverFetch("/app/api/auth/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, methodIndex, inputs }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json() as Promise<{ id: string; url?: string; method: "auto" | "code"; instructions?: string }>
    },
    submit: async (id: string, code: string) => {
      const res = await serverFetch("/app/api/auth/login/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, code }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json() as Promise<boolean>
    },
    status: async (id: string) => {
      const res = await serverFetch(`/app/api/auth/login/status/${id}`)
      return res.json() as Promise<{ status: "pending" | "success" | "failed"; result?: any }>
    },
  },
  permissions: {
    respond: async (options: {
      path: { requestID: string }
      body: { reply: "once" | "always" | "reject"; message?: string }
    }) => {
      const response = await serverFetch(`/permission/${options.path.requestID}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.body),
      })
      if (!response.ok) {
        return { error: { message: "Failed to respond to permission" }, data: null }
      }
      const data = await response.json()
      return { data, error: null }
    },
  },
  question: {
    reply: async (options: { requestID: string; answers: Array<Array<string>> }) => {
      const response = await serverFetch(`/question/${options.requestID}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: options.answers }),
      })
      if (!response.ok) {
        return { error: { message: "Failed to reply to question" }, data: null }
      }
      const data = await response.json()
      return { data, error: null }
    },
    reject: async (options: { requestID: string }) => {
      const response = await serverFetch(`/question/${options.requestID}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      if (!response.ok) {
        return { error: { message: "Failed to reject question" }, data: null }
      }
      const data = await response.json()
      return { data, error: null }
    },
  },
  model: {
    get: async () => {
      if (!ideBridge.isInstalled()) return { data: { recent: [], favorite: [], variant: {} } as ModelPreferences, error: null as { message: string } | null }
      try {
        const res = await ideBridge.request("model.get")
        return { data: (res.payload ?? { recent: [], favorite: [], variant: {} }) as ModelPreferences, error: null as { message: string } | null }
      } catch (error) {
        return { error: { message: error instanceof Error ? error.message : "Unknown error" }, data: null as ModelPreferences | null }
      }
    },
    update: async (options: { body: Partial<ModelPreferences> }) => {
      if (!ideBridge.isInstalled()) return { data: null as ModelPreferences | null, error: { message: "IdeBridge not available" } }
      try {
        const res = await ideBridge.request("model.update", options.body)
        return { data: (res.payload ?? { recent: [], favorite: [], variant: {} }) as ModelPreferences, error: null as { message: string } | null }
      } catch (error) {
        return { error: { message: error instanceof Error ? error.message : "Unknown error" }, data: null as ModelPreferences | null }
      }
    },
  },
  kv: {
    get: async () => {
      if (!ideBridge.isInstalled()) return { data: {} as Record<string, any>, error: null as { message: string } | null }
      try {
        const res = await ideBridge.request("kv.get")
        return { data: (res.payload ?? {}) as Record<string, any>, error: null as { message: string } | null }
      } catch (error) {
        return { error: { message: error instanceof Error ? error.message : "Unknown error" }, data: null as Record<string, any> | null }
      }
    },
    update: async (options: { body: Record<string, any> }) => {
      if (!ideBridge.isInstalled()) return { data: null as Record<string, any> | null, error: { message: "IdeBridge not available" } }
      try {
        const res = await ideBridge.request("kv.update", options.body)
        return { data: (res.payload ?? {}) as Record<string, any>, error: null as { message: string } | null }
      } catch (error) {
        return { error: { message: error instanceof Error ? error.message : "Unknown error" }, data: null as Record<string, any> | null }
      }
    },
  },
}
