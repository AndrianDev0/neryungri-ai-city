"""Time-ordered evaluation of report volume, not physical failures."""

from datetime import timedelta


def evaluate_baseline(dates, today, coverage):
    if coverage < 56 or len(dates) < 60:
        return {"available": False, "note": "Для проверки точности нужны 56 дней полной истории и не менее 60 обращений. Дни без записей считаются днями без обращений. Если выгрузка неполная, результат будет искажён."}
    windows = []
    for weeks_ago in range(4, 0, -1):
        start = today - timedelta(days=weeks_ago * 7)
        end = start + timedelta(days=7)
        training = sum(start - timedelta(days=28) <= d < start for d in dates)
        previous = sum(start - timedelta(days=7) <= d < start for d in dates)
        actual = sum(start <= d < end for d in dates)
        windows.append({"start": start.isoformat(), "end": (end - timedelta(days=1)).isoformat(),
                        "expected": training / 4, "previous_week": previous, "actual": actual})
    return {"available": True, "windows": windows,
            "mae": round(sum(abs(w["expected"] - w["actual"]) for w in windows) / len(windows), 2),
            "previous_week_mae": round(sum(abs(w["previous_week"] - w["actual"]) for w in windows) / len(windows), 2),
            "note": "Сравниваем прогноз с числом обращений за четыре завершённые недели, включая дубли. Для каждой недели расчёт использует только более ранние данные. Дни без записей считаются днями без обращений. Если выгрузка неполная, результат будет искажён. Точность на будущих обращениях пока не проверена."}
