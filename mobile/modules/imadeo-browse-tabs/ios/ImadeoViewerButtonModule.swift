import ExpoModulesCore
import UIKit
import Photos

public final class ImadeoViewerButtonModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ImadeoViewerButton")
    AsyncFunction("shareLibraryPhotos") { (ids: [String], promise: Promise) in
      Task { @MainActor in
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        do {
          let files = try await self.exportOriginals(ids, to: directory)
          guard let presenter = self.appContext?.utilities?.currentViewController() else {
            throw ShareError("Could not present the share sheet.")
          }
          let sheet = UIActivityViewController(activityItems: files, applicationActivities: nil)
          if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            popover.permittedArrowDirections = []
          }
          sheet.completionWithItemsHandler = { _, _, _, error in
            try? FileManager.default.removeItem(at: directory)
            if let error { promise.reject("ERR_LIBRARY_SHARE", error.localizedDescription) }
            else { promise.resolve(nil) }
          }
          presenter.present(sheet, animated: true)
        } catch {
          try? FileManager.default.removeItem(at: directory)
          promise.reject("ERR_LIBRARY_SHARE", error.localizedDescription)
        }
      }
    }

    View(ImadeoViewerButtonView.self) {
      Events("onActivate")
      Prop("symbol") { (view, value: String) in
        view.button.setImage(UIImage(systemName: value), for: .normal)
      }
      Prop("symbolSize") { (view, size: Double) in view.setSymbolSize(size) }
      Prop("label") { (view, value: String) in view.button.accessibilityLabel = value }
      Prop("disabled") { (view, value: Bool) in view.button.isEnabled = !value }
      Prop("tint") { (view, value: UIColor?) in view.button.tintColor = value }
    }
  }
  private struct ShareError: LocalizedError {
    let errorDescription: String?
    init(_ message: String) { errorDescription = message }
  }

  private func exportOriginals(_ ids: [String], to directory: URL) async throws -> [URL] {
    guard !ids.isEmpty else { throw ShareError("Select a photo or video to share.") }
    let fetched = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
    var assets: [String: PHAsset] = [:]
    fetched.enumerateObjects { asset, _, _ in assets[asset.localIdentifier] = asset }
    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = true
    var files: [URL] = []
    for (index, id) in ids.enumerated() {
      guard let asset = assets[id] else { throw ShareError("Photos could not access the selected item.") }
      let type: PHAssetResourceType = asset.mediaType == .video ? .video : .photo
      guard let resource = PHAssetResource.assetResources(for: asset).first(where: { $0.type == type }) else {
        throw ShareError("Photos could not find the original file.")
      }
      let folder = directory.appendingPathComponent(String(index))
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      let file = folder.appendingPathComponent((resource.originalFilename as NSString).lastPathComponent)
      try await PHAssetResourceManager.default().writeData(for: resource, toFile: file, options: options)
      files.append(file)
    }
    return files
  }

}

final class ImadeoViewerButtonView: ExpoView {
  let button = UIButton(type: .system)
  let onActivate = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    configureButton()
    button.addTarget(self, action: #selector(activate), for: .touchUpInside)
    addSubview(button)
  }

  private func configureButton() {
    // The shared Glass component owns the material around each group. A plain
    // system button keeps native SF Symbols and accessibility without nesting glass.
    var configuration = UIButton.Configuration.plain()
    configuration.imagePadding = 0
    configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 23, weight: .regular)
    button.configuration = configuration
  }

  func setSymbolSize(_ size: Double) {
    guard var configuration = button.configuration else { return }
    configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: CGFloat(size), weight: .regular)
    button.configuration = configuration
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    button.frame = bounds
  }

  @objc private func activate() { onActivate([:]) }
}
