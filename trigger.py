import asyncio
from datetime import datetime

from temporalio.client import Client
from temporalio.converter import DataConverter, ExternalStorage

from storage_driver import LocalDiskStorageDriver


async def main() -> None:
    converter = DataConverter(
        external_storage=ExternalStorage(
            drivers=[LocalDiskStorageDriver()],
            payload_size_threshold=1_000,  # must match worker
        ),
    )

    client = await Client.connect("localhost:7233", data_converter=converter)

    workflow_id = f"morning-brief-{datetime.now().strftime('%Y-%m-%d')}"

    handle = await client.start_workflow(
        "MorningBriefWorkflow",
        id=workflow_id,
        task_queue="morning-brief",
    )

    print(f"Started workflow: {handle.id}")

    # Poll for the brief via query
    brief = None
    while brief is None:
        await asyncio.sleep(2)
        brief = await handle.query("get_brief")

    print(brief)


if __name__ == "__main__":
    asyncio.run(main())
