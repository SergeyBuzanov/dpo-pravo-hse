// Вырезка человека с фото средствами macOS Vision (офлайн, без сторонних
// сервисов): вход – JPEG/PNG, выход – PNG с прозрачным фоном.
//
//   swiftc -O cutout.swift -o cutout
//   ./cutout input.jpg output.png
//
// Требует macOS 14+ (VNGenerateForegroundInstanceMaskRequest).
import Foundation
import Vision
import CoreImage

guard CommandLine.arguments.count == 3 else {
    FileHandle.standardError.write("usage: cutout input.jpg output.png\n".data(using: .utf8)!)
    exit(2)
}
let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])

guard let ciImage = CIImage(contentsOf: inputURL) else {
    FileHandle.standardError.write("не удалось прочитать \(inputURL.path)\n".data(using: .utf8)!)
    exit(1)
}

let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(ciImage: ciImage)
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("Vision: \(error)\n".data(using: .utf8)!)
    exit(1)
}
guard let result = request.results?.first, !result.allInstances.isEmpty else {
    FileHandle.standardError.write("объект на фото не найден: \(inputURL.lastPathComponent)\n".data(using: .utf8)!)
    exit(3)
}

let maskBuffer: CVPixelBuffer
do {
    maskBuffer = try result.generateScaledMaskForImage(
        forInstances: result.allInstances, from: handler)
} catch {
    FileHandle.standardError.write("маска: \(error)\n".data(using: .utf8)!)
    exit(1)
}

let mask = CIImage(cvPixelBuffer: maskBuffer)
let blend = CIFilter(name: "CIBlendWithMask")!
blend.setValue(ciImage, forKey: kCIInputImageKey)
blend.setValue(CIImage(color: .clear).cropped(to: ciImage.extent), forKey: kCIInputBackgroundImageKey)
blend.setValue(mask, forKey: kCIInputMaskImageKey)
guard let outImage = blend.outputImage else { exit(1) }

let context = CIContext()
guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else { exit(1) }
do {
    try context.writePNGRepresentation(
        of: outImage, to: outputURL, format: .RGBA8, colorSpace: colorSpace)
} catch {
    FileHandle.standardError.write("запись: \(error)\n".data(using: .utf8)!)
    exit(1)
}
