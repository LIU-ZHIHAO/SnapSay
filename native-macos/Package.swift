// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "SnapSay",
  platforms: [.macOS(.v13)],
  products: [
    .executable(name: "SnapSay", targets: ["SnapSay"])
  ],
  targets: [
    .executableTarget(
      name: "SnapSay",
      path: "Sources/SnapSay"
    )
  ]
)
