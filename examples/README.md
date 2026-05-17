# Examples

## Telegram Spell-Checker Bot

A minimal Telegram bot that checks every incoming Uzbek message for spelling errors.

### Setup

1. Create a bot via [@BotFather](https://t.me/BotFather) and copy the token.
2. Install dependencies:

```bash
pip install python-telegram-bot uzbek-text-tools
```

3. Run:

```bash
export TELEGRAM_BOT_TOKEN="your-token-here"
python telegram_bot.py
```

### How it works

- User sends any Uzbek text message
- Bot runs `UzbekSpellChecker.check_text()` on it
- If errors are found, the bot replies with each misspelled word and its top-3 suggestions
- If the message is clean, it replies with a confirmation

### Example

```
User:  Bu kitoob juda yaxshi
Bot:   1 ta xato topildi:
         - kitoob → kitob
```
