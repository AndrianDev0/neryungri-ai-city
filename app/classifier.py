"""Small, reproducible text classifier trained exclusively on educational examples."""

import re
from functools import lru_cache

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline

CATEGORIES = {
    "snow": "Снег и наледь",
    "lighting": "Освещение",
    "waste": "Мусор",
    "roads": "Дороги и тротуары",
    "drainage": "Водоотведение",
    "other": "Другое",
}

# These are authored training examples, not a municipal dataset or evaluation set.
TRAINING = {
    "snow": [
        "Не убирают снег возле дома", "Тротуар завален снегом", "Во дворе сугробы",
        "Дорогу не чистили после снегопада", "На лестнице скользко из-за льда",
        "Нужно посыпать дорожку песком от гололеда", "Снегоуборщик завалил въезд",
        "С крыши свисают сосульки", "Снежная каша на пешеходном переходе",
        "Не пройти из-за наледи", "У подъезда не убран снег", "Уберите снежный вал",
        "Замерзший тротуар никто не обрабатывает", "Во дворе очень скользко",
    ],
    "lighting": [
        "Не работает фонарь", "На улице нет освещения", "Во дворе по вечерам темно",
        "Перегорела лампа уличного освещения", "Мигает фонарь возле дома",
        "На переходе не горят фонари", "Сломана опора освещения",
        "Свет на пешеходной дорожке отключен", "Поврежден кабель фонаря",
        "Лампы не включаются ночью", "Весь квартал без уличного света",
        "Фонарь искрит и провод лежит на земле", "Возле остановки темно",
        "Освещение работает только днем",
    ],
    "waste": [
        "Переполнен контейнер", "Мусор не вывозят неделю", "На площадке свалка",
        "Мусорные баки полные", "Пакеты с отходами разбросаны по двору",
        "Сломан бак для мусора", "Вокруг контейнеров грязь и мусор",
        "Урны переполнены", "Нужен вывоз бытовых отходов", "Мусоровоз не приезжает",
        "Строительный мусор выбросили на газон", "У дома лежат мешки с отходами",
        "Контейнерная площадка не убрана", "Пахнет от мусорных баков",
    ],
    "roads": [
        "Яма на дороге", "Асфальт провалился", "Разбит тротуар возле дома",
        "На проезжей части глубокие выбоины", "Трещины в дорожном покрытии",
        "Требуется ремонт дороги", "Пешеходная дорожка разрушена",
        "Плитка на тротуаре провалилась", "Открытый люк на дороге",
        "Поврежден бордюр", "После ремонта раскопали дорогу и не восстановили",
        "Не проехать по ямам", "Разрушены ступени у перехода", "Дыра в асфальте",
    ],
    "drainage": [
        "Не работает ливневая канализация", "После дождя затопило улицу",
        "Ливневка забита", "Во дворе стоит вода", "Вода не уходит в слив",
        "Затоплен пешеходный переход", "Водоотводная канава засорилась",
        "Сток забит листьями", "Лужа перекрывает проход", "Решетка ливневки засорена",
        "Талая вода затопила двор", "Из канализации течет вода",
        "Дождевой сток не справляется", "Нужно прочистить водосток",
    ],
    "other": [
        "Нужна справка", "Когда прием у специалиста", "Как оплатить коммунальные услуги",
        "Хочу предложить городской праздник", "Не работает интернет", "Автобус опаздывает",
        "Соседи громко слушают музыку", "Как записаться в библиотеку",
        "Прошу посадить деревья", "Сломаны качели на детской площадке",
        "Спасибо за выполненную работу", "Нужен ремонт скамейки", "Потерялась собака",
        "Когда откроют спортивную секцию",
    ],
}


@lru_cache(maxsize=1)
def model():
    texts, labels = [], []
    for label, examples in TRAINING.items():
        texts.extend(examples)
        labels.extend([label] * len(examples))
    pipeline = make_pipeline(
        TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True),
        LogisticRegression(C=12, max_iter=1000, class_weight="balanced", random_state=17),
    )
    pipeline.fit(texts, labels)
    return pipeline


def analyze(text: str):
    cleaned = text.lower().replace("ё", "е")
    probabilities = model().predict_proba([cleaned])[0]
    order = probabilities.argsort()[::-1]
    category = str(model().classes_[order[0]])
    uncertain = float(probabilities[order[0]]) < .32 or float(probabilities[order[0]] - probabilities[order[1]]) < .07
    if uncertain:
        category = "other"
    priority = "normal"
    reasons = ["В тексте не найдены признаки опасности, которые учитывают правила. Это не означает, что место безопасно. Нужна проверка на месте."]
    danger_patterns = (
        r"открыт\w*\s+люк|люк\w*\s+открыт",
        r"провод[^.!?\n]{0,30}(земл|оборван)|оборван\w*\s+(?:электрическ\w*\s+)?провод",
        r"искрит",
        r"провал[^.!?\n]{0,20}(дорог|асфальт)|(дорог|асфальт)[^.!?\n]{0,20}провал",
        r"сосульк|угроз[^.!?\n]{0,15}жизн",
    )
    # Resolve only the clause containing the repair; a different hazard remains active.
    clauses = re.split(r"[.!?;\n]+|\bно\b|\bа\b|\s+и\s+(?=переполн|не\s+работ|открыт|провод|фонар|люк)", cleaned)
    resolved = re.compile(r"(?<!не )(?<!не\s)(?:уже\s+)?(?:закрыли|закрыт\w*|устранили|устранен\w*|починили|исправили|убрали)|проблема\s+решена")
    active = [c for c in clauses if not resolved.search(c)]
    active_text = ". ".join(active)
    active_text = re.sub(r"\bне\s+искрит\b|\bлюк\s+не\s+открыт\w*", "", active_text)
    if any(re.search(pattern, active_text) for pattern in danger_patterns):
        priority = "high"
        reasons = ["В тексте есть признаки возможной опасности. Приоритет должен подтвердить специалист."]
    elif re.search(r"не\s+пройти|не\s+проехать|затоп|переполн|переход|недел|скольз|гололед", active_text):
        priority = "medium"
        reasons = ["Повышенный приоритет назначен по ключевым словам. Проверьте срочность вручную."]
    if any(resolved.search(c) for c in clauses):
        reasons.append("В тексте сказано, что проблему устранили. Проверьте результат. Статус автоматически не меняется.")
    suggestions = []
    for clause in clauses:
        if len(clause.strip()) < 5 or resolved.search(clause):
            continue
        scores = model().predict_proba([clause])[0]
        index = scores.argmax()
        key = str(model().classes_[index])
        if key != "other" and scores[index] >= .40 and key not in [s["category"] for s in suggestions]:
            suggestions.append({"category": key, "label": CATEGORIES[key], "text": clause.strip().capitalize()})
    multiple = len(suggestions) > 1
    return {
        "category": category,
        "category_label": CATEGORIES[category],
        "priority": priority,
        "review_required": uncertain or multiple,
        "suggestions": suggestions if multiple else [],
        "reasons": reasons,
        "method": "TF-IDF + логистическая регрессия",
        "training_source": "Учебные примеры; качество на реальных обращениях не измерено",
    }
