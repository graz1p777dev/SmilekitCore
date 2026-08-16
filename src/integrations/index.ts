// Манифест: единственное место, где видно, что подключено.
//
// Отключить интеграцию — убрать строку из register-списка. Добавить — создать
// каталог рядом и дописать строку. Никакого автопоиска по файловой системе:
// состав системы должен читаться глазами, а не выводиться из того, что лежит
// на диске.
//
// Любой код, которому нужна работающая интеграция (маршруты вебхуков,
// планировщики, серверные действия), импортирует ИМЕННО этот файл — импорт и
// есть регистрация.

import { register } from '@/core'
import { amocrm } from './amocrm'
import { greenapi } from './greenapi'
import { inventory } from './inventory'
import { outboundWebhooks } from './outbound-webhooks'

// Каналы — умеют принимать и отправлять сообщения.
register(greenapi)

// Модули — реагируют на события ядра, своего транспорта не имеют.
register(inventory)
register(outboundWebhooks)
register(amocrm)

export { greenapi } from './greenapi'
export { inventory } from './inventory'
export { outboundWebhooks } from './outbound-webhooks'
export { amocrm } from './amocrm'
