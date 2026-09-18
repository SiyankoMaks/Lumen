param([string]$ToolsRoot = 'E:\Lumen-build', [string]$CacheRoot = '', [switch]$SkipPrebuild)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$ToolsRoot = [IO.Path]::GetFullPath($ToolsRoot)
if (!$CacheRoot) { $CacheRoot = $ToolsRoot }
$CacheRoot = [IO.Path]::GetFullPath($CacheRoot)
$env:JAVA_HOME = (Get-ChildItem -LiteralPath (Join-Path $ToolsRoot 'java') -Directory | Select-Object -First 1).FullName
if (!$env:JAVA_HOME) { throw 'Install JDK 21 into ToolsRoot/java first.' }
$env:ANDROID_HOME = Join-Path $ToolsRoot 'android-sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:GRADLE_USER_HOME = Join-Path $CacheRoot 'gradle'
$env:TEMP = Join-Path $CacheRoot 'temp'
$env:TMP = $env:TEMP
$env:npm_config_cache = Join-Path $CacheRoot 'npm-cache'
$env:CI = '1'
$env:NODE_OPTIONS = '--max-old-space-size=1536'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$signing = Join-Path $ToolsRoot 'signing'
$artifacts = Join-Path $ToolsRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $signing,$artifacts,$env:TEMP | Out-Null
foreach ($required in @('ndk/27.1.12297006/source.properties','platforms/android-36/android.jar','build-tools/36.0.0/aapt2.exe','cmake/3.22.1/bin/cmake.exe')) {
    if (!(Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME $required))) { throw "SDK installation is incomplete: $required" }
}
$env:LUMEN_KEYSTORE = Join-Path $signing 'lumen-release.jks'
$passwordFile = Join-Path $signing 'password.txt'
if (!(Test-Path -LiteralPath $env:LUMEN_KEYSTORE)) {
    if (!(Test-Path -LiteralPath $passwordFile)) {
        $randomBytes = New-Object byte[] 32
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($randomBytes)
        $rng.Dispose()
        [IO.File]::WriteAllText($passwordFile,[Convert]::ToBase64String($randomBytes))
    }
    $env:LUMEN_KEYSTORE_PASSWORD = [IO.File]::ReadAllText($passwordFile)
    & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $env:LUMEN_KEYSTORE -storepass:env LUMEN_KEYSTORE_PASSWORD -keypass:env LUMEN_KEYSTORE_PASSWORD -alias lumen -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Lumen Personal, O=Lumen' -storetype JKS
    if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed.' }
}
$env:LUMEN_KEYSTORE_PASSWORD = [IO.File]::ReadAllText($passwordFile)
Push-Location (Join-Path $repoRoot 'apps/mobile')
try {
    if (!$SkipPrebuild) {
        & npx.cmd expo prebuild --platform android --no-install
        if ($LASTEXITCODE -ne 0) { throw 'Expo prebuild failed.' }
    } elseif (!(Test-Path -LiteralPath 'android/gradlew.bat')) { throw 'Run prebuild before using SkipPrebuild.' }
    Push-Location android
    try {
        & .\gradlew.bat assembleRelease '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a' --no-daemon --max-workers=1 '-Dorg.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=512m' '-Pkotlin.compiler.execution.strategy=in-process' --console=plain
        if ($LASTEXITCODE -ne 0) { throw 'Gradle release build failed.' }
    } finally { Pop-Location }
    $version = (Get-Content app.json -Raw | ConvertFrom-Json).expo.version
    $apk = Join-Path $artifacts "Lumen-$version.apk"
    Copy-Item -LiteralPath 'android/app/build/outputs/apk/release/app-release.apk' -Destination $apk -Force
    & "$env:ANDROID_HOME\build-tools\36.0.0\apksigner.bat" verify --verbose $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
    Get-FileHash -Algorithm SHA256 -LiteralPath $apk
} finally {
    Pop-Location
    Remove-Item Env:LUMEN_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
}
