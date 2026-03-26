import asyncio
import os
import re
import tempfile
from dataclasses import dataclass

from temporalio import activity


GOG = os.environ.get("GOG_PATH", "/usr/local/bin/gog")
TESSERACT = os.environ.get("TESSERACT_PATH", "/usr/bin/tesseract")


async def run_gog(*args: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        GOG, *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=25)
    return stdout.decode().strip()


@activity.defn
async def fetch_calendar() -> str:
    return await run_gog("calendar", "events", "--today", "--all")


@activity.defn
async def fetch_emails() -> str:
    from datetime import datetime, timedelta

    two_days_ago = (datetime.now() - timedelta(days=2)).strftime("%Y/%m/%d")
    result = await run_gog(
        "gmail", "messages", "search",
        f"is:unread after:{two_days_ago} -category:promotions -category:social -category:forums -from:USPSInformedDelivery -from:Amazon",
        "--max", "20",
    )
    return result or "No unread emails (USPS and Amazon have their own sections)."


@activity.defn
async def fetch_usps_mail_scans() -> str:
    import json

    from datetime import datetime, timedelta

    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y/%m/%d")

    search_result = await run_gog(
        "gmail", "messages", "search",
        f"from:USPSInformedDelivery after:{yesterday}",
        "--max", "1", "--json",
    )

    search = json.loads(search_result)
    messages = search.get("messages", [])
    if not messages:
        return "No USPS Informed Delivery email today."

    message_id = messages[0]["id"]
    message_result = await run_gog("gmail", "get", message_id, "--json")
    message = json.loads(message_result)

    attachments = [
        a for a in message.get("attachments", [])
        if a["mimeType"].startswith("image/") and not a["filename"].startswith("content-")
    ]

    if not attachments:
        return "USPS email found but no mail scan images."

    tmp_dir = tempfile.mkdtemp(prefix="usps-")
    try:
        results = []
        for i, attachment in enumerate(attachments):
            img_path = os.path.join(tmp_dir, f"mail-{i}.jpg")

            await run_gog(
                "gmail", "attachment", message_id,
                attachment["attachmentId"],
                "--out", img_path,
            )

            proc = await asyncio.create_subprocess_exec(
                TESSERACT, img_path, "stdout", "--psm", "11",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            text = stdout.decode().strip()
            if text:
                results.append(f"Mail piece {i + 1}:\n{text}")

        return "\n\n".join(results) if results else "USPS scans found but no readable text detected."
    finally:
        import shutil
        shutil.rmtree(tmp_dir, ignore_errors=True)


@dataclass
class BriefInput:
    calendar: str
    emails: str
    usps_scans: str


@activity.defn
async def generate_brief(input: BriefInput) -> str:
    return "[STUB] Morning brief goes here."


@dataclass
class LunchMeeting:
    title: str
    start_hour: int
    start_minute: int
    time_str: str


@activity.defn
async def parse_lunch_meetings(calendar_text: str) -> list[LunchMeeting]:
    if not calendar_text:
        return []

    meetings = []
    iso_pattern = re.compile(r"(\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):\d{2}[+-]\d{2}:\d{2})")

    for line in calendar_text.split("\n"):
        match = iso_pattern.search(line)
        if not match:
            continue

        hour = int(match.group(2))
        minute = int(match.group(3))

        if hour < 12 or hour >= 14:
            continue

        fields = re.split(r"\s{2,}", line.strip())
        title = fields[-1] if fields else ""

        if "lunch" in title.lower():
            continue

        display_hour = hour - 12 if hour > 12 else hour
        ampm = "PM" if hour >= 12 else "AM"
        time_str = f"{display_hour}:{minute:02d} {ampm}"

        meetings.append(LunchMeeting(
            title=title,
            start_hour=hour,
            start_minute=minute,
            time_str=time_str,
        ))

    meetings.sort(key=lambda m: m.start_hour * 60 + m.start_minute)
    return meetings


@activity.defn
async def send_to_telegram(message: str) -> None:
    import aiohttp

    token = os.environ["TELEGRAM_BOT_TOKEN"]
    chat_id = os.environ["TELEGRAM_CHAT_ID"]

    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": message, "parse_mode": "Markdown"},
            timeout=aiohttp.ClientTimeout(total=8),
        ) as res:
            if res.status != 200:
                raise RuntimeError(f"Telegram API error: {res.status} {await res.text()}")
