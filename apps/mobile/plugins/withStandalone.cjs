const {
  withAndroidManifest,
  withAppBuildGradle,
  withProjectBuildGradle,
} = require("expo/config-plugins");

module.exports = function withStandalone(config) {
  config = withProjectBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes("// Lumen native job pools")) {
      const pools = `
// Lumen native job pools: constrain Ninja independently of Gradle workers.
allprojects { subproject ->
    ['com.android.application', 'com.android.library'].each { pluginId ->
        subproject.plugins.withId(pluginId) {
            subproject.extensions.getByName('android').defaultConfig.externalNativeBuild.cmake.arguments.addAll([
                '-DCMAKE_JOB_POOLS=lumen_compile=1;lumen_link=1',
                '-DCMAKE_JOB_POOL_COMPILE=lumen_compile',
                '-DCMAKE_JOB_POOL_LINK=lumen_link'
            ])
        }
    }
}
`;
      const marker = 'apply plugin: "expo-root-project"';
      if (!mod.modResults.contents.includes(marker))
        throw new Error("Android root template changed");
      // ReactRootProjectPlugin evaluates :app immediately; register before it.
      mod.modResults.contents = mod.modResults.contents.replace(
        marker,
        pools + "\n" + marker,
      );
    }
    return mod;
  });
  config = withAndroidManifest(config, (mod) => {
    const app = mod.modResults.manifest.application[0].$;
    app["android:allowBackup"] = "false";
    app["android:usesCleartextTraffic"] = "false";
    return mod;
  });
  return withAppBuildGradle(config, (mod) => {
    if (!mod.modResults.contents.includes("System.getenv('LUMEN_NATIVE_BUILD_ROOT')")) {
      const marker = "android {\n";
      if (!mod.modResults.contents.includes(marker))
        throw new Error("Android app template changed");
      mod.modResults.contents = mod.modResults.contents.replace(
        marker,
        `${marker}
    // Keep generated C++ object paths within Windows native tool limits.
    def nativeBuildRoot = System.getenv('LUMEN_NATIVE_BUILD_ROOT')
    if (nativeBuildRoot) {
        externalNativeBuild {
            cmake { buildStagingDirectory file(nativeBuildRoot) }
        }
    }
`,
      );
    }
    if (mod.modResults.contents.includes("System.getenv('LUMEN_KEYSTORE')"))
      return mod;
    const marker = "signingConfigs {\n";
    if (!mod.modResults.contents.includes(marker))
      throw new Error("Android signing template changed");
    mod.modResults.contents = mod.modResults.contents.replace(
      marker,
      `${marker}
        release {
            def signingPath = System.getenv('LUMEN_KEYSTORE')
            if (signingPath) {
                storeFile file(signingPath)
                storePassword System.getenv('LUMEN_KEYSTORE_PASSWORD')
                keyAlias 'lumen'
                keyPassword System.getenv('LUMEN_KEYSTORE_PASSWORD')
            }
        }
`,
    );
    const release = mod.modResults.contents.indexOf(
      "        release {",
      mod.modResults.contents.indexOf("    buildTypes {"),
    );
    if (release < 0) throw new Error("Android release template changed");
    mod.modResults.contents =
      mod.modResults.contents.slice(0, release) +
      mod.modResults.contents
        .slice(release)
        .replace(
          "signingConfig signingConfigs.debug",
          "signingConfig signingConfigs.release",
        );
    return mod;
  });
};
