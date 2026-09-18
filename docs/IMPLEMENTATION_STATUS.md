# Состояние реализации Lumen — 16.09.2026

## Аудит 16.09.2026

Исходный репозиторий содержит README и приватную папку «Информаия»: master-ТЗ,
выбранный дизайн v2, девять Draw.io диаграмм, два BPMN и изображение трёх концептов.
Реализации, зависимостей, тестов и инфраструктуры не было. Резервный Draw.io пуст.
Все материалы прочитаны; исходники материалов исключены из Git.

## Реализовано

| Этап | Результат                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 0–1  | Аудит, monorepo, Expo SDK 57, FastAPI, Docker Compose, env examples, CI, lockfile/constraints                                       |
| 2–3  | PostgreSQL schema/Alembic, auth Argon2id/JWT/refresh rotation, REST, OpenAPI-generated TS                                           |
| 4–6  | SQLite migrations, local CRUD/history/outbox, ordered sync, retry, idempotency, revision conflicts, tombstones, merge UI            |
| 7–8  | Celery durable jobs, provider adapters, JSON schema validation, evidence, source revision checks, ручная правка AI и история        |
| 9–12 | Паттерны с минимум 3 записями, гипотезы, эксперимент со статусами/критериями/измерениями/результатом, обзор заданной недели         |
| 13   | Тёмные tokens и reusable UI, Today, журнал, редактор, insights, literal search, календарь, настройки, состояния offline/error/empty |
| 14   | Экспорт локальных и серверных данных, account deletion, очистка SQLite/SecureStore, привязка локальной базы к владельцу             |
| 15   | Quality CI, dependency audit, миграционная проверка, эксплуатационная документация; production-проверки ещё требуются               |
| 16   | Evie отложен согласно ТЗ до стабильной standalone версии                                                                            |

Данные имеют общую revision envelope; виды сущностей валидируются DTO и доменными
правилами. Это решение описано в ADR. AI запускается по запросу пользователя,
без вымышленных демонстрационных результатов. Изменения сделаны последовательно:
инфраструктура → домен/API → локальные данные/sync → UI → AI и проверки.

## Выполненные проверки

- **13 backend tests на отдельном PostgreSQL 16**: CRUD, duplicate operation,
  409 и разрешение, tombstone, access isolation, refresh replay, evidence,
  lifecycle, export/deletion, конкурентные записи, worker и source changes.
- **8 SQLite/sync tests**: offline create/edit/delete, восстановление очереди,
  потеря ответа и повтор, независимые сущности, правка во время HTTP, merge,
  rollback local transaction, устаревшая ревизия редактора, account isolation,
  проверка календарной даты.
- **2 React Native Testing Library tests**: сохранение без ожидания облака,
  сохранность текста и отсутствие перехода назад при ошибке локального хранилища.
- TypeScript typecheck и Ruff lint/format пройдены.
- Alembic upgrade → check → downgrade на отдельной PostgreSQL пройдены;
  расхождений схемы с моделями не обнаружено.
- Android и iOS Hermes bundles успешно экспортированы Metro; native dependencies
  сверены с `expo install --check`.
- `npm audit`: 14 moderate, 0 high/critical; детали в RELEASE.md.

## Границы готовности

Это исходная работающая реализация v0.1, **не подтверждённый production release**.
Не выполнялись: запуск на реальном Android/iOS, Maestro на устройстве, Docker
Compose end-to-end (Docker отсутствует), внешние AI-запросы с настоящими ключами,
load/eval/backup restore на production-инфраструктуре. Backend проверен локально
на Python 3.11, production Docker/CI используют Python 3.12.

Не реализованы: фото/голос и вложения, push notifications, semantic search,
восстановление пароля/email verification, light theme, web client, Evie,
фоновая синхронизация после закрытия приложения. Отдельные отсутствующие элементы
не показаны как действующие кнопки. UI quality на разных устройствах и оптимизация
больших журналов требуют проверки; полный pull пока линейный.

Для дальнейшего запуска нужны Docker либо отдельно PostgreSQL + Redis,
Expo-совместимое устройство и выбранные AI credentials. Команды — в README.
