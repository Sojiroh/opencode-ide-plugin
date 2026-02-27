import { useState, useEffect, useMemo } from "react"
import { sdk } from "../lib/api/sdkClient"
import type { Command } from "@opencode-ai/sdk/client"

type CommandWithSource = Command & { source?: "command" | "mcp" | "skill" }

export interface CommandResult {
  id: string
  metadata: {
    name: string
    description?: string
    source?: "command" | "mcp" | "skill"
  }
}

let commandsCache: CommandWithSource[] | null = null
let commandsPromise: Promise<CommandWithSource[]> | null = null

export async function loadCommands() {
  if (commandsCache) {
    return commandsCache
  }

  if (commandsPromise) {
    return commandsPromise
  }

  commandsPromise = (async () => {
    try {
      const response = await sdk.command.list()
      commandsCache = (response.data ?? []) as CommandWithSource[]
      return commandsCache
    } catch (err) {
      console.error("[useCommandSearch] Failed to load commands:", err)
      return []
    }
  })()

  return commandsPromise.finally(() => {
    commandsPromise = null
  })
}

export function useCommandSearch(query: string) {
  const [isLoading, setIsLoading] = useState(!commandsCache)
  const [commands, setCommands] = useState<CommandWithSource[]>(() => commandsCache ?? [])

  useEffect(() => {
    let cancelled = false
    if (commandsCache) {
      setIsLoading(false)
      setCommands(commandsCache)
      return () => {
        cancelled = true
      }
    }

    setIsLoading(true)
    loadCommands()
      .then((loaded) => {
        if (cancelled) return
        setCommands(loaded)
      })
      .finally(() => {
        if (cancelled) return
        setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const results = useMemo(() => {
    if (commands.length === 0) return []

    const lowerQuery = query.toLowerCase()
    const filtered = commands.filter((cmd) => {
      const nameMatch = cmd.name.toLowerCase().includes(lowerQuery)
      const descMatch = cmd.description?.toLowerCase().includes(lowerQuery)
      return nameMatch || descMatch
    })

    return filtered.map((cmd) => ({
      id: `${cmd.source ?? "command"}:${cmd.name}`,
      metadata: {
        name: cmd.name,
        description: cmd.description,
        source: cmd.source,
      },
    }))
  }, [commands, query])

  return { results, isLoading }
}
