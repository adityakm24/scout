// iOS 27 stops any app that has not adopted the UIScene life cycle at launch. Expo SDK 57 ships the
// scene delegate (expo/ios/AppDelegates/ExpoAppSceneDelegate.swift) but its AppDelegate template
// still opens its own window. This registers the scene delegate and lets it own the window.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins')

const SCENE_MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' }
    ]
  }
}

// The window and the React Native start move to the scene delegate.
const OWN_WINDOW = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n[\s\S]*?#endif\n/

function adoptScenes(source) {
  if (source.includes('ExpoReactNativeFactoryProvider')) {
    return source
  }

  if (!OWN_WINDOW.test(source) || !source.includes('class AppDelegate: ExpoAppDelegate {')) {
    throw new Error('with-scene-lifecycle: AppDelegate.swift no longer matches the expected template')
  }

  return source
    .replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
    .replace(OWN_WINDOW, '\n')
}

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, mod => {
    mod.modResults.UIApplicationSceneManifest = SCENE_MANIFEST

    return mod
  })

  return withAppDelegate(config, mod => {
    if (mod.modResults.language === 'swift') {
      mod.modResults.contents = adoptScenes(mod.modResults.contents)
    }

    return mod
  })
}
