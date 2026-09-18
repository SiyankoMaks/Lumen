# Lumen

Мобильный журнал наблюдений: записи → доказательства → паттерны → гипотезы →
эксперименты → недельные обзоры. Expo / React Native, FastAPI, PostgreSQL, SQLite.
Интерфейс на русском, тёмная тема по дизайн-спецификации v2.

## Запуск сервера

Нужны Docker Compose и Node.js 24. Для разработки API вне Docker — Python 3.12+.

1. Скопируйте `.env.example` в `.env`.
2. Замените `POSTGRES_PASSWORD` и `JWT_SECRET` случайными значениями. Для пароля
   PostgreSQL используйте URL-safe символы; JWT secret — минимум 32 символа.
3. Запустите `docker compose up --build -d`.
4. Проверьте `http://localhost:8000/health`. OpenAPI UI: `http://localhost:8000/docs`.

Compose поднимает PostgreSQL, Redis, миграцию, API, Celery worker и scheduler.
Миграция завершается до старта приложения. Сервис AI использует долговечную
таблицу заданий: недоступность Redis не отменяет сохранение записи.

## Запуск приложения

```sh
npm ci
```

Скопируйте `apps/mobile/.env.example` в `apps/mobile/.env`. В
`EXPO_PUBLIC_API_URL` укажите адрес компьютера, доступный с телефона:
`http://192.168.1.10:8000/api/v1`. Android Emulator обычно использует
`http://10.0.2.2:8000/api/v1`; iOS Simulator — `http://localhost:8000/api/v1`.

```sh
npm run mobile
```

Откройте приложение в совместимом с SDK 57 Expo Go или development build.
Сначала можно писать без аккаунта. В разделе «Ещё» зарегистрируйтесь: локальные
записи будут привязаны к этому аккаунту и отправлены на сервер. Для смены
аккаунта сначала выполните выход с очисткой локальных данных.

Обычное сохранение работает без сети. Синхронизация запускается при сохранении,
возврате приложения на передний план, восстановлении сети и каждые 15 секунд,
пока приложение открыто. Работа при полностью закрытом приложении не обещается.

## AI

Добавьте серверные ключи и идентификаторы моделей в `.env`:
`POLZA_API_KEY/POLZA_MODEL`, `YANDEX_API_KEY/YANDEX_MODEL`,
`OPENROUTER_API_KEY/OPENROUTER_MODEL`. Достаточно одного настроенного провайдера.
Порядок задаёт `AI_PROVIDERS`. После изменения перезапустите API и worker.
Ключи никогда не помещаются в `EXPO_PUBLIC_*`.

Откройте синхронизированную запись → «Структурировать с AI» → подтвердите
отправку. Паттерны и недельный обзор запрашиваются в «Инсайтах»; гипотеза может
стать основой эксперимента. Статус «Активно» у эксперимента требует активной
гипотезы, завершение требует результата. Каждый вывод содержит источники и
историю. Без ключей задания показывают ошибку; демонстрационные выводы не создаются.

## Проверки

```sh
python -m venv .venv
# Windows: .venv\Scripts\Activate.ps1; Linux/macOS: source .venv/bin/activate
pip install -c services/api/constraints.txt -e "services/api[dev]"
pytest services/api/tests -q
npm test
npm run test:ui
npm run typecheck
ruff check --config ruff.toml services/api scripts
ruff format --config ruff.toml --check services/api scripts
npm run format:check
```

Без `TEST_DATABASE_URL` backend-тесты используют SQLite; тест конкурентных
изменений пропускается. Для полной проверки задайте `TEST_DATABASE_URL` с
**отдельной пустой тестовой PostgreSQL**: тесты создают и удаляют таблицы.
Никогда не указывайте рабочую базу. CI проверяет PostgreSQL и миграции.

```sh
alembic -c services/api/alembic.ini upgrade head
alembic -c services/api/alembic.ini check
python scripts/export_openapi.py
npm run contracts
```

Контракт клиента генерируется из FastAPI, изменения проверяются в CI.
Локальные схемы и outbox проверяются на настоящем SQLite через Node.js 24;
UI проверяется React Native Testing Library. Maestro-сценарий находится в
`apps/mobile/.maestro`; запускать на отдельном тестовом устройстве.

## Документация

- [Архитектура](docs/architecture/ARCHITECTURE.md)
- [Синхронизация](docs/architecture/SYNC.md)
- [AI pipeline](docs/architecture/AI_PIPELINE.md)
- [Состояние реализации и проверки](docs/IMPLEMENTATION_STATUS.md)
- [Решения и открытые вопросы](docs/OPEN_QUESTIONS.md)
- [Эксплуатация и выпуск](docs/RELEASE.md)

Исходные материалы в папке `Информаия` исключены из Git. Эта папка не нужна для
сборки. Приложение не публиковалось в магазины и не развёртывалось в production.
