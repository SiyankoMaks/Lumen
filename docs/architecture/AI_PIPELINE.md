# AI pipeline

Пользователь явно выбирает анализ записи либо группы данных. Сервер проверяет
владельца, существование/ревизию источников, лимит 100 источников / 100 KB JSON
и допустимый период обзора. Задание и operation log сохраняются транзакционно.
Beat забирает очередь каждые 15 секунд; lease восстанавливает зависшие jobs.

Worker читает только выбранные источники, отправляет schema-constrained JSON
запрос и валидирует Pydantic-ответ. Fallback применяется только к timeout,
сетевым сбоям, 429 и 5xx. Ошибки запроса, неверный JSON и выдуманные evidence
не вызывают смену провайдера. Без configured provider job становится failed.

Перед сохранением worker повторно читает источники: изменение ревизии или
удаление отменяет применение устаревшей интерпретации. Все items, revisions,
evidence и completed job сохраняются одной транзакцией. Повтор completed job
не создаёт второй результат.

Паттерн требует минимум три различные записи. Это продуктовый порог, не
статистическая оценка достоверности. Гипотеза — предложение со статусами,
альтернативными объяснениями и evidence. Эксперимент начинается после решения
пользователя. Недельный обзор принимает явно ограниченный период до семи суток.

Метаданные: provider, model, prompt name/version, source revisions, review period.
AI всегда создаёт draft; пользовательское исправление добавляет ревизию и
сохраняет метаданные происхождения. Промпт не считает дневниковый текст инструкцией.

Адаптеры используют documented compatible endpoints:

- [Polza chat completions](https://polza.ai/docs/gaidy/chat-completions)
- [Yandex compatible endpoint](https://yandex.cloud/en/docs/tutorials/ml-ai/ai-model-ide-integration)
- [OpenRouter API](https://openrouter.ai/docs/api-reference/overview)

Реальные provider calls требуют credentials и модели, поддерживающей JSON schema.
Автотесты используют подставные провайдеры и проверяют fallback, evidence и stale
source handling. Качество естественно-языковых выводов требует отдельного eval
на согласованном датасете; автоматическая проверка ссылок его не заменяет.
