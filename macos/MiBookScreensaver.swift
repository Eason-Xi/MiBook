import SwiftUI
import AppKit
import UniformTypeIdentifiers

enum ScreensaverError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

enum CanvasOrientation: String, Codable, CaseIterable {
    case portrait, landscape
    var size: CGSize { self == .landscape ? CGSize(width: 1872, height: 1404) : CGSize(width: 1404, height: 1872) }
    var label: String { self == .landscape ? "横屏" : "竖屏" }
}

struct ImageAdjustments: Codable {
    var orientation: CanvasOrientation = .portrait
    var fill = true
    var grayscale = true
    var zoom = 1.0
    var rotation = 0
    var x = 0.0
    var y = 0.0
}

struct EditorDocument: Codable {
    var filename: String
    var adjustments: ImageAdjustments
}

enum ImageRenderer {
    static func travel(_ source: NSImage, _ settings: ImageAdjustments) -> CGSize {
        let rotated = settings.rotation % 2 != 0
        let sw = rotated ? source.size.height : source.size.width
        let sh = rotated ? source.size.width : source.size.height
        let canvas = settings.orientation.size
        let factor = (settings.fill ? max(canvas.width / sw, canvas.height / sh) : min(canvas.width / sw, canvas.height / sh)) * settings.zoom
        return CGSize(width: abs(sw * factor - canvas.width) / 2, height: abs(sh * factor - canvas.height) / 2)
    }
    static func render(_ source: NSImage, settings: ImageAdjustments, resolution: CGFloat = 1, device: Bool = false) throws -> Data {
        let canvas = settings.orientation.size
        let w = Int((canvas.width * resolution).rounded()), h = Int((canvas.height * resolution).rounded())
        guard source.size.width > 0, source.size.height > 0,
              let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
            throw ScreensaverError.message("无法读取这张图片，请换一张图片。")
        }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        NSColor.white.setFill(); NSRect(x: 0, y: 0, width: w, height: h).fill()
        context.imageInterpolation = .high
        let rotated = settings.rotation % 2 != 0
        let sw = rotated ? source.size.height : source.size.width
        let sh = rotated ? source.size.width : source.size.height
        let factor = (settings.fill ? max(CGFloat(w) / sw, CGFloat(h) / sh) : min(CGFloat(w) / sw, CGFloat(h) / sh)) * settings.zoom
        let movement = travel(source, settings)
        let transform = NSAffineTransform()
        transform.translateX(by: CGFloat(w) / 2 + settings.x * movement.width * resolution,
            yBy: CGFloat(h) / 2 - settings.y * movement.height * resolution)
        transform.rotate(byDegrees: CGFloat(-90 * settings.rotation))
        transform.concat()
        source.draw(in: NSRect(x: -source.size.width * factor / 2, y: -source.size.height * factor / 2,
            width: source.size.width * factor, height: source.size.height * factor), from: .zero, operation: .sourceOver, fraction: 1)
        NSGraphicsContext.restoreGraphicsState()
        if settings.grayscale, let pixels = bitmap.bitmapData {
            for y in 0..<h { for x in 0..<w {
                let p = y * bitmap.bytesPerRow + x * 4
                let value = UInt8((77 * Int(pixels[p]) + 150 * Int(pixels[p + 1]) + 29 * Int(pixels[p + 2]) + 128) >> 8)
                pixels[p] = value; pixels[p + 1] = value; pixels[p + 2] = value
            } }
        }
        // The firmware's suspend canvas is portrait. Encode a landscape composition
        // clockwise into that canvas, without cropping or stretching its logical pixels.
        if device && settings.orientation == .landscape {
            guard let physical = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: h, pixelsHigh: w,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
                let src = bitmap.bitmapData, let dst = physical.bitmapData else {
                throw ScreensaverError.message("无法转换横屏图片。")
            }
            for y in 0..<h { for x in 0..<w {
                let from = y * bitmap.bytesPerRow + x * 4
                let to = x * physical.bytesPerRow + (h - 1 - y) * 4
                for channel in 0..<4 { dst[to + channel] = src[from + channel] }
            } }
            guard let png = physical.representation(using: .png, properties: [:]) else { throw ScreensaverError.message("无法编码屏保。") }
            return png
        }
        guard let png = bitmap.representation(using: .png, properties: [:]) else { throw ScreensaverError.message("无法转换图片。") }
        return png
    }
    static func verify() throws {
        func require(_ condition: Bool, _ message: String) throws {
            if !condition { throw ScreensaverError.message(message) }
        }
        let source = NSImage(size: NSSize(width: 400, height: 200), flipped: false) { rect in
            NSColor.red.setFill(); NSRect(x: 0, y: 0, width: 200, height: 200).fill()
            NSColor.blue.setFill(); NSRect(x: 200, y: 0, width: 200, height: 200).fill()
            NSColor.green.setFill(); NSRect(x: 0, y: 100, width: 100, height: 100).fill()
            return true
        }
        func bitmap(_ settings: ImageAdjustments, device: Bool = false) throws -> NSBitmapImageRep {
            guard let result = NSBitmapImageRep(data: try render(source, settings: settings, device: device)) else {
                throw ScreensaverError.message("Invalid test PNG")
            }
            return result
        }
        var settings = ImageAdjustments()
        for orientation in CanvasOrientation.allCases {
            settings.orientation = orientation
            for fill in [false, true] {
                settings.fill = fill
                let image = try bitmap(settings)
                try require(image.pixelsWide == Int(orientation.size.width) && image.pixelsHigh == Int(orientation.size.height), "Canvas dimensions")
                let edge = image.colorAt(x: 10, y: 10)!.usingColorSpace(.deviceRGB)!
                let center = image.colorAt(x: image.pixelsWide / 2, y: image.pixelsHigh / 2)!.usingColorSpace(.deviceRGB)!
                try require(abs(center.redComponent - center.greenComponent) < 0.01 && abs(center.greenComponent - center.blueComponent) < 0.01, "Grayscale")
                try require(fill ? edge.redComponent < 0.99 : edge.redComponent > 0.99, "Fit margins / fill cropping")
            }
        }
        settings = ImageAdjustments(orientation: .landscape, grayscale: false)
        let logical = try bitmap(settings), physical = try bitmap(settings, device: true)
        try require(physical.pixelsWide == 1404 && physical.pixelsHigh == 1872, "Device upload dimensions")
        for (x, y) in [(10, 10), (1800, 10), (20, 1300), (1800, 1300), (936, 702)] {
            let a = logical.colorAt(x: x, y: y)!.usingColorSpace(.deviceRGB)!
            let b = physical.colorAt(x: logical.pixelsHigh - 1 - y, y: x)!.usingColorSpace(.deviceRGB)!
            try require(abs(a.redComponent - b.redComponent) < 0.01 && abs(a.greenComponent - b.greenComponent) < 0.01 && abs(a.blueComponent - b.blueComponent) < 0.01, "Landscape pixels preserved")
        }
        settings = ImageAdjustments(grayscale: false, x: 1)
        let panned = try bitmap(settings)
        let center = panned.colorAt(x: 702, y: 936)!.usingColorSpace(.deviceRGB)!
        try require(center.redComponent > 0.9 && center.blueComponent < 0.1, "Pan changes crop subject")
        settings.zoom = 2
        let zoomed = try bitmap(settings)
        try require(zoomed.colorAt(x: 1000, y: 936)!.usingColorSpace(.deviceRGB)!.redComponent > 0.9, "Zoom respects pan")
        settings = ImageAdjustments(orientation: .landscape, fill: false, grayscale: false, rotation: 1)
        let rotated = try bitmap(settings)
        try require(rotated.colorAt(x: 800, y: 100)!.usingColorSpace(.deviceRGB)!.redComponent > 0.9
            && rotated.colorAt(x: 800, y: 1300)!.usingColorSpace(.deviceRGB)!.blueComponent > 0.9, "Clockwise quarter-turn")
        let restored = try JSONDecoder().decode(ImageAdjustments.self, from: JSONEncoder().encode(settings))
        try require(restored.orientation == .landscape && restored.rotation == 1 && !restored.fill, "Edit persistence")
        if let index = CommandLine.arguments.firstIndex(of: "--test-output"), index + 1 < CommandLine.arguments.count {
            let folder = URL(fileURLWithPath: CommandLine.arguments[index + 1])
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let landscape = ImageAdjustments(orientation: .landscape, grayscale: false)
            try render(source, settings: landscape).write(to: folder.appendingPathComponent("landscape.png"))
            try render(source, settings: landscape, device: true).write(to: folder.appendingPathComponent("device.png"))
        }
        print("PASS: portrait/landscape canvases, fill/fit, grayscale, pan, zoom, rotation, lossless device encoding and edit persistence")
    }
}

@MainActor final class ScreensaverModel: ObservableObject {
    @Published var source: NSImage?
    @Published var preview: NSImage?
    @Published var filename = "尚未选择图片"
    @Published var adjustments = ImageAdjustments() { didSet { scheduleRender() } }
    @Published var sourceSize = ""
    private var editorFolder: URL?
    private var renderWork: DispatchWorkItem?
    @Published var online = false
    @Published var serverOK = false
    @Published var rootReady = false
    @Published var rebootPending = false
    @Published var busy = false
    @Published var message = "正在连接 Mac 同步服务…"
    @Published var isError = false
    private var token = ""
    private var port = 48763
    private var polling = false
    private var timer: Timer?

    init() {
        do {
            guard let resource = Bundle.main.url(forResource: "project-root", withExtension: "txt") else {
                throw ScreensaverError.message("缺少项目路径，请重新构建 Mac 工具。")
            }
            let root = try String(contentsOf: resource, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
            let data = try Data(contentsOf: URL(fileURLWithPath: root).appendingPathComponent(".state/wifi-config.json"))
            let config = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            guard let value = config?["token"] as? String, value.count == 64,
                  let number = config?["port"] as? Int else { throw ScreensaverError.message("尚未与阅读器配对。") }
            token = value; port = number
            // Reopen the last sent image without changing its pixels.
            let folder = URL(fileURLWithPath: root).appendingPathComponent(".state/screensaver")
            editorFolder = folder
            if let documentData = try? Data(contentsOf: folder.appendingPathComponent("editor.json")),
               let document = try? JSONDecoder().decode(EditorDocument.self, from: documentData),
               let imageData = try? Data(contentsOf: folder.appendingPathComponent("editor-source.image")),
               let image = NSImage(data: imageData) {
                source = image; filename = document.filename; adjustments = document.adjustments; render()
            } else if let saved = try? Data(contentsOf: folder.appendingPathComponent("command.json")),
               let command = (try? JSONSerialization.jsonObject(with: saved)) as? [String: Any],
               command["action"] as? String == "image", let id = command["id"] as? String,
               UUID(uuidString: id) != nil,
               let last = NSImage(contentsOf: folder.appendingPathComponent(id + ".png")) {
                try Data(contentsOf: folder.appendingPathComponent(id + ".png"))
                    .write(to: folder.appendingPathComponent("editor-source.image"), options: .atomic)
                source = last; filename = "上次发送的图片"; render()
            }
            Task { await poll() }
            timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
                Task { @MainActor in await self?.poll() }
            }
        } catch { fail(error.localizedDescription) }
    }
    private func fail(_ text: String) { message = text; isError = true }
    func choose() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]; panel.allowsMultipleSelection = false
        panel.prompt = "选择图片"
        if panel.runModal() == .OK, let url = panel.url {
            guard let image = NSImage(contentsOf: url) else { fail("无法打开这张图片。"); return }
            source = image; filename = url.lastPathComponent
            adjustments = ImageAdjustments(orientation: image.size.width > image.size.height ? .landscape : .portrait)
            if let editorFolder {
                do {
                    try FileManager.default.createDirectory(at: editorFolder, withIntermediateDirectories: true)
                    try Data(contentsOf: url).write(to: editorFolder.appendingPathComponent("editor-source.image"), options: .atomic)
                } catch { fail("无法保存编辑原图：" + error.localizedDescription) }
            }
            render()
        }
    }
    func scheduleRender() {
        renderWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.render() }
        renderWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.025, execute: work)
    }
    func render() {
        guard let source else { return }
        do {
            preview = NSImage(data: try ImageRenderer.render(source, settings: adjustments, resolution: 0.3))
            sourceSize = "原图 \(Int(source.size.width)) × \(Int(source.size.height))"
            if let editorFolder {
                let document = EditorDocument(filename: filename, adjustments: adjustments)
                try JSONEncoder().encode(document).write(to: editorFolder.appendingPathComponent("editor.json"), options: .atomic)
            }
        } catch { preview = nil; fail(error.localizedDescription) }
    }
    func reset() {
        let orientation = adjustments.orientation
        let grayscale = adjustments.grayscale
        adjustments = ImageAdjustments(orientation: orientation, grayscale: grayscale)
    }
    func changeOrientation(_ orientation: CanvasOrientation) {
        adjustments.orientation = orientation
        adjustments.zoom = 1; adjustments.x = 0; adjustments.y = 0
    }
    func rotate() {
        adjustments.rotation = (adjustments.rotation + 1) % 4
        adjustments.x = 0; adjustments.y = 0
    }
    func move(from origin: CGSize, translation: CGSize, previewSize: CGSize) {
        guard let source else { return }
        let travel = ImageRenderer.travel(source, adjustments)
        let canvas = adjustments.orientation.size
        if travel.width > 0.5 {
            adjustments.x = max(-1, min(1, origin.width + translation.width * canvas.width / previewSize.width / travel.width))
        }
        if travel.height > 0.5 {
            adjustments.y = max(-1, min(1, origin.height + translation.height * canvas.height / previewSize.height / travel.height))
        }
    }
    private func request(_ path: String, data: Data? = nil) async throws -> [String: Any] {
        guard !token.isEmpty, let url = URL(string: "http://127.0.0.1:\(port)\(path)") else {
            throw ScreensaverError.message("请先完成阅读器 Wi-Fi 配对。")
        }
        var req = URLRequest(url: url, timeoutInterval: data == nil ? 10 : 60)
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        if let data {
            req.httpMethod = "POST"; req.httpBody = data
            req.setValue(path.hasSuffix("/image") ? "image/png" : "application/json", forHTTPHeaderField: "Content-Type")
        }
        let (body, response) = try await URLSession.shared.data(for: req)
        guard let response = response as? HTTPURLResponse else { throw ScreensaverError.message("Mac 服务没有响应。") }
        let value = (try? JSONSerialization.jsonObject(with: body)) as? [String: Any] ?? [:]
        guard (200..<300).contains(response.statusCode) else {
            throw ScreensaverError.message(value["error"] as? String ?? "Mac 服务需要升级或重启。")
        }
        return value
    }
    func send(_ action: String) {
        guard !busy, !rebootPending, rootReady, action != "image" || source != nil else { return }
        let body: Data
        do { body = action == "image" ? try ImageRenderer.render(source!, settings: adjustments, device: true) : Data("{}".utf8) }
        catch { fail(error.localizedDescription); return }
        busy = true; isError = false; message = "正在准备屏保资源…"
        Task {
            do {
                _ = try await request("/screensaver/" + action, data: body)
                message = "已排队，阅读器接收后将自动重启一次…"
                await poll()
            } catch { fail(error.localizedDescription) }
            busy = false
        }
    }
    func poll() async {
        guard !polling else { return }
        polling = true; defer { polling = false }
        do {
            let value = try await request("/screensaver/status")
            serverOK = true; online = value["online"] as? Bool ?? false
            if let reader = value["reader"] as? [String: Any] {
                rootReady = reader["protocolVersion"] as? Int == 2 && reader["rootAvailable"] as? Bool == true
            }
            rebootPending = false
            if let command = value["command"] as? [String: Any], let id = command["id"] as? String,
               command["method"] as? String == "magisk-overlay" {
                if let report = value["report"] as? [String: Any], report["id"] as? String == id {
                    let status = report["status"] as? String
                    rebootPending = status == "pending_reboot"
                    isError = status == "error"
                    message = report["message"] as? String ?? "等待阅读器确认…"
                    if rebootPending, let at = report["at"] as? Double, Date().timeIntervalSince1970 * 1000 - at > 90000 {
                        message = "等待重启后确认。若已开机，请打开「AI 用量」完成校验。"
                    }
                } else if !busy {
                    isError = false
                    message = online ? "等待接收，随后会自动重启阅读器…" : "已排队。请唤醒阅读器并打开「AI 用量」，接收后会自动重启。"
                }
            } else if !busy {
                isError = false
                message = !rootReady ? "请打开新版「AI 用量」，并在 Magisk 中允许其使用 Root。" :
                    (online ? "阅读器已连接，可以更换屏保。" : "请在同一 Wi-Fi 下唤醒阅读器，并打开「AI 用量」。")
            }
        } catch {
            serverOK = false; online = false
            if !busy { fail("连接不到 Mac 同步服务。请确认同步服务正在运行。") }
        }
    }
    func export() {
        guard let source else { return }
        let panel = NSSavePanel(); panel.allowedContentTypes = [.png]
        panel.nameFieldStringValue = "小米屏保-" + adjustments.orientation.label + ".png"
        if panel.runModal() == .OK, let url = panel.url {
            do { try ImageRenderer.render(source, settings: adjustments).write(to: url) }
            catch { fail(error.localizedDescription) }
        }
    }
}

struct ScreensaverView: View {
    @StateObject private var model = ScreensaverModel()
    @State private var dragOrigin: CGSize?
    private var landscape: Bool { model.adjustments.orientation == .landscape }
    private var previewSize: CGSize { landscape ? CGSize(width: 432, height: 324) : CGSize(width: 324, height: 432) }
    var body: some View {
        HStack(alignment: .center, spacing: 36) {
            VStack(spacing: 18) {
                HStack {
                    Text("屏保预览").font(.system(size: 13, weight: .medium))
                    Spacer()
                    Text(model.adjustments.orientation.label + " · " + (landscape ? "1872 × 1404" : "1404 × 1872"))
                        .font(.system(size: 12, design: .monospaced)).foregroundStyle(.secondary)
                }
                ZStack {
                    RoundedRectangle(cornerRadius: 20).fill(Color(white: 0.15))
                        .frame(width: previewSize.width + 28, height: previewSize.height + 28)
                        .shadow(color: .black.opacity(0.12), radius: 14, y: 8)
                    ZStack {
                        Color.white
                        if let image = model.preview { Image(nsImage: image).resizable().scaledToFit() }
                        else {
                            VStack(spacing: 16) {
                                Image(systemName: "photo").font(.system(size: 44, weight: .ultraLight))
                                Text("你的下一张屏保").font(.system(size: 17))
                                Text("选择横屏或竖屏图片开始调整").font(.system(size: 12)).foregroundStyle(.secondary)
                            }.foregroundStyle(Color.black.opacity(0.6))
                        }
                    }.frame(width: previewSize.width, height: previewSize.height).clipped()
                        .contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 0).onChanged { value in
                            guard !model.busy else { return }
                            if dragOrigin == nil { dragOrigin = CGSize(width: model.adjustments.x, height: model.adjustments.y) }
                            model.move(from: dragOrigin!, translation: value.translation, previewSize: previewSize)
                        }.onEnded { _ in dragOrigin = nil })
                        .help("拖动画面调整位置；需要更大移动范围时，可先放大图片")
                        .accessibilityLabel("屏保构图预览")
                }.frame(height: 470)
                Text(model.source == nil ? "支持 JPG、PNG、HEIC 等图片" : "拖动画面调整位置 · 右侧可缩放和旋转")
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }.frame(width: 470)
            VStack(alignment: .leading, spacing: 13) {
                Text("小米屏保").font(.system(size: 28, weight: .semibold))
                HStack(spacing: 7) {
                    Circle().fill(model.online ? .green : .orange).frame(width: 7, height: 7)
                    Text(model.online ? "多看 Pro · 已连接" : "多看 Pro · 等待连接").font(.system(size: 12, weight: .medium))
                    Spacer()
                    Button { Task { await model.poll() } } label: { Image(systemName: "arrow.clockwise") }
                        .buttonStyle(.borderless).help("刷新连接状态")
                }
                Divider()
                HStack {
                    Button(action: model.choose) { Label("选择图片…", systemImage: "photo.on.rectangle") }
                        .controlSize(.large).disabled(model.busy)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(model.filename).lineLimit(1).truncationMode(.middle)
                        if !model.sourceSize.isEmpty { Text(model.sourceSize).foregroundStyle(.secondary) }
                    }.font(.caption)
                }
                VStack(alignment: .leading, spacing: 7) {
                    Text("屏保方向").font(.caption).foregroundStyle(.secondary)
                    Picker("屏保方向", selection: Binding(get: { model.adjustments.orientation }, set: model.changeOrientation)) {
                        Text("竖屏").tag(CanvasOrientation.portrait); Text("横屏").tag(CanvasOrientation.landscape)
                    }.pickerStyle(.segmented).labelsHidden()
                }.disabled(model.busy)
                Picker("画面适配", selection: $model.adjustments.fill) {
                    Text("铺满裁切").tag(true); Text("完整留白").tag(false)
                }.pickerStyle(.segmented).disabled(model.busy || model.source == nil)
                VStack(spacing: 10) {
                    HStack {
                        Text("缩放")
                        Slider(value: $model.adjustments.zoom, in: 1...3).accessibilityLabel("缩放")
                        Text("\(Int(model.adjustments.zoom * 100))%").monospacedDigit().frame(width: 42, alignment: .trailing)
                    }
                    HStack {
                        Text("左右")
                        Slider(value: $model.adjustments.x, in: -1...1).accessibilityLabel("左右位置")
                        Button("居中") { model.adjustments.x = 0 }.buttonStyle(.borderless)
                    }
                    HStack {
                        Text("上下")
                        Slider(value: $model.adjustments.y, in: -1...1).accessibilityLabel("上下位置")
                        Button("居中") { model.adjustments.y = 0 }.buttonStyle(.borderless)
                    }
                    HStack {
                        Button(action: model.rotate) { Label("旋转 90°", systemImage: "rotate.right") }
                        Spacer()
                        Button("复位构图", action: model.reset)
                    }
                }.font(.system(size: 12)).disabled(model.busy || model.source == nil)
                Toggle("转为黑白灰度", isOn: $model.adjustments.grayscale).font(.system(size: 12)).disabled(model.busy)
                Button { model.send("image") } label: {
                    HStack { if model.busy { ProgressView().controlSize(.small) }; Text("应用并重启阅读器").frame(maxWidth: .infinity) }
                }.buttonStyle(.borderedProminent).controlSize(.large)
                    .disabled(model.preview == nil || model.busy || !model.serverOK || !model.rootReady || model.rebootPending)
                Text(model.message).font(.system(size: 12)).foregroundStyle(model.isError ? .red : .secondary)
                    .fixedSize(horizontal: false, vertical: true).frame(minHeight: 34, alignment: .topLeading)
                HStack(spacing: 14) {
                    Button("恢复系统原屏保（重启）") { model.send("default") }
                        .disabled(!model.serverOK || model.busy || !model.rootReady || model.rebootPending)
                    Button("导出…", action: model.export).disabled(model.preview == nil || model.busy)
                }.font(.caption).buttonStyle(.link)
                Text("每次应用均会自动重启一次。接收前请唤醒阅读器，\n并打开「AI 用量」。编辑进度会保存在这台 Mac。\n屏保日期的位置与方向仍由阅读器系统绘制。")
                    .font(.system(size: 11)).foregroundStyle(.secondary).lineSpacing(3).fixedSize(horizontal: false, vertical: true)
            }.frame(width: 330)
        }.padding(32).frame(width: 900, height: 670).background(Color(nsColor: .windowBackgroundColor))
    }
}

@main struct MiBookScreensaverApp: App {
    init() {
        // Shared renderer supports repeatable export checks without launching a window.
        if CommandLine.arguments.contains("--self-test") {
            do { try ImageRenderer.verify(); exit(0) }
            catch { fputs("\(error)\n", stderr); exit(1) }
        }
        if CommandLine.arguments.count >= 4 && CommandLine.arguments[1] == "--render" {
            do {
                guard let image = NSImage(contentsOfFile: CommandLine.arguments[2]) else { throw ScreensaverError.message("Invalid image") }
                var settings = ImageAdjustments(orientation: CommandLine.arguments.contains("--landscape") ? .landscape : .portrait,
                    fill: !CommandLine.arguments.contains("--fit"))
                if let index = CommandLine.arguments.firstIndex(of: "--settings"), index + 1 < CommandLine.arguments.count {
                    settings = try JSONDecoder().decode(EditorDocument.self,
                        from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[index + 1]))).adjustments
                }
                if let index = CommandLine.arguments.firstIndex(of: "--rotate"), index + 1 < CommandLine.arguments.count,
                   let rotation = Int(CommandLine.arguments[index + 1]) { settings.rotation = ((rotation % 4) + 4) % 4 }
                let data = try ImageRenderer.render(image, settings: settings, device: CommandLine.arguments.contains("--device"))
                try data.write(to: URL(fileURLWithPath: CommandLine.arguments[3])); exit(0)
            } catch { fputs("\(error)\n", stderr); exit(1) }
        }
        NSApplication.shared.setActivationPolicy(.regular)
    }
    var body: some Scene {
        WindowGroup("小米屏保") { ScreensaverView().onAppear { NSApplication.shared.activate(ignoringOtherApps: true) } }
            .windowResizability(.contentSize)
    }
}
