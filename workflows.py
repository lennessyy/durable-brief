import asyncio
from datetime import timedelta

from temporalio import workflow
from temporalio.common import RetryPolicy

with workflow.unsafe.imports_passed_through():
    from activities import BriefInput, LunchMeeting


@workflow.defn
class MorningBriefWorkflow:
    def __init__(self) -> None:
        self._brief: str | None = None
        self._stopped = False

    @workflow.query
    def get_brief(self) -> str | None:
        return self._brief

    @workflow.signal
    def stop_reminders(self) -> None:
        workflow.logger.info("Received stop signal, cancelling reminders")
        self._stopped = True

    @workflow.run
    async def run(self) -> str:
        workflow.logger.info("Starting morning brief workflow")

        retry_5 = RetryPolicy(
            maximum_attempts=5,
            initial_interval=timedelta(seconds=5),
            backoff_coefficient=2,
        )
        retry_3 = RetryPolicy(
            maximum_attempts=3,
            initial_interval=timedelta(seconds=3),
            backoff_coefficient=2,
        )

        # Fetch all data in parallel
        calendar_task = workflow.execute_activity(
            "fetch_calendar",
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=retry_5,
        )
        emails_task = workflow.execute_activity(
            "fetch_emails",
            start_to_close_timeout=timedelta(seconds=30),
            retry_policy=retry_5,
        )
        usps_task = workflow.execute_activity(
            "fetch_usps_mail_scans",
            start_to_close_timeout=timedelta(seconds=45),
            retry_policy=retry_5,
        )

        calendar, emails, usps_scans = await asyncio.gather(
            calendar_task, emails_task, usps_task,
        )

        workflow.logger.info("All data fetched, generating brief")

        brief = await workflow.execute_activity(
            "generate_brief",
            BriefInput(calendar=calendar, emails=emails, usps_scans=usps_scans),
            start_to_close_timeout=timedelta(seconds=60),
            retry_policy=RetryPolicy(
                maximum_attempts=5,
                initial_interval=timedelta(seconds=10),
                backoff_coefficient=2,
            ),
        )

        workflow.logger.info(f"Brief generated:\n{brief}")

        self._brief = brief

        workflow.logger.info("Morning brief complete, checking for lunch meetings")

        lunch_meetings: list[LunchMeeting] = await workflow.execute_activity(
            "parse_lunch_meetings",
            calendar,
            start_to_close_timeout=timedelta(seconds=15),
            retry_policy=retry_3,
        )

        if lunch_meetings:
            workflow.logger.info(f"Found {len(lunch_meetings)} lunch meeting(s), setting up reminders")
            await self._send_lunch_reminders(lunch_meetings)

        workflow.logger.info("Morning brief workflow complete")
        return brief

    async def _send_lunch_reminders(self, meetings: list[LunchMeeting]) -> None:
        delivery_retry = RetryPolicy(
            maximum_attempts=5,
            initial_interval=timedelta(seconds=3),
            backoff_coefficient=2,
        )

        for meeting in meetings:
            if self._stopped:
                break

            now = workflow.now()
            meeting_time = now.replace(
                hour=meeting.start_hour, minute=meeting.start_minute, second=0, microsecond=0,
            )
            meeting_ms = meeting_time.timestamp() * 1000

            # 30-minute reminder
            thirty_min_before = meeting_ms - 30 * 60 * 1000
            wait_ms = thirty_min_before - workflow.now().timestamp() * 1000

            if wait_ms > 0:
                try:
                    await workflow.wait_condition(
                        lambda: self._stopped, timeout=timedelta(milliseconds=wait_ms),
                    )
                except asyncio.TimeoutError:
                    pass  # Timer expired, time to send the reminder
                if self._stopped:
                    break

            if not self._stopped and workflow.now().timestamp() * 1000 < meeting_ms:
                await workflow.execute_activity(
                    "send_to_telegram",
                    f"⏰ *30 min reminder:* {meeting.title}\n\n_Reply STOP to cancel reminders._",
                    start_to_close_timeout=timedelta(seconds=15),
                    retry_policy=delivery_retry,
                )

            # 10-minute reminder
            ten_min_before = meeting_ms - 10 * 60 * 1000
            wait_ms = ten_min_before - workflow.now().timestamp() * 1000

            if wait_ms > 0:
                try:
                    await workflow.wait_condition(
                        lambda: self._stopped, timeout=timedelta(milliseconds=wait_ms),
                    )
                except asyncio.TimeoutError:
                    pass
                if self._stopped:
                    break

            if not self._stopped and workflow.now().timestamp() * 1000 < meeting_ms:
                await workflow.execute_activity(
                    "send_to_telegram",
                    f"⏰ *10 min reminder:* {meeting.title}",
                    start_to_close_timeout=timedelta(seconds=15),
                    retry_policy=delivery_retry,
                )

