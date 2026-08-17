// Корень API — сам себе документация.
//
// Открывается ключом, как и остальные методы: список эндпоинтов заодно
// служит проверкой, что ключ рабочий.

import { NextRequest } from 'next/server'
import { apiOk, requireApiToken } from '@/lib/api/auth'

export async function GET(request: NextRequest) {
  const denied = await requireApiToken(request)
  if (denied) return denied

  return apiOk({
    version: 'v1',
    auth: 'Authorization: Bearer <CRM_API_TOKEN>',
    endpoints: [
      { method: 'GET', path: '/api/v1/deals', description: 'Список сделок. Фильтры: stage_id, search, limit, offset' },
      { method: 'POST', path: '/api/v1/deals', description: 'Создать сделку. Обязательно: title' },
      { method: 'GET', path: '/api/v1/deals/{id}', description: 'Одна сделка' },
      { method: 'PATCH', path: '/api/v1/deals/{id}', description: 'Изменить сделку (в т.ч. stage_id)' },
      { method: 'DELETE', path: '/api/v1/deals/{id}', description: 'Удалить сделку (мягко)' },
      { method: 'GET', path: '/api/v1/orders', description: 'Список заказов. Фильтры: status, phone, limit, offset' },
      { method: 'POST', path: '/api/v1/orders', description: 'Создать заказ' },
      { method: 'GET', path: '/api/v1/orders/{id}', description: 'Один заказ' },
      { method: 'PATCH', path: '/api/v1/orders/{id}', description: 'Изменить заказ' },
      { method: 'DELETE', path: '/api/v1/orders/{id}', description: 'Удалить заказ (мягко)' },
      { method: 'GET', path: '/api/v1/customers/{phone}', description: 'Карточка клиента: профиль, сделки, заказы' },
      { method: 'PATCH', path: '/api/v1/customers/{phone}', description: 'Изменить профиль: name, note, tags' },
      { method: 'GET', path: '/api/v1/stages', description: 'Этапы воронки — справочник stage_id' },
    ],
  })
}
