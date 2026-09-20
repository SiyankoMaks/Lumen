# Сборка Android APK

Release APK включает приложение и не требует работающего компьютера или сервера.
Минимальная версия Android определяется установленным React Native (SDK 24).

## Инструменты

Node.js 24, JDK 21, Android SDK command-line tools, platform-tools,
platforms;android-36, build-tools;36.0.0, ndk;27.1.12297006 и cmake;3.22.1.
Gradle wrapper создаётся Expo prebuild; версии Expo/RN зафиксированы package-lock.

Скрипт `scripts/build-android.ps1` использует внешний каталог инструментов,
создаёт личную подпись при первом запуске и собирает release. Сохраните каталог
signing отдельно: без того же ключа Android не разрешит обновить установленный APK.
Ключ подписи и пароль нельзя коммитить. Это не API-ключ Polza.

```powershell
npm ci
./scripts/build-android.ps1 -ToolsRoot E:\Lumen-build
# Если внешний диск медленный, рабочий кэш можно направить на NTFS:
./scripts/build-android.ps1 -ToolsRoot E:\Lumen-build -CacheRoot D:\Lumen-build\fast-cache
# Текущее размещение SDK: лёгкая платформа на D:, тяжёлые каталоги — junction на E:
./scripts/build-android.ps1 -ToolsRoot E:\Lumen-build -CacheRoot D:\Lumen-build\fast-cache -SdkRoot D:\Lumen-build\sdk
# JDK также можно читать с локального NTFS:
./scripts/build-android.ps1 -ToolsRoot E:\Lumen-build -CacheRoot D:\Lumen-build\fast-cache -SdkRoot D:\Lumen-build\sdk -JavaHome D:\Lumen-build\java\jdk-21.0.12.1+1
```

Сборку лучше запускать из checkout на диске с запасом места: node_modules и
нативные промежуточные файлы размещаются рядом с исходниками. Gradle, SDK,
TEMP и итоговый APK скрипт направляет в ToolsRoot. Для workspace npm на Windows
нужна файловая система с junction (NTFS).
Параметр CacheRoot отдельно задаёт Gradle/npm/TEMP; SDK, подпись и APK остаются
в ToolsRoot. Следите за свободным местом на диске кэша.
На этой машине используется один Gradle worker, heap 1536 МБ и Kotlin in-process.
Ninja ограничен одним заданием компиляции/линковки через
[CMake job pools](https://cmake.org/cmake/help/latest/variable/CMAKE_JOB_POOLS.html),
поскольку его параллелизм задаётся отдельно от Gradle workers.
Скрипт проверяет готовность SDK перед сборкой. `-SkipPrebuild` подходит для
повторной компиляции неизменённого native-проекта после сетевого сбоя;
при изменении app.json или config plugin запускайте обычную полную команду.
Для диагностики загрузок включён журнал Gradle info, ожидание соединения ограничено
60 секундами, чтения — 120 секундами. Это параметры сборки, не повторов Polza.
Предупреждения SDK в stderr не считаются ошибкой: проверяется код завершения Gradle.

Проверка подписи: `apksigner verify --verbose <apk>`. Установка при подключённом
телефоне: `adb install -r <apk>`. Или перенесите APK на телефон и откройте файл,
разрешив установку из выбранного файлового менеджера. Запустите Lumen и настройте
ключ в «Ещё». Реальный запрос проверяется пользователем со своим балансом Polza.

## Локальное размещение инструментов (18.09.2026)

Из-за нехватки C: создан E:\Lumen-build для SDK/JDK/Gradle и сборочных артефактов.
Python venv перенесён в D:\Lumen-build\python-venv; старый путь .venv — junction.
Предыдущий JS export перемещён в D:\Lumen-build\previous-bundles-20260918.
Для зависимостей использован D:\Lumen-build\npm-cache.
19.09 создан D:\Lumen-build\sdk: платформа Android 36 хранится на D:;
ndk/cmake/build-tools/cmdline-tools/licenses/platform-tools — junction на E:.
Это ускоряет запись тысяч маленьких ресурсов платформы без копирования NDK.
После успешной сборки можно удалить скачанные ZIP и ненужные временные сборки;
каталог signing нужно сохранить для обновлений приложения.
