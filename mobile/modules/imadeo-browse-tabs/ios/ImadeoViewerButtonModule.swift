import ExpoModulesCore
import UIKit

public final class ImadeoViewerButtonModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ImadeoViewerButton")
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
