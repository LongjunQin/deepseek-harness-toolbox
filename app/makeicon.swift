// 生成 1024x1024 图标 PNG:深蓝渐变圆角底 + 鲸鱼 emoji
// 用法: swift makeicon.swift <输出.png>
import AppKit

let out = CommandLine.arguments[1]
let S: CGFloat = 1024
let image = NSImage(size: NSSize(width: S, height: S))
image.lockFocus()

let inset = NSRect(x: 0, y: 0, width: S, height: S).insetBy(dx: 60, dy: 60)
let path = NSBezierPath(roundedRect: inset, xRadius: 200, yRadius: 200)
let gradient = NSGradient(
  starting: NSColor(calibratedRed: 0.32, green: 0.44, blue: 1.00, alpha: 1),
  ending: NSColor(calibratedRed: 0.13, green: 0.20, blue: 0.72, alpha: 1))!
gradient.draw(in: path, angle: -90)

let str = NSAttributedString(string: "🐋", attributes: [.font: NSFont.systemFont(ofSize: 540)])
let sz = str.size()
str.draw(at: NSPoint(x: (S - sz.width) / 2, y: (S - sz.height) / 2))

image.unlockFocus()

let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: out))
print("icon written: \(out)")
