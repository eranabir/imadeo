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
    var configuration: UIButton.Configuration
    if #available(iOS 26.0, *) {
      configuration = .glass()
    } else {
      configuration = .gray()
    }
    configuration.cornerStyle = .capsule
    button.configuration = configuration
    button.addTarget(self, action: #selector(activate), for: .touchUpInside)
    addSubview(button)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    button.frame = bounds
  }

  @objc private func activate() { onActivate([:]) }
}
