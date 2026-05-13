import type { ReactNode } from "react"
import { render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import type { ConnectionState } from "./lib/api/events"

const {
  mockLoadSessions,
  mockLoadSessionMessages,
  mockSwitchSession,
  mockShowToast,
  mockRestoreSelections,
  mockClearError,
  mockUiBridgeUpdate,
  streamState,
  bridgeState,
  sessionState,
  projectState,
} = vi.hoisted(() => ({
  mockLoadSessions: vi.fn<() => Promise<void>>(),
  mockLoadSessionMessages: vi.fn<(sessionID: string) => Promise<void>>(),
  mockSwitchSession: vi.fn<(sessionID: string) => Promise<void>>(),
  mockShowToast: vi.fn(),
  mockRestoreSelections: vi.fn(),
  mockClearError: vi.fn(),
  mockUiBridgeUpdate: vi.fn(),
  streamState: {
    connectionState: "connecting" as ConnectionState,
    emitter: null,
  },
  bridgeState: {
    sessionID: undefined as string | undefined,
    providerId: null as string | null,
    modelId: null as string | null,
    agent: null as string | null,
    variant: null as string | null,
  },
  sessionState: {
    currentSession: { id: "session-1", title: "Session 1", time: { created: 1, updated: 1 } },
    sessions: [] as Array<{ id: string; title: string; time: { created: number; updated: number } }>,
  },
  projectState: {
    worktree: "/tmp/project" as string | null,
  },
}))

vi.mock("./lib/api/events", () => ({
  useEventStream: vi.fn(() => ({
    connectionState: streamState.connectionState,
    emitter: streamState.emitter,
  })),
  useEventHandler: vi.fn(),
  eventEmitter: { emit: vi.fn() },
}))

vi.mock("./lib/api/useSessionEvents", () => ({
  useSessionEvents: vi.fn(),
}))

vi.mock("./lib/api/sdkClient", () => ({
  serverBase: "http://localhost:4096",
}))

vi.mock("./state/SessionContext", () => ({
  useSession: vi.fn(() => ({
    currentSession: sessionState.currentSession,
    sessions: sessionState.sessions,
    newVirtual: vi.fn(),
    switchSession: mockSwitchSession,
    isCreating: false,
    error: null,
    clearError: mockClearError,
    restoreSelections: mockRestoreSelections,
    loadSessions: mockLoadSessions,
  })),
}))

vi.mock("./state/MessagesContext", () => ({
  useMessages: vi.fn(() => ({
    loadSessionMessages: mockLoadSessionMessages,
  })),
  MessagesProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock("./state/ProjectContext", () => ({
  useProject: vi.fn(() => ({ worktree: projectState.worktree })),
}))

vi.mock("./state/ToastContext", () => ({
  useToast: vi.fn(() => ({ showToast: mockShowToast })),
}))

vi.mock("./state/ThemeContext", () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}))

vi.mock("./components/MessageList", () => ({
  MessageList: () => null,
}))

vi.mock("./components/OfflineBanner", () => ({
  OfflineBanner: () => null,
}))

vi.mock("./components/CommandPalette", () => ({
  CommandPalette: () => null,
}))

vi.mock("./components/KeyboardShortcutsHelp", () => ({
  KeyboardShortcutsHelp: () => null,
}))

vi.mock("./hooks/useKeyboardShortcuts", () => ({
  useKeyboardShortcuts: vi.fn(),
}))

vi.mock("./lib/ideBridge", () => ({
  ideBridge: {
    on: vi.fn(),
    off: vi.fn(),
  },
}))

vi.mock("./lib/dnd", () => ({
  extractPathsFromDrop: vi.fn(() => []),
}))

vi.mock("./lib/keyboardHandler", () => ({
  initKeyboardHandler: vi.fn(() => ({ destroy: vi.fn() })),
  destroyKeyboardHandler: vi.fn(),
}))

vi.mock("./state/uiBridgeState", () => ({
  uiBridgeSubscribe: vi.fn((callback: (state: typeof bridgeState) => void) => {
    callback({ ...bridgeState })
    return () => {}
  }),
  uiBridgeUpdate: mockUiBridgeUpdate,
}))

vi.mock("./components/MessageInput", async () => {
  const React = await import("react")
  return {
    MessageInput: React.forwardRef(() => null),
  }
})

vi.mock("./components/CompactHeader", async () => {
  const React = await import("react")
  return {
    CompactHeader: React.forwardRef(() => null),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  streamState.connectionState = "connecting"
  bridgeState.sessionID = undefined
  bridgeState.providerId = null
  bridgeState.modelId = null
  bridgeState.agent = null
  bridgeState.variant = null
  projectState.worktree = "/tmp/project"
  sessionState.currentSession = { id: "session-1", title: "Session 1", time: { created: 1, updated: 1 } }
  sessionState.sessions = []
  mockLoadSessions.mockResolvedValue(undefined)
  mockLoadSessionMessages.mockResolvedValue(undefined)
  mockSwitchSession.mockResolvedValue(undefined)
})

describe("App reconnect bootstrap", () => {
  it("reloads sessions and current session messages when the connection is restored", async () => {
    const view = render(<App />)

    await waitFor(() => {
      expect(mockLoadSessionMessages).toHaveBeenCalledWith("session-1")
    })

    mockLoadSessions.mockClear()
    mockLoadSessionMessages.mockClear()

    streamState.connectionState = "connected"
    view.rerender(<App />)

    await waitFor(() => {
      expect(mockLoadSessions).toHaveBeenCalledTimes(1)
    })

    expect(mockLoadSessionMessages).toHaveBeenCalledWith("session-1")
  })

  it("retries restoring the bridge session when reconnecting after startup failure", async () => {
    bridgeState.sessionID = "session-2"
    sessionState.currentSession = { id: "virtual-1", title: "", time: { created: 1, updated: 1 } }

    const view = render(<App />)

    await waitFor(() => {
      expect(mockSwitchSession).toHaveBeenCalledWith("session-2")
    })

    mockLoadSessions.mockClear()
    mockLoadSessionMessages.mockClear()
    mockSwitchSession.mockClear()

    streamState.connectionState = "connected"
    view.rerender(<App />)

    await waitFor(() => {
      expect(mockLoadSessions).toHaveBeenCalledTimes(1)
    })

    expect(mockSwitchSession).toHaveBeenCalledWith("session-2")
    expect(mockLoadSessionMessages).not.toHaveBeenCalled()
  })
})
