# REST API CRM

Машинный доступ к сделкам, заказам и клиентам: забрать, создать, изменить,
удалить. Нужен, когда с CRM работает не человек в браузере, а другая система —
сайт, 1С, n8n, свой скрипт.

## Ключ

Все методы закрыты одним ключом:

```
Authorization: Bearer <CRM_API_TOKEN>
```

Ключ задаётся переменной `CRM_API_TOKEN` — на странице **«Интеграции» →
«Свои переменные»** (отметьте «секрет») или в переменных Railway.

Пока переменная не задана, API отвечает `503` на любой запрос: «нет ключа»
не означает «пускаем всех».

Ключ приравнен к правам владельца: запросы идут в обход RLS. Не кладите его
в браузерный код — только сервер-к-серверу.

## Ответы

| Код | Когда |
|---|---|
| `200` | успех |
| `201` | объект создан |
| `400` | ошибка в запросе (текст в поле `error`) |
| `401` | ключ не передан или неверный |
| `404` | объект не найден |
| `503` | API выключен (нет ключа) или на сервере нет доступа к базе |

Ошибка всегда одного вида: `{ "error": "текст на русском" }`.

Списки возвращаются постранично:

```json
{ "items": [...], "total": 1598, "limit": 50, "offset": 0 }
```

`limit` — до 200, по умолчанию 50.

---

## Сделки

```bash
# Список. Фильтры: stage_id, search (имя/телефон/название), limit, offset
curl -H "Authorization: Bearer $TOKEN" \
  "https://<домен>/api/v1/deals?limit=20&search=996500"

# Одна сделка
curl -H "Authorization: Bearer $TOKEN" "https://<домен>/api/v1/deals/<id>"

# Создать. Обязательно только title; без stage_id попадёт в этап по умолчанию
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"Заявка с сайта","customer_phone":"996500111222","city":"Бишкек"}' \
  "https://<домен>/api/v1/deals"

# Изменить — в том числе передвинуть по воронке
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"stage_id":"<id этапа>","amount":1490}' \
  "https://<домен>/api/v1/deals/<id>"

# Удалить (мягко: запись остаётся для отчётов)
curl -X DELETE -H "Authorization: Bearer $TOKEN" "https://<домен>/api/v1/deals/<id>"
```

Смена `stage_id` через API сбрасывает отсчёт времени в этапе — карточка не
будет показывать «в этапе 3 дня» сразу после переноса.

Менять можно: `title`, `stage_id`, `amount`, `currency`, `customer_name`,
`customer_phone`, `customer_username`, `city`, `address`,
`responsible_employee_id`, `note`, `status`. Незнакомое поле — ошибка `400`,
а не молчаливое игнорирование: так опечатка в интеграции находится сразу.

## Заказы

```bash
curl -H "Authorization: Bearer $TOKEN" "https://<домен>/api/v1/orders?status=new"
curl -H "Authorization: Bearer $TOKEN" "https://<домен>/api/v1/orders?phone=996500111222"

curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"customer_phone":"996500111222","quantity":1,"total_amount":1490}' \
  "https://<домен>/api/v1/orders"
```

Плюс `GET/PATCH/DELETE /api/v1/orders/{id}` — как у сделок.

## Клиенты

Клиент определяется телефоном: это единственный идентификатор человека,
общий для всех каналов. Поиск идёт по последним 9 цифрам, потому что номера
хранятся в разных форматах.

```bash
# Профиль + все сделки и заказы этого человека
curl -H "Authorization: Bearer $TOKEN" "https://<домен>/api/v1/customers/996500111222"

# Заметка и теги
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"note":"Просил перезвонить после 18:00","tags":["опт"]}' \
  "https://<домен>/api/v1/customers/996500111222"
```

## Этапы воронки

```bash
curl -H "Authorization: Bearer $TOKEN" "https://<домен>/api/v1/stages"
```

Справочник `stage_id` — чтобы было чем двигать сделки.

## Список методов

`GET /api/v1` возвращает перечень всех эндпоинтов. Заодно это проверка, что
ключ рабочий.

## Чего в API пока нет

- Вебхуков «наружу» на события CRM: наружу события уходят из сценариев
  (действие «Дёрнуть вебхук») и из модуля `outbound-webhooks`.
- Ограничения частоты запросов. Ключ один и машинный — если API откроется
  наружу для нескольких потребителей, лимит понадобится.
- Отдельных ключей с разными правами: сейчас ключ один и полный.
