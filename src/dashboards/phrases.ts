// Словарь интерпретатора DEMO-2 ч. 1: фразы простыми словами ru/en (правило совместимости 3). Подстановки `{ключ}` —
// идентификаторы и суммы из записи линии (сумма — уже отформатированный источником текст по языку, правило 2).
// Слово «оплачено» — только у события Платформы operation.* (инвариант 6); ответ витрины — «слова продавца».
import type { WireLang } from "./wire.js";

export type Phrase = Readonly<Record<WireLang, string>>;
const p = (ru: string, en: string): Phrase => ({ ru, en });

const monitor: Readonly<Record<string, Phrase>> = {
  "POST /pao/v1/mandates": p("Агент передал Платформе поручение на подпись клиенту", "The agent submitted a mandate to the Platform for the client to sign"),
  "GET /pao/v1/mandates/{mandate_id}": p("Агент перечитал поручение[ {mandate_id}] у Платформы", "The agent re-read mandate[ {mandate_id}] from the Platform"),
  "GET /pao/v1/mandates/{mandate_id}/verify": p("Агент сверил покупку с поручением[ {mandate_id}] у Платформы", "The agent checked the purchase against mandate[ {mandate_id}] with the Platform"),
  "POST /pao/v1/mandates/{mandate_id}/relinquish": p("Агент вернул неиспользованное поручение[ {mandate_id}]", "The agent relinquished unused mandate[ {mandate_id}]"),
  "POST /participants/v1/mandates/{mandate_id}/sign": p("Клиент подписал поручение[ {mandate_id}] в приложении банка", "The client signed mandate[ {mandate_id}] in the bank app"),
  "POST /participants/v1/mandates/{mandate_id}/revoke": p("Клиент отозвал поручение[ {mandate_id}] в приложении банка", "The client revoked mandate[ {mandate_id}] in the bank app"),
  "PUT /participants/v1/principals/{principal_ref}/limits": p("Банк изменил лимит клиента на операцию", "The bank changed the client's per-operation limit"),
  "GET /pao/v1/merchants/{merchant_id}/readiness": p("Агент проверил знак готовности продавца[ {merchant_id}]", "The agent checked the readiness mark of merchant[ {merchant_id}]"),
  "GET /v1/shops": p("Агент запросил список витрин", "The agent requested the list of shops"),
  "GET /v1/shops/{shop_id}/catalog": p("Агент прочитал каталог витрины[ {shop_id}]", "The agent read the catalog of shop[ {shop_id}]"),
  "POST /v1/shops/{shop_id}/orders": p("Агент оформил заказ в витрине[ {shop_id}]", "The agent placed an order in shop[ {shop_id}]"),
  "POST /pao/v1/credentials": p("Агент получил у Платформы разовый платёжный реквизит под покупку", "The agent obtained a one-time payment credential from the Platform"),
  "POST /adp/v1/decide": p("Платформа приняла решение по оплате", "The Platform made the payment decision"),
  "POST /adp/v1/events": p("Платформа получила итог операции от процессинга", "The Platform received the operation result from processing"),
  "POST /participants/v1/merchants/{merchant_id}/payments": p("Эквайрер продавца[ {merchant_id}] передал оплату", "The acquirer of merchant[ {merchant_id}] submitted the payment"),
  "POST /v1/shops/{shop_id}/orders/{order_id}/payment": p("Агент передал оплату заказа[ {order_id}] продавцу", "The agent sent payment for order[ {order_id}] to the merchant"),
  "POST /v1/shops/{shop_id}/orders/{order_id}/confirmation": p("Агент сообщил продавцу о подтверждении заказа[ {order_id}]", "The agent told the merchant that order[ {order_id}] was confirmed"),
  "GET /pao/v1/confirmations/{confirmation_id}": p("Агент проверил, ответил ли клиент на запрос подтверждения", "The agent checked whether the client answered the confirmation request"),
  "POST /participants/v1/confirmations/{confirmation_id}": p("Клиент ответил на запрос подтверждения на странице банка", "The client answered the confirmation request on the bank page"),
  "GET /pao/v1/operations/{op_ref}": p("Агент прочитал операцию[ {op_ref}] у Платформы", "The agent read operation[ {op_ref}] from the Platform"),
  "mandate.signed": p("Платформа: поручение[ {mandate_id}] подписано клиентом", "Platform: mandate[ {mandate_id}] signed by the client"),
  "mandate.rejected": p("Платформа: клиент отклонил поручение[ {mandate_id}]", "Platform: the client rejected mandate[ {mandate_id}]"),
  "mandate.revoked": p("Платформа: поручение[ {mandate_id}] отозвано", "Platform: mandate[ {mandate_id}] revoked"),
  "mandate.exhausted": p("Платформа: поручение[ {mandate_id}] исчерпано", "Platform: mandate[ {mandate_id}] exhausted"),
  "confirmation.required": p("Платформа: покупка[ на {amount}] выше порога — нужно подтверждение человека", "Platform: the purchase[ of {amount}] is above the threshold — human confirmation required"),
  "confirmation.approved": p("Платформа: клиент подтвердил покупку[ на {amount}]", "Platform: the client confirmed the purchase[ of {amount}]"),
  "confirmation.rejected": p("Платформа: клиент отклонил покупку", "Platform: the client rejected the purchase"),
  "confirmation.expired": p("Платформа: срок подтверждения истёк", "Platform: the confirmation expired"),
  "operation.authorized": p("Платформа: оплачено[ — {amount}] (итог по подписанному событию)", "Platform: paid[ — {amount}] (outcome from a signed event)"),
  "operation.declined": p("Платформа: оплата отклонена[ ({code})]", "Platform: payment declined[ ({code})]"),
  "operation.settled": p("Платформа: списание подтверждено[ — {amount}]", "Platform: settlement confirmed[ — {amount}]"),
  "operation.refunded": p("Платформа: оформлен возврат[ — {amount}]", "Platform: refund issued[ — {amount}]"),
};

const scenario: Readonly<Record<string, Phrase>> = {
  "intent.created": p("Агент просит поручение: «{subject}», до {limit}", "The agent asks for a mandate: “{subject}”, up to {limit}"),
  "intent.awaiting_signature": p("Поручение[ {mandate_id}] ждёт подписи клиента в банке", "Mandate[ {mandate_id}] awaits the client's signature in the bank"),
  "intent.signed": p("Поручение[ {mandate_id}] действует", "Mandate[ {mandate_id}] is active"),
  "purchase.mode_note": p("Покупка в немедленном режиме: корзина подписывается сразу", "Immediate mode: the cart is signed right away"),
  "search.found": p("Найдено предложений в контуре гарантий: {contour}, вне контура: {market}", "Offers inside the guarantee contour: {contour}, outside: {market}"),
  "search.flagged": p("Предложение {sku} продавца[ {merchant_id}] исключено по сигналу {codes}", "Offer {sku} of merchant[ {merchant_id}] excluded on signal {codes}"),
  "search.compared": p("Агент сравнил кандидатов: {candidates}", "The agent compared candidates: {candidates}"),
  "search.picked": p("Агент выбрал «{title}» — {price}", "The agent picked “{title}” — {price}"),
  "upk.qty": p("Количество {qty} — чтобы сумма была выше порога подтверждения {threshold}", "Quantity {qty} — to exceed the confirmation threshold {threshold}"),
  "cart.card": p("Клиенту показана карточка корзины: «{title}» × {qty}, итог {total}", "The client sees the cart card: “{title}” × {qty}, total {total}"),
  "cart.agreed": p("Клиент согласился с корзиной", "The client agreed to the cart"),
  "cart.declined": p("Клиент не согласился с корзиной — корзина не запрошена", "The client declined the cart — no cart requested"),
  "cart.created": p("Агент запросил корзину на подпись: {total}", "The agent requested a cart for signature: {total}"),
  "cart.awaiting_signature": p("Корзина[ {mandate_id}] ждёт подписи клиента в банке", "Cart[ {mandate_id}] awaits the client's signature in the bank"),
  "cart.signed": p("Клиент подписал корзину[ {mandate_id}]", "The client signed cart[ {mandate_id}]"),
  "order.placed": p("Заказ[ {order_id}] у продавца[ {merchant_id}]: «{title}» × {qty}", "Order[ {order_id}] at merchant[ {merchant_id}]: “{title}” × {qty}"),
  "payment.started": p("Агент начал оплату заказа[ {order_id}]", "The agent started paying order[ {order_id}]"),
  "order.shop_reply": p("Ответ витрины по заказу[ {order_id}]: {reply} (слова продавца, не итог)", "Shop reply for order[ {order_id}]: {reply} (merchant's words, not the outcome)"),
  outcome: p("Итог по событию Платформы: {status}[, {amount}]", "Outcome from the Platform event: {status}[, {amount}]"),
  "bank.limit_set": p("Эмулятор банка поставил клиенту лимит на операцию {limit}", "The bank emulator set the client's per-operation limit to {limit}"),
  "bank.limit_reset": p("Эмулятор банка снял лимит клиента", "The bank emulator removed the client's limit"),
  "bank.limit_reset_failed": p("Эмулятор банка не смог снять лимит клиента[ ({code})]", "The bank emulator failed to remove the client's limit[ ({code})]"),
  "limit.declined": p("Отказ: превышен лимит клиента в банке", "Declined: the client's bank limit exceeded"),
  "upk.required": p("Банк просит клиента подтвердить покупку на странице УПК", "The bank asks the client to confirm the purchase on the confirmation page"),
  "upk.aborted": p("Ожидание подтверждения прервано[ ({code})]", "Waiting for confirmation aborted[ ({code})]"),
  notice: p("Агент ждёт подтверждения клиента[ ({code})]", "The agent waits for the client's confirmation[ ({code})]"),
  failed: p("Сюжет не дошёл до конца[: {code}]", "The scenario did not complete[: {code}]"),
  "revoke.ask": p("Сюжет просит клиента отозвать поручение[ {mandate_id}] в банке", "The scenario asks the client to revoke mandate[ {mandate_id}] in the bank"),
  "revoke.seen": p("Агент получил событие отзыва поручения[ {mandate_id}]", "The agent received the revocation of mandate[ {mandate_id}]"),
  "revoke.attempt": p("Агент пробует покупку по поручению[ {mandate_id}]", "The agent tries a purchase under mandate[ {mandate_id}]"),
  "revoke.refused": p("Покупка остановлена до витрин и оплаты: {code}", "Purchase stopped before shops and payment: {code}"),
  aborted: p("Сюжет прерван", "Scenario aborted"),
};

const console_: Readonly<Record<string, Phrase>> = {
  "pao.call": p("Агент обратился к Платформе", "The agent called the Platform"),
  "shop.call": p("Агент обратился к витрине", "The agent called a shop"),
  "shop.readiness": p("Агент проверил знак готовности продавца {merchant}", "The agent checked merchant {merchant} readiness"),
  "purchase.stage": p("Покупка — стадия {detail}", "Purchase — stage {detail}"),
  "event.handled": p("Агент обработал событие {detail}", "The agent handled event {detail}"),
  "offer.flagged": p("Агент отметил предложение {ref} продавца {merchant}: {code}", "The agent flagged offer {ref} of merchant {merchant}: {code}"),
  "offer.excluded": p("Агент исключил предложения продавца {merchant}: {code}", "The agent excluded offers of merchant {merchant}: {code}"),
  "operation.status": p("Агент узнал состояние операции: {detail}", "The agent learned the operation state: {detail}"),
  "confirmation.status": p("Агент узнал состояние подтверждения: {detail}", "The agent learned the confirmation state: {detail}"),
  "confirmation.unclaimed": p("Запрос подтверждения ещё не связан с покупкой агента", "The confirmation request is not yet bound to the agent's purchase"),
  "cart.relinquish_skipped": p("Корзину возвращать не нужно", "No need to relinquish the cart"),
  "mandate.revoked": p("Агент узнал об отзыве поручения", "The agent learned the mandate was revoked"),
  "agent.refused": p("Агент сам отказался действовать: {code}", "The agent refused to act on its own: {code}"),
  "purchase.unfinished": p("Покупка не завершена: {code}", "Purchase not completed: {code}"),
};

export const PHRASES = {
  monitor,
  scenario,
  console: console_,
  toHuman: p("Решение передано человеку: нужно подтверждение клиента[ ({code})]", "Decision handed to a human: client confirmation required[ ({code})]"),
  limitClient: p("Отказ: превышен лимит клиента в банке", "Declined: the client's bank limit exceeded"),
  agentReason: p("Агент: {code}", "Agent: {code}"),
  agentStopped: p("Агент остановил покупку: {code}", "The agent stopped the purchase: {code}"),
  overreach: p(
    "Платформа остановила агента: нарушение поручения ({code}) — фрод или дефект агента, вердикт — владелец",
    "The Platform stopped the agent: mandate violation ({code}) — fraud or agent defect, the owner decides",
  ),
  fraud: {
    agent: p("Платформа остановила подставного агента: попытка действовать вне поручения ({code})", "The Platform stopped the rogue agent: an attempt to act outside the mandate ({code})"),
    network: p("Запрос от имени агента без верной подписи или ключа отклонён ({code})", "A request posing as an agent without a valid signature or key was refused ({code})"),
  },
} as const;

/** Подписи для экранов. */
export const LABELS = {
  stage: {
    mandate: p("Поручение", "Mandate"),
    search: p("Подбор", "Search"),
    cart: p("Корзина", "Cart"),
    payment: p("Оплата", "Payment"),
    confirmation: p("Подтверждение", "Confirmation"),
    outcome: p("Итог", "Outcome"),
    revoke: p("Отзыв", "Revocation"),
    service: p("Служебное", "Service"),
  },
  role: {
    client: p("клиент", "client"),
    agent: p("агент", "agent"),
    platform: p("Платформа", "Platform"),
    bank: p("банк", "bank"),
    merchant: p("продавец", "merchant"),
    network: p("неизвестный отправитель", "unknown sender"),
    environment: p("среда", "environment"),
  },
  kind: {
    norm: p("норма", "normal"),
    conflict: p("конфликт", "conflict"),
    error: p("ошибка", "error"),
    fraud: p("фрод", "fraud"),
  },
  verdict: {
    expected: p("так и должно быть", "works as intended"),
    failure: p("сбой", "failure"),
    unknown: p("код не в реестрах", "code not in registries"),
    owner: p("решает владелец", "the owner decides"),
  },
  pending: p("ждёт передачи реестра Платформы", "awaiting the Platform registry handoff"),
  emulated: p("эмулятор", "emulator"),
} as const;
