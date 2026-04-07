import asyncio
import os

from dotenv import load_dotenv
load_dotenv()

import dataclasses

import aioboto3
from temporalio.client import Client
from temporalio.contrib.aws.s3driver import S3StorageDriver
from temporalio.contrib.aws.s3driver.aioboto3 import new_aioboto3_client
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
from workflows import MorningBriefWorkflow

AWS_PROFILE = os.environ.get("AWS_PROFILE")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-2")
S3_BUCKET = os.environ.get("S3_BUCKET", "payload-storage-364655878703-us-east-2-an")


async def main() -> None:
    session = aioboto3.Session(region_name=AWS_REGION)
    async with session.client("s3") as s3_client:
        driver = S3StorageDriver(
            client=new_aioboto3_client(s3_client),
            bucket=S3_BUCKET,
        )

        data_converter = dataclasses.replace(
            DataConverter.default,
            external_storage=ExternalStorage(
                drivers=[driver],
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
