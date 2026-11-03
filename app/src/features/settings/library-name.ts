import { t } from "@lingui/core/macro"
import { PROXY_PRESETS, type ProxyPreset, type ProxySettings } from "@owlit/protocol"

// A library owlit knows how to reach, by its name in the reader's language (PROXY_PRESETS names are
// English, for agents and logs)
export const proxyPresetName = (id: ProxyPreset): string => ({ tsinghua: t`Tsinghua University` })[id]


// The library the user signs in to through this proxy, when owlit knows its name
export const libraryNameOf = (proxy: ProxySettings | undefined): string | undefined => (proxy?.preset && proxy.preset in PROXY_PRESETS ? proxyPresetName(proxy.preset as ProxyPreset) : undefined)
