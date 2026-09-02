// Стилизация портрета преподавателя: вырезка человека (Apple Vision,
// офлайн) + посадка на фирменный фон (пергамент с водяной эмблемой ВШЭ,
// вариант Б – выбор заказчика 02.09.2026).
//
//   swiftc -O stylize.swift -o stylize
//   ./stylize input.jpg bg-720.png output.jpg
//
// Из нескольких найденных объектов берётся самый крупный по маске: на
// части превью 160px в кадре есть второй человек, и маска «всех
// объектов» тащила его обломок в композит. Человек прижимается к низу
// холста (обрез торса совпадает с краем), высота 94% холста, ширина не
// шире 100%; уменьшение/увеличение – Lanczos.
import Foundation
import Vision
import CoreImage

func fail(_ msg: String, code: Int32 = 1) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(code)
}

guard CommandLine.arguments.count == 4 else { fail("usage: stylize input.jpg bg.png output.jpg", code: 2) }
let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let bgURL = URL(fileURLWithPath: CommandLine.arguments[2])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[3])

guard let source = CIImage(contentsOf: inputURL) else { fail("не читается \(inputURL.path)") }
guard let bg = CIImage(contentsOf: bgURL) else { fail("не читается \(bgURL.path)") }

let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: source)
do { try handler.perform([request]) } catch { fail("Vision: \(error)") }
guard let result = request.results?.first, !result.allInstances.isEmpty else {
    fail("объект не найден: \(inputURL.lastPathComponent)", code: 3)
}

let context = CIContext()

/** Значение маски в точке (координаты 0..1, начало сверху-слева). */
func maskValue(_ buf: CVPixelBuffer, atX fx: CGFloat, y fy: CGFloat) -> Float32 {
    CVPixelBufferLockBaseAddress(buf, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buf, .readOnly) }
    let w = CVPixelBufferGetWidth(buf), h = CVPixelBufferGetHeight(buf)
    let stride = CVPixelBufferGetBytesPerRow(buf)
    guard let base = CVPixelBufferGetBaseAddress(buf) else { return 0 }
    let x = min(w - 1, max(0, Int(fx * CGFloat(w))))
    let y = min(h - 1, max(0, Int(fy * CGFloat(h))))
    return base.advanced(by: y * stride).assumingMemoryBound(to: Float32.self)[x]
}

/** Средняя плотность маски – запасной критерий, когда лица не нашлось. */
func maskDensity(_ buf: CVPixelBuffer) -> Double {
    CVPixelBufferLockBaseAddress(buf, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(buf, .readOnly) }
    let w = CVPixelBufferGetWidth(buf), h = CVPixelBufferGetHeight(buf)
    let stride = CVPixelBufferGetBytesPerRow(buf)
    guard let base = CVPixelBufferGetBaseAddress(buf) else { return 0 }
    var sum = 0.0
    let step = max(1, min(w, h) / 256)
    for y in Swift.stride(from: 0, to: h, by: step) {
        let row = base.advanced(by: y * stride).assumingMemoryBound(to: Float32.self)
        for x in Swift.stride(from: 0, to: w, by: step) { sum += Double(row[x]) }
    }
    return sum
}

// Какой объект брать. Критерий «самый крупный» подводил: на съёмках с
// конференций самым крупным оказывался тёмный силуэт зала или соседа.
// Правильный объект – тот, что накрывает самое крупное ЛИЦО в кадре
// (портрет преподавателя – всегда про лицо). Плотность остаётся запасным
// критерием для кадров, где детектор лица ничего не нашёл (затылок и т.п.).
let faceRequest = VNDetectFaceRectanglesRequest()
try? handler.perform([faceRequest])
// boundingBox лица – в нижнестрочных координатах, маска – в верхнестрочных.
let face = (faceRequest.results ?? []).max {
    $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height
}
let faceCenter: (x: CGFloat, y: CGFloat)? = face.map {
    (x: $0.boundingBox.midX, y: 1 - $0.boundingBox.midY)
}

var byFace: CVPixelBuffer?
var byDensity: (Double, CVPixelBuffer)?
for instance in result.allInstances {
    guard let buf = try? result.generateScaledMaskForImage(
        forInstances: IndexSet(integer: instance), from: handler) else { continue }
    if let c = faceCenter, byFace == nil, maskValue(buf, atX: c.x, y: c.y) > 0.5 { byFace = buf }
    let d = maskDensity(buf)
    if d > (byDensity?.0 ?? -1) { byDensity = (d, buf) }
}
guard let mask = byFace ?? byDensity?.1 else { fail("маска не построена: \(inputURL.lastPathComponent)") }

// Иногда Vision склеивает соседа по кадру с преподавателем в ОДИН объект –
// тогда выбор объекта не спасает. Оставляем только связную область маски,
// в которой лежит лицо: заливка (BFS) от точки лица по пикселям > 0.5.
// Куски, не соединённые с преподавателем, гаснут. Если лица нет – маска
// остаётся как есть.
if let c = faceCenter, maskValue(mask, atX: c.x, y: c.y) > 0.5 {
    CVPixelBufferLockBaseAddress(mask, [])
    let w = CVPixelBufferGetWidth(mask), h = CVPixelBufferGetHeight(mask)
    let stride = CVPixelBufferGetBytesPerRow(mask)
    let base = CVPixelBufferGetBaseAddress(mask)!
    func px(_ x: Int, _ y: Int) -> UnsafeMutablePointer<Float32> {
        base.advanced(by: y * stride).assumingMemoryBound(to: Float32.self).advanced(by: x)
    }
    // Сосед может КАСАТЬСЯ преподавателя (волосы на фоне плеча) – тогда
    // простая заливка перетечёт через мостик. Поэтому размыкание: заливка
    // идёт по ЭРОДИРОВАННОЙ маске (узкие мостики рвутся), а результат
    // расширяется обратно тем же радиусом.
    let radius = max(3, min(w, h) / 48)
    var solid = [Bool](repeating: false, count: w * h)
    for y in 0..<h {
        let row = base.advanced(by: y * stride).assumingMemoryBound(to: Float32.self)
        for x in 0..<w where row[x] > 0.5 { solid[y * w + x] = true }
    }
    func shrinkOrGrow(_ src: [Bool], grow: Bool) -> [Bool] {
        // Два прохода по осям – дешёвый квадратный структурный элемент.
        var pass1 = src
        for y in 0..<h {
            for x in 0..<w {
                let lo = max(0, x - radius), hi = min(w - 1, x + radius)
                var v = !grow
                for nx in lo...hi where src[y * w + nx] == grow { v = grow; break }
                pass1[y * w + x] = v
            }
        }
        var pass2 = pass1
        for y in 0..<h {
            let lo = max(0, y - radius), hi = min(h - 1, y + radius)
            for x in 0..<w {
                var v = !grow
                for ny in lo...hi where pass1[ny * w + x] == grow { v = grow; break }
                pass2[y * w + x] = v
            }
        }
        return pass2
    }
    let eroded = shrinkOrGrow(solid, grow: false)
    let sx0 = min(w - 1, max(0, Int(c.x * CGFloat(w))))
    let sy0 = min(h - 1, max(0, Int(c.y * CGFloat(h))))
    var keep = [Bool](repeating: false, count: w * h)
    var queue: [(Int, Int)] = []
    if eroded[sy0 * w + sx0] {
        queue.append((sx0, sy0))
    } else {
        // Точка лица могла попасть в съеденный эрозией край – ищем ближайший
        // выживший пиксель в окрестности лица.
        outer: for r in 1...(radius * 3) {
            for dy in -r...r { for dx in -r...r {
                let nx = sx0 + dx, ny = sy0 + dy
                if nx >= 0, nx < w, ny >= 0, ny < h, eroded[ny * w + nx] {
                    queue.append((nx, ny)); break outer
                }
            } }
        }
    }
    if !queue.isEmpty {
        keep[queue[0].1 * w + queue[0].0] = true
        var head = 0
        while head < queue.count {
            let (x, y) = queue[head]; head += 1
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let nx = x + dx, ny = y + dy
                guard nx >= 0, nx < w, ny >= 0, ny < h, !keep[ny * w + nx],
                      eroded[ny * w + nx] else { continue }
                keep[ny * w + nx] = true
                queue.append((nx, ny))
            }
        }
        let grown = shrinkOrGrow(keep, grow: true)
        for y in 0..<h {
            let row = base.advanced(by: y * stride).assumingMemoryBound(to: Float32.self)
            for x in 0..<w where row[x] > 0.5 && !grown[y * w + x] { row[x] = 0 }
        }
    }
    CVPixelBufferUnlockBaseAddress(mask, [])
}

let maskImage = CIImage(cvPixelBuffer: mask)
let blend = CIFilter(name: "CIBlendWithMask")!
blend.setValue(source, forKey: kCIInputImageKey)
blend.setValue(CIImage(color: .clear).cropped(to: source.extent), forKey: kCIInputBackgroundImageKey)
blend.setValue(maskImage, forKey: kCIInputMaskImageKey)
guard let person = blend.outputImage else { fail("blend") }

// Габариты человека по маске (иначе анкеровка пляшет от полей кадра).
CVPixelBufferLockBaseAddress(mask, .readOnly)
let mw = CVPixelBufferGetWidth(mask), mh = CVPixelBufferGetHeight(mask)
let mstride = CVPixelBufferGetBytesPerRow(mask)
let mbase = CVPixelBufferGetBaseAddress(mask)!
var minX = mw, maxX = -1, minY = mh, maxY = -1
for y in 0..<mh {
    let row = mbase.advanced(by: y * mstride).assumingMemoryBound(to: Float32.self)
    for x in 0..<mw where row[x] > 0.5 {
        if x < minX { minX = x }; if x > maxX { maxX = x }
        if y < minY { minY = y }; if y > maxY { maxY = y }
    }
}
CVPixelBufferUnlockBaseAddress(mask, .readOnly)
guard maxX >= minX, maxY >= minY else { fail("пустая маска: \(inputURL.lastPathComponent)", code: 3) }

// Координаты маски – верхнестрочные, CIImage – нижнестрочные.
let sx = source.extent.width / CGFloat(mw)
let sy = source.extent.height / CGFloat(mh)
let bbox = CGRect(
    x: CGFloat(minX) * sx + source.extent.origin.x,
    y: (CGFloat(mh - 1 - maxY)) * sy + source.extent.origin.y,
    width: CGFloat(maxX - minX + 1) * sx,
    height: CGFloat(maxY - minY + 1) * sy)
let cropped = person.cropped(to: bbox)

let canvasW = bg.extent.width, canvasH = bg.extent.height
let scale = min(canvasH * 0.94 / bbox.height, canvasW / bbox.width)
let lanczos = CIFilter(name: "CILanczosScaleTransform")!
lanczos.setValue(cropped, forKey: kCIInputImageKey)
lanczos.setValue(scale, forKey: kCIInputScaleKey)
lanczos.setValue(1.0, forKey: kCIInputAspectRatioKey)
guard var scaled = lanczos.outputImage else { fail("scale") }
let se = scaled.extent
// К низу и в центр холста.
scaled = scaled.transformed(by: CGAffineTransform(
    translationX: (canvasW - se.width) / 2 - se.origin.x,
    y: -se.origin.y))

let composed = scaled.composited(over: bg).cropped(to: bg.extent)
guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else { fail("colorspace") }
do {
    try context.writeJPEGRepresentation(
        of: composed, to: outputURL, colorSpace: colorSpace,
        options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.85])
} catch { fail("запись: \(error)") }
