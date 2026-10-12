// How much of the top bar's left end the window's own controls need (macOS traffic lights), as the
// desktop app reports it: room for them in a normal window, none in full screen or in a browser.

import { create } from "zustand"
import { bridge } from "./rpc"

export const useControlsRoom = create<{ room: number }>(() => ({ room: bridge?.controlsRoom ?? 0 }))

bridge?.onControlsRoom((room) => useControlsRoom.setState({ room }))
