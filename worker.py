import asyncio

from dotenv import load_dotenv
load_dotenv()

import dataclasses

import temporalio.converter
from temporalio.client import Client
from temporalio.converter import ExternalStorage
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
    data_converter = dataclasses.replace(
        temporalio.converter.default(),
        external_storage=ExternalStorage(
            drivers=[LocalDiskStorageDriver()],
            payload_size_threshold=1_000,  # 1KB — low threshold for testing
        ),
    )

    client = await Client.connect("localhost:7233", data_converter=data_converter)

    worker = Worker(
        client,
        task_queue="morning-brief-python",
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

    print("Worker started on task queue: morning-brief-python")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
