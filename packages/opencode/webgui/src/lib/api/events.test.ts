import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useEventStream } from "./events"

vi.mock("./sdkClient", () => ({
  serverBase: "",
}))

class MockEventSource {
  static instances: MockEventSource[] = []

  url: string
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  readyState = 0
  close = vi.fn(() => {
    this.readyState = 2
  })

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  emitOpen() {
    this.readyState = 1
    this.onopen?.()
  }

  emitMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent<string>)
  }

  emitError() {
    this.onerror?.(new Event("error"))
  }
}

describe("useEventStream", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    MockEventSource.instances = []
    vi.stubGlobal("EventSource", MockEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("keeps the browser-managed EventSource alive on transient errors", () => {
    const { result } = renderHook(() => useEventStream())

    expect(MockEventSource.instances).toHaveLength(1)
    expect(result.current.connectionState).toBe("connecting")

    const stream = MockEventSource.instances[0]

    act(() => {
      stream.emitOpen()
      stream.emitMessage(JSON.stringify({ type: "server.connected", properties: {} }))
    })

    expect(result.current.connectionState).toBe("connected")

    act(() => {
      stream.emitError()
    })

    expect(result.current.connectionState).toBe("connecting")
    expect(stream.close).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(5_000)
    })

    expect(MockEventSource.instances).toHaveLength(1)
  })

  it("unwraps global events and filters other directories", () => {
    const { result } = renderHook(() =>
      useEventStream({
        url: "/global/event",
        directory: "/tmp/project",
      }),
    )
    const handler = vi.fn()
    const unsubscribe = result.current.emitter.on("*", handler)
    const stream = MockEventSource.instances[0]

    act(() => {
      stream.emitMessage(
        JSON.stringify({
          directory: "/tmp/other",
          payload: { type: "session.created", properties: { sessionID: "ignored", info: { id: "ignored" } } },
        }),
      )
    })

    expect(handler).not.toHaveBeenCalled()

    act(() => {
      stream.emitMessage(
        JSON.stringify({
          directory: "/tmp/project",
          payload: { type: "session.created", properties: { sessionID: "kept", info: { id: "kept" } } },
        }),
      )
      stream.emitMessage(JSON.stringify({ payload: { type: "server.connected", properties: {} } }))
    })

    expect(handler).toHaveBeenNthCalledWith(1, {
      type: "session.created",
      properties: { sessionID: "kept", info: { id: "kept" } },
    })
    expect(handler).toHaveBeenNthCalledWith(2, {
      type: "server.connected",
      properties: {},
    })

    unsubscribe()
  })
})
