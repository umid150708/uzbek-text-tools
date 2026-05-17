"""
Uzbek Spell-Checker Telegram Bot
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
A minimal Telegram bot that checks incoming Uzbek messages for spelling
errors and replies with corrections.

Requirements:
    pip install python-telegram-bot uzbek-text-tools

Usage:
    export TELEGRAM_BOT_TOKEN="your-token-here"
    python telegram_bot.py

The bot responds to any text message with:
  - A confirmation if no errors are found
  - A list of misspelled words with suggestions

Example interaction:
    User:  Bu kitoob juda yaxshi
    Bot:   1 ta xato topildi:
           - kitoob → kitob
"""

import os
import logging

from telegram import Update
from telegram.ext import ApplicationBuilder, MessageHandler, filters, ContextTypes

from uzbek_text_tools import UzbekSpellChecker

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

checker = UzbekSpellChecker()


async def check_spelling(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Check the user's message and reply with corrections."""
    text = update.message.text
    result = checker.check_text(text)

    if result["errors_found"] == 0:
        await update.message.reply_text(
            f"Xatosiz! ({result['total_words']} ta so'z tekshirildi)"
        )
    else:
        lines = [f"{result['errors_found']} ta xato topildi:\n"]
        for error in result["errors"]:
            suggestions = ", ".join(error["suggestions"][:3])
            lines.append(f"  - {error['word']} → {suggestions}")
        await update.message.reply_text("\n".join(lines))


def main() -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        raise SystemExit(
            "Set TELEGRAM_BOT_TOKEN environment variable.\n"
            "Get one from @BotFather on Telegram."
        )

    app = ApplicationBuilder().token(token).build()
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, check_spelling))

    logger.info("Bot ishga tushdi — xabar kutilmoqda...")
    app.run_polling()


if __name__ == "__main__":
    main()
