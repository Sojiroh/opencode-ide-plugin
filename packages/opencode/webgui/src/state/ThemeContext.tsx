import { createContext, useContext, useState, useEffect, type ReactNode } from "react"
import { ideBridge, type IdeBridgeSettings } from "../lib/ideBridge"

type Theme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function systemTheme(): Theme {
  if (typeof window === "undefined") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function parseTheme(value: unknown): Theme | null {
  if (value === "light" || value === "dark") return value
  return null
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => systemTheme())

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [theme])

  useEffect(() => {
    if (!ideBridge.isInstalled()) return

    const apply = (settings: IdeBridgeSettings | null | undefined) => {
      const next = parseTheme(settings?.theme)
      if (!next) return
      setTheme(next)
    }

    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ settings?: IdeBridgeSettings | null }>).detail
      apply(detail?.settings)
    }

    window.addEventListener("opencode:ui-bridge-settings", handler)
    void ideBridge.getSettings().then((settings) => apply(settings))

    return () => {
      window.removeEventListener("opencode:ui-bridge-settings", handler)
    }
  }, [])

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light"
      if (ideBridge.isInstalled()) {
        void ideBridge.updateSettings({ theme: next })
      }
      return next
    })
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider")
  }
  return context
}
