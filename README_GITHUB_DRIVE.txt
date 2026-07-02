Дневник проверки — GitHub + Google Drive + Login

Файлове:
- index.html — качи го в GitHub Pages проекта
- apps_script_code.gs — постави този код в Google Apps Script проекта
- .nojekyll — остави го в repository-то

Какво е ново във v27:
- При отваряне първо се вижда само Login страница.
- Има Username и Password.
- Паролата има бутон с око за показване/скриване, докато се пише.
- След успешен вход Login екранът изчезва.
- Горе вдясно има бутон Изход.
- Приложението не пази данни в браузъра.
- Данните се зареждат и записват само през Google Drive / Apps Script.

ВАЖНО: Username и Password не се слагат в HTML файла.
Задават се в Google Apps Script по един от двата начина:

Вариант 1 — препоръчителен:
1. Отвори Apps Script проекта.
2. Project Settings.
3. Script properties.
4. Добави:
   RESCHECK_USERNAME
   RESCHECK_PASSWORD
5. Не поставяй тези стойности в GitHub.

Вариант 2:
В apps_script_code.gs промени fallback стойностите във функциите:
getDefaultUsername_()
getDefaultPassword_()

След промяна на Apps Script:
Deploy > Manage deployments > Edit > New version > Deploy

Web app настройки:
- Execute as: Me
- Who has access: Anyone

Google Drive:
- Скриптът записва в папка ResCheck.
- Ако папката липсва, ще я създаде.
- Основният JSON файл е reservation_checks_drive_data.json.
- Backup файловете се пазят в същата папка.
- Пази се максимум 5 backup файла.

Вграденият Web App URL в index.html е:
https://script.google.com/macros/s/AKfycbyf0A7UMudFx-cQo4bRuflEn39erqJ8CH29vZ-fnO3k-ChwS2P1LLKxI9zBC2wPzEgz/exec


V25:
- Поправена е грешката AUTH_USERNAME is not defined.
- Login данните са зададени в apps_script_code.gs чрез fallback функции и не се показват в HTML интерфейса.
- След смяна на Apps Script кода направи New version → Deploy.


V26 FAST LOGIN:
- Login вече не чака четене на JSON файла от Google Drive.
- След успешна проверка на Username/Password приложението се показва веднага.
- Данните от папка ResCheck се зареждат веднага след това.
- Данните пак не се пазят в браузъра/localStorage.


Промяна във v27:
- След вход приложението се показва веднага.
- Веднага след това автоматично зарежда данните от Google Drive/ResCheck чрез POST load заявка.
- При неуспешно автоматично зареждане показва съобщение и може ръчно да се натисне „Зареди от Google Drive“ от Настройки.
