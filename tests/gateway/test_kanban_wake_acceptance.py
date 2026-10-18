"""Push admission and durable notifier retries use real adapter/SQLite lifecycles."""
import asyncio




async def drain(adapter):
    while adapter._background_tasks:
        await asyncio.gather(*list(adapter._background_tasks))


