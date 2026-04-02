"""Local-disk storage driver for large payloads (stand-in for S3)."""

import os
import uuid
from typing import Sequence

from temporalio.api.common.v1 import Payload
from temporalio.converter import (
    StorageDriver,
    StorageDriverClaim,
    StorageDriverStoreContext,
    StorageDriverRetrieveContext,
)


class LocalDiskStorageDriver(StorageDriver):
    def __init__(self, store_dir: str = "/tmp/temporal-payload-store") -> None:
        self._store_dir = store_dir

    def name(self) -> str:
        return "local-disk"

    async def store(
        self,
        context: StorageDriverStoreContext,
        payloads: Sequence[Payload],
    ) -> list[StorageDriverClaim]:
        os.makedirs(self._store_dir, exist_ok=True)

        prefix = self._store_dir
        sc = context.serialization_context
        if sc is not None and hasattr(sc, "workflow_id"):
            prefix = os.path.join(self._store_dir, sc.namespace, sc.workflow_id)
            os.makedirs(prefix, exist_ok=True)

        claims = []
        for payload in payloads:
            key = f"{uuid.uuid4()}.bin"
            file_path = os.path.join(prefix, key)
            with open(file_path, "wb") as f:
                f.write(payload.SerializeToString())
            claims.append(StorageDriverClaim(claim_data={"path": file_path}))
        return claims

    async def retrieve(
        self,
        context: StorageDriverRetrieveContext,
        claims: Sequence[StorageDriverClaim],
    ) -> list[Payload]:
        payloads = []
        for claim in claims:
            file_path = claim.claim_data["path"]
            with open(file_path, "rb") as f:
                data = f.read()
            payload = Payload()
            payload.ParseFromString(data)
            payloads.append(payload)
        return payloads
