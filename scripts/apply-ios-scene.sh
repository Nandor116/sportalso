#!/bin/zsh
# Prebuild UTÁN kell futtatni: scene-lifecycle-t ad az iOS appnak.
# Az új iOS SDK (26+) kilépti az appot indításkor, ha nincs UIScene támogatás
# ("NoSceneLifecycleAdoption" trap → azonnali crash).
# A Info.plist-beli UIApplicationSceneManifest az app.json ios.infoPlist-jében él.
set -e
cd "$(dirname "$0")/../app/ios/Sportals"

cat > AppDelegate.swift <<'SWIFT_EOF'
internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate {
  static var sharedFactory: RCTReactNativeFactory?
  static var launchOptions: [UIApplication.LaunchOptionsKey: Any]?

  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    Self.sharedFactory = factory
    Self.launchOptions = launchOptions
    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // Az ablakot a SceneDelegate hozza létre (kötelező scene lifecycle iOS 26+)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  public func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let config = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
    config.delegateClass = SceneDelegate.self
    return config
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let window = UIWindow(windowScene: windowScene)

    AppDelegate.sharedFactory?.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: AppDelegate.launchOptions)

    self.window = window
    window.makeKeyAndVisible()
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
SWIFT_EOF

echo "iOS scene lifecycle beállítva ✓"
