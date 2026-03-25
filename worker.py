import asyncio

from temporalio.client import Client
from temporalio.converter import DataConverter, ExternalStorage
from temporalio.worker import Worker

from activities import (
    fetch_calendar,
    fetch_emails,
    fetch_usps_mail_scans,
    generate_brief,
    parse_lunch_meetings,
    send_to_telegram,
)
from storage_driver import LocalDiskStorageDriver
from workflows import MorningBriefWorkflow


async def main() -> None:
    converter = DataConverter(
        external_storage=ExternalStorage(
            drivers=[LocalDiskStorageDriver()],
            payload_size_threshold=1_000,  # 1KB — low threshold for testing
        ),
    )

    client = await Client.connect("localhost:7233", data_converter=converter)

    worker = Worker(
        client,
        task_queue="morning-brief",
        workflows=[MorningBriefWorkflow],
        activities=[
            fetch_calendar,
            fetch_emails,
            fetch_usps_mail_scans,
            generate_brief,
            parse_lunch_meetings,
            send_to_telegram,
        ],
    )

    print("Worker started on task queue: morning-brief")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
