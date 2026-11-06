import ExpoModulesCore
import UIKit
import Darwin

struct BrowseTabOption: Record {
  @Field var id: String = ""
  @Field var label: String = ""
  @Field var symbol: String = ""
}

public final class ImadeoBrowseTabsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ImadeoBrowseTabs")

    Constant("deviceModelIdentifier") {
      // The simulator's uname is the Mac architecture, not the simulated phone.
      if let identifier = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] {
        return identifier
      }
      var info = utsname()
      uname(&info)
      return Mirror(reflecting: info.machine).children.reduce("") { identifier, element in
        guard let value = element.value as? Int8, value != 0 else { return identifier }
        return identifier + String(UnicodeScalar(UInt8(value)))
      }
    }

    View(ImadeoBrowseTabsView.self) {
      Events("onSelectionChange", "onMetrics")

      Prop("options") { (view, options: [BrowseTabOption]) in
        view.setOptions(options)
      }
      Prop("selection") { (view, selection: String) in
        view.setSelection(selection)
      }
      Prop("accentColor") { (view, color: UIColor?) in
        view.tabBar.tintColor = color
      }
      Prop("unselectedColor") { (view, color: UIColor?) in
        view.tabBar.unselectedItemTintColor = color
      }
      Prop("dark") { (view, dark: Bool) in
        let style: UIUserInterfaceStyle = dark ? .dark : .light
        if view.overrideUserInterfaceStyle != style {
          view.overrideUserInterfaceStyle = style
          view.invalidateIntrinsicContentSize()
          view.setNeedsLayout()
        }
      }

      OnViewDidUpdateProps { view in
        view.setNeedsLayout()
      }
    }
  }
}

/** A real tab bar, without a controller that could move it to the Duo rail. */
final class ImadeoBrowseTabsView: ExpoView, UITabBarDelegate {
  let tabBar = UITabBar()
  let onSelectionChange = EventDispatcher()
  let onMetrics = EventDispatcher()

  private var options: [BrowseTabOption] = []
  private var itemsByID: [String: UITabBarItem] = [:]
  private var selection = ""
  private var reportedHeight: CGFloat?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    // Leave native background, selection and appearance objects untouched.
    // UIKit owns the material, selection lens, accessibility and interactions.
    tabBar.delegate = self
    tabBar.itemPositioning = .fill
    addSubview(tabBar)
  }

  func setOptions(_ incoming: [BrowseTabOption]) {
    var seen = Set<String>()
    let next = incoming.filter { !$0.id.isEmpty && seen.insert($0.id).inserted }
    let sameContent = next.count == options.count && zip(next, options).allSatisfy { pair in
      pair.0.id == pair.1.id && pair.0.label == pair.1.label && pair.0.symbol == pair.1.symbol
    }
    guard !sameContent else { return }

    var nextItems: [String: UITabBarItem] = [:]
    let orderedItems = next.enumerated().map { index, option in
      let item = itemsByID[option.id] ?? UITabBarItem(title: option.label,
        image: UIImage(systemName: option.symbol), tag: index)
      let previous = options.first { $0.id == option.id }
      if previous?.label != option.label { item.title = option.label }
      if previous?.symbol != option.symbol { item.image = UIImage(systemName: option.symbol) }
      item.tag = index
      item.accessibilityIdentifier = "browse-\(option.id)"
      nextItems[option.id] = item
      return item
    }
    options = next
    itemsByID = nextItems
    tabBar.setItems(orderedItems, animated: false)
    applySelection()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
  }

  func setSelection(_ id: String) {
    selection = id
    applySelection()
  }

  private func applySelection() {
    let item = itemsByID[selection] ?? options.first.flatMap { itemsByID[$0.id] }
    // Preserve native user-driven transitions when React acknowledges a tap.
    if tabBar.selectedItem !== item { tabBar.selectedItem = item }
  }

  func tabBar(_ tabBar: UITabBar, didSelect item: UITabBarItem) {
    guard options.indices.contains(item.tag) else { return }
    let id = options[item.tag].id
    guard selection != id else { return }
    selection = id
    onSelectionChange(["id": id])
  }

  private func naturalHeight(for width: CGFloat) -> CGFloat {
    let size = tabBar.sizeThatFits(CGSize(width: max(1, width), height: .greatestFiniteMagnitude))
    return size.height.isFinite ? max(0, size.height) : 0
  }

  override var intrinsicContentSize: CGSize {
    CGSize(width: UIView.noIntrinsicMetric, height: naturalHeight(for: bounds.width))
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    reportedHeight = nil
    invalidateIntrinsicContentSize()
    setNeedsLayout()
  }

  override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    invalidateIntrinsicContentSize()
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    guard bounds.width > 0 else { return }
    let height = naturalHeight(for: bounds.width)
    tabBar.frame = CGRect(x: 0, y: 0, width: bounds.width, height: height)
    guard window != nil, height > 0, reportedHeight != height else { return }
    reportedHeight = height
    // UITabBar exposes its whole control bounds, not the private glass platter.
    // Consumers should reserve this complete natural extent, without cropping.
    onMetrics(["height": height, "inset": 0, "controlHeight": height])
  }
}
