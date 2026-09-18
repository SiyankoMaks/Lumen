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
```

Сборку лучше запускать из checkout на диске с запасом места: node_modules и
нативные промежуточные файлы размещаются рядом с исходниками. Gradle, SDK,
TEMP и итоговый APK скрипт направляет в ToolsRoot. Для workspace npm на Windows
нужна файловая система с junction (NTFS).
Параметр CacheRoot отдельно задаёт Gradle/npm/TEMP; SDK, подпись и APK остаются
в ToolsRoot. Следите за свободным местом на диске кэша.

Проверка подписи: `apksigner verify --verbose <apk>`. Установка при подключённом
телефоне: `adb install -r <apk>`. Или перенесите APK на телефон и откройте файл,
разрешив установку из выбранного файлового менеджера. Запустите Lumen и настройте
ключ в «Ещё». Реальный запрос проверяется пользователем со своим балансом Polza.

## Локальное размещение инструментов (18.09.2026)

Из-за нехватки C: создан E:\Lumen-build для SDK/JDK/Gradle и сборочных артефактов.
Python venv перенесён в D:\Lumen-build\python-venv; старый путь .venv — junction.
Предыдущий JS export перемещён в D:\Lumen-build\previous-bundles-20260918.
Для зависимостей использован D:\Lumen-build\npm-cache.
После успешной сборки можно удалить скачанные ZIP и ненужные временные сборки;
каталог signing нужно сохранить для обновлений приложения.
