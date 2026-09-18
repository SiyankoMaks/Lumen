# Эксплуатация и выпуск

С 18.09.2026 актуален автономный Android: [сборка APK](ANDROID_BUILD.md),
[состояние](PROJECT_STATE.md), [ADR 003](adr/003-standalone-polza.md).
Ниже сохранён исторический план выпуска облачной v0.1.

Локальная реализация не равнозначна production release. До выпуска:

- Собрать development/release builds Android и iOS, проверить на реальных
  устройствах small screens, клавиатуру, screen reader, large fonts и airplane mode.
- Запустить Maestro на тестовом устройстве; повторить сценарий с двумя устройствами,
  перезапуском API и потерянным ответом. Проверить SQLite после обновления приложения.
- Подключить выбранные AI models и провести contract smoke test JSON schema,
  проверить модели на русском, evidence, стоимость и privacy consent.
- Настроить TLS reverse proxy, request body limit 1 MB, timeout и trusted proxy IP;
  не публиковать PostgreSQL/Redis в интернет. Секреты задавать secret manager.
- Настроить backup PostgreSQL: ежедневно `pg_dump -Fc`, шифровать внешнее хранилище,
  ограничить доступ. Retention и период удаления backup согласовать с политикой.
- Проверять восстановление в отдельную базу; перед миграцией — backup и rehearsal.
  `alembic check` должен подтверждать отсутствие расхождения с моделями.
- Мониторить HTTP 5xx/latency и queued/failed jobs; не добавлять journal text в logs.
- Согласовать восстановление пароля, email verification, device session management,
  privacy policy, retention и масштабные load tests.
- `npm audit` на 16.09.2026: 14 moderate advisories в транзитивных Expo/tooling
  зависимостях (uuid/xcode, decode-uri-component/query-string). High/critical нет.
  Предлагаемый npm downgrade Expo несовместим со стеком и автоматически не применён.

Остановка dev окружения: `docker compose down`. Не добавляйте `--volumes`, если
хотите сохранить данные. Восстановление backup выполнять только в явно выбранную
отдельную базу. API health проверяет соединение с БД; AI queue отдельно контролируется
через состояния jobs. Содержимое дневника и ключи не включать в отчёты об ошибках.
