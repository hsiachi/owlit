import { describe, expect, it } from "vitest"
import { hasUnspaced, lineJoint } from "./line-joins.ts"

describe("lineJoint", () => {
  it("puts nothing between two Chinese characters", () => {
    expect(lineJoint("检索增强", "生成方法")).toBe("")
    expect(lineJoint("我们提出了一种", "新的方法。")).toBe("")
  })

  it("puts nothing between Han characters outside the BMP", () => {
    expect(lineJoint("姓\u{20BB7}", "\u{20BB7}家")).toBe("")
  })

  it("puts nothing after CJK punctuation before a character", () => {
    expect(lineJoint("在本文中，", "我们")).toBe("")
    expect(lineJoint("「検索", "」と")).toBe("")
  })

  it("puts a space where either side is a spaced script", () => {
    expect(lineJoint("使用", "Transformer")).toBe(" ")
    expect(lineJoint("the method", "works")).toBe(" ")
    expect(lineJoint("한국어", "문장")).toBe(" ")
  })
})

describe("hasUnspaced", () => {
  it("finds Chinese and Japanese, not Korean or English", () => {
    expect(hasUnspaced("检索增强生成")).toBe(true)
    expect(hasUnspaced("カタカナ")).toBe(true)
    expect(hasUnspaced("한국어 문장")).toBe(false)
    expect(hasUnspaced("retrieval augmented")).toBe(false)
  })
})
